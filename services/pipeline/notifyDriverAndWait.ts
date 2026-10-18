import { getRequest, getDriverById, updateRequest, updateDriverStatus } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

export async function handler(event: {
  requestId: string;
  driverId: string;
  taskToken: string;
}): Promise<void> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  const driver = await getDriverById(event.driverId);
  if (!driver) throw new Error(`Driver not found: ${event.driverId}`);

  await sendWhatsAppText(
    driver.phone,
    `Pickup available: ${req.qty} of ${req.foodType}. Reply ACCEPT or DECLINE within 60 minutes.`,
  );

  await updateRequest(event.requestId, {
    status: 'DRIVER_ASSIGNED',
    driverId: event.driverId,
    pendingTaskToken: event.taskToken,
    pendingStep: 'ACCEPT',
  });

  await updateDriverStatus(event.driverId, 'busy');
}
