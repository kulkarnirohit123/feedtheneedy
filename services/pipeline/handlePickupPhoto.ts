// services/pipeline/handlePickupPhoto.ts
import { getRequest, getDriverById, updateRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { persistWhatsAppMedia } from '../shared/media';

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

  // This state is only reached once the driver's ACCEPT has resolved the previous wait, so
  // this is the single point where DRIVER_ACCEPTED is observable — without it the status
  // jumped straight from DRIVER_ASSIGNED to PICKUP_PHOTO_CONFIRMED.
  await updateRequest(event.requestId, {
    status: 'DRIVER_ACCEPTED',
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

  // A `media:<id>` token is a short-lived Meta handle, not a durable URL — archive the actual
  // bytes in the photos bucket and store that key. Falls back to the raw reference if the
  // archive fails (see persistWhatsAppMedia for why that beats wedging the pickup).
  const s3Key = await persistWhatsAppMedia(event.mediaUrl, `photos/${event.requestId}/pickup`);
  const pickupPhotoUrl = s3Key ?? event.mediaUrl;

  await updateRequest(event.requestId, {
    status: 'PICKUP_PHOTO_CONFIRMED',
    pickupPhotoUrl,
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, valid: true, pickupPhotoUrl };
}

export const handler = startWait;
