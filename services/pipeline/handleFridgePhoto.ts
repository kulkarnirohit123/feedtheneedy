// services/pipeline/handleFridgePhoto.ts
import { getRequest, getDriverById, updateRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { InvalidPhotoError } from './handlePickupPhoto';

export async function startWait(event: { requestId: string; taskToken: string }): Promise<void> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);
  if (req.driverId) {
    const driver = await getDriverById(req.driverId);
    if (driver) {
      await sendWhatsAppText(driver.phone, 'Please send a photo of the food stored in the fridge to confirm.');
    }
  }

  await updateRequest(event.requestId, {
    pendingTaskToken: event.taskToken,
    pendingStep: 'FRIDGE_PHOTO',
  });
}

export async function handleResult(
  event: { requestId: string; mediaUrl?: string },
): Promise<{ requestId: string; valid: boolean; fridgePhotoUrl?: string }> {
  if (!event.mediaUrl) {
    throw new InvalidPhotoError('No media URL in driver reply');
  }

  await updateRequest(event.requestId, {
    status: 'FRIDGE_PHOTO_CONFIRMED',
    fridgePhotoUrl: event.mediaUrl,
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, valid: true, fridgePhotoUrl: event.mediaUrl };
}

export const handler = startWait;
