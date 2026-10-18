import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { findActiveRequestByDriverPhone } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

const sfn = new SFNClient({});

export interface InboundDriverMessage {
  fromPhone: string;
  text?: string;
  mediaUrl?: string;
}

export async function handleDriverMessage(input: InboundDriverMessage): Promise<void> {
  const req = await findActiveRequestByDriverPhone(input.fromPhone);

  if (!req || !req.pendingTaskToken || !req.pendingStep) {
    await sendWhatsAppText(
      input.fromPhone,
      "We don't have a pending pickup request for you right now.",
    );
    return;
  }

  const isPhotoStep = req.pendingStep === 'PICKUP_PHOTO' || req.pendingStep === 'FRIDGE_PHOTO';
  const gotPhoto = !!input.mediaUrl;

  if (isPhotoStep !== gotPhoto) {
    const expected = isPhotoStep ? 'a photo' : 'ACCEPT or DECLINE';
    await sendWhatsAppText(input.fromPhone, `We're waiting for ${expected} on this pickup. Please resend.`);
    return;
  }

  await sfn.send(
    new SendTaskSuccessCommand({
      taskToken: req.pendingTaskToken,
      output: JSON.stringify({ requestId: req.requestId, reply: input.text ?? 'PHOTO', mediaUrl: input.mediaUrl }),
    }),
  );
}
