// services/pipeline/handlePickupPhoto.ts
import { getRequest, getDriverById, updateRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

export class InvalidPhotoError extends Error {}

export async function startWait(event: { requestId: string; taskToken: string }): Promise<void> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);
  if (req.driverId) {
    const driver = await getDriverById(req.driverId);
    if (driver) {
      await sendWhatsAppText(driver.phone, 'Please send a photo of the pickup to confirm.');
    }
  }

  await updateRequest(event.requestId, {
    pendingTaskToken: event.taskToken,
    pendingStep: 'PICKUP_PHOTO',
  });
}

export async function handleResult(
  event: { requestId: string; mediaUrl?: string },
): Promise<{ requestId: string; valid: boolean; pickupPhotoUrl?: string }> {
  if (!event.mediaUrl) {
    throw new InvalidPhotoError('No media URL in driver reply');
  }

  await updateRequest(event.requestId, {
    status: 'PICKUP_PHOTO_CONFIRMED',
    pickupPhotoUrl: event.mediaUrl,
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, valid: true, pickupPhotoUrl: event.mediaUrl };
}

export const handler = startWait;
