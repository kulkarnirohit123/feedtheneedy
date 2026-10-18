import { randomUUID } from 'crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { classifyMessage, ClassifierError } from './classifier';
import { putRequest, putSpamLog, hasProcessedMessage, markMessageProcessed } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { FoodRequest } from '../shared/types';

const sfn = new SFNClient({});
const CONFIDENCE_THRESHOLD = 0.7;
const DONOR_ACK_TEXT =
  'Thank you for sharing the information, driver will be available in next 60 minutes';

async function startPickupExecution(requestId: string): Promise<void> {
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN ?? '',
      name: requestId,
      input: JSON.stringify({ requestId }),
    }),
  );
}

export interface InboundDonorMessage {
  messageId: string;
  fromPhone: string;
  text: string;
  geo?: { lat: number; lng: number };
}

export async function handleDonorMessage(input: InboundDonorMessage): Promise<void> {
  if (await hasProcessedMessage(input.messageId)) {
    return;
  }
  await markMessageProcessed(input.messageId);

  const now = new Date().toISOString();

  try {
    const result = await classifyMessage(input.text);

    if (result.verdict === 'spam' || result.verdict === 'marketing' || result.verdict === 'loan_offer' || result.verdict === 'unrelated') {
      await putSpamLog({
        msgId: input.messageId,
        phone: input.fromPhone,
        rawText: input.text,
        verdict: result.verdict,
        confidence: result.confidence,
      });
      return;
    }

    const isConfident = result.confidence >= CONFIDENCE_THRESHOLD;
    const req: FoodRequest = {
      requestId: randomUUID(),
      donorPhone: input.fromPhone,
      qty: result.extracted?.qty ?? 'unknown',
      foodType: result.extracted?.foodType ?? 'unknown',
      geo: input.geo ?? { lat: 0, lng: 0 },
      status: isConfident ? 'MATCHING' : 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
      reassignCount: 0,
    };
    await putRequest(req);

    if (isConfident) {
      await sendWhatsAppText(input.fromPhone, DONOR_ACK_TEXT);
      await startPickupExecution(req.requestId);
    }
  } catch (err) {
    if (err instanceof ClassifierError) {
      const req: FoodRequest = {
        requestId: randomUUID(),
        donorPhone: input.fromPhone,
        qty: 'unknown',
        foodType: 'unknown',
        geo: input.geo ?? { lat: 0, lng: 0 },
        status: 'PENDING_REVIEW',
        createdAt: now,
        updatedAt: now,
        reassignCount: 0,
      };
      await putRequest(req);
      return;
    }
    throw err;
  }
}
