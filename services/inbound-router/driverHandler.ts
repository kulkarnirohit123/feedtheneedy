import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { findActiveRequestByDriverPhone } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { handleResult as handlePickupResult, InvalidPhotoError } from '../pipeline/handlePickupPhoto';
import { handleResult as handleFridgeResult } from '../pipeline/handleFridgePhoto';

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

  // A photo arriving on a non-photo step (e.g. ACCEPT) is always misfiled — re-prompt
  // without touching the task token. A *missing* photo on a photo step, however, must
  // still flow into validation below so InvalidPhotoError can SendTaskFailure for Retry.
  if (!isPhotoStep && gotPhoto) {
    await sendWhatsAppText(input.fromPhone, "We're waiting for ACCEPT or DECLINE on this pickup. Please resend.");
    return;
  }

  if (isPhotoStep) {
    const validate = req.pendingStep === 'PICKUP_PHOTO' ? handlePickupResult : handleFridgeResult;
    try {
      const result = await validate({ requestId: req.requestId, mediaUrl: input.mediaUrl });
      await sfn.send(
        new SendTaskSuccessCommand({ taskToken: req.pendingTaskToken, output: JSON.stringify(result) }),
      );
    } catch (err) {
      if (err instanceof InvalidPhotoError) {
        await sendWhatsAppText(input.fromPhone, "That didn't look like a valid photo — please resend.");
        await sfn.send(
          new SendTaskFailureCommand({
            taskToken: req.pendingTaskToken,
            error: 'InvalidPhotoError',
            cause: err.message,
          }),
        );
        return;
      }
      throw err;
    }
    return;
  }

  await sfn.send(
    new SendTaskSuccessCommand({
      taskToken: req.pendingTaskToken,
      output: JSON.stringify({ requestId: req.requestId, reply: input.text ?? 'PHOTO' }),
    }),
  );
}
