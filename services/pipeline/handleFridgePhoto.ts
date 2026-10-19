// services/pipeline/handleFridgePhoto.ts
import { getRequest, getDriverById, getFridgeById, updateRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { InvalidPhotoError } from './handlePickupPhoto';

export async function startWait(event: { requestId: string; taskToken: string }): Promise<void> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);
  if (req.driverId) {
    const driver = await getDriverById(req.driverId);
    if (driver) {
      // Naming the matched fridge is the only way the driver learns where to drop the food —
      // MatchFridge stores fridgeId on the request but never told anyone which fridge it is.
      const fridge = req.fridgeId ? await getFridgeById(req.fridgeId) : null;
      const destination = fridge ? `${fridge.name}, ${fridge.address}` : null;
      await sendWhatsAppText(
        driver.phone,
        destination
          ? `Drop the food at ${destination}. Please send a photo of the food stored in the fridge to confirm.`
          : 'Please send a photo of the food stored in the fridge to confirm.',
      );
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
