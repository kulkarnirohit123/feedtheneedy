import { randomUUID } from 'crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { classifyMessage, ClassifierError } from './classifier';
import { putRequest, putSpamLog, hasProcessedMessage, markMessageProcessed } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { FoodRequest } from '../shared/types';

const sfn = new SFNClient({});
const CONFIDENCE_THRESHOLD = 0.7;
const LOCATION_REQUEST_TEXT =
  'Thanks! We need your pickup location to dispatch a driver — please share it using WhatsApp’s location attachment.';

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
      await markMessageProcessed(input.messageId);
      return;
    }

    // Geo-based dispatch (nearest driver, nearest fridge) can't proceed without coordinates,
    // and guessing a location is worse than not dispatching: it would send a driver to the
    // wrong place. A confident offer with no geo therefore lands in PENDING_REVIEW for an
    // admin, and the donor is asked to share their location so a retry can dispatch properly.
    const isConfident = result.confidence >= CONFIDENCE_THRESHOLD;
    const canDispatch = isConfident && !!input.geo;

    const req: FoodRequest = {
      requestId: randomUUID(),
      donorPhone: input.fromPhone,
      qty: result.extracted?.qty ?? 'unknown',
      foodType: result.extracted?.foodType ?? 'unknown',
      ...(input.geo ? { geo: input.geo } : {}),
      ...(result.extracted?.locationText ? { locationText: result.extracted.locationText } : {}),
      status: canDispatch ? 'MATCHING' : 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
      reassignCount: 0,
    };
    await putRequest(req);

    if (canDispatch) {
      // The donor acknowledgement is sent by the state machine's NotifyDonor state, not here —
      // sending it in both places delivered the donor two identical messages.
      await startPickupExecution(req.requestId);
    } else if (isConfident) {
      await sendWhatsAppText(input.fromPhone, LOCATION_REQUEST_TEXT);
    }

    await markMessageProcessed(input.messageId);
  } catch (err) {
    if (err instanceof ClassifierError) {
      const req: FoodRequest = {
        requestId: randomUUID(),
        donorPhone: input.fromPhone,
        qty: 'unknown',
        foodType: 'unknown',
        ...(input.geo ? { geo: input.geo } : {}),
        status: 'PENDING_REVIEW',
        createdAt: now,
        updatedAt: now,
        reassignCount: 0,
      };
      await putRequest(req);
      await markMessageProcessed(input.messageId);
      return;
    }
    // Deliberately NOT marked processed: a transient DynamoDB/Step Functions/WhatsApp failure
    // must leave the message replayable, so WhatsApp's redelivery can retry it.
    throw err;
  }
}
