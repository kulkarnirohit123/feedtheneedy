import { getRequest, updateRequest, updateDriverStatus, putDonationHistory } from '../shared/dynamo';

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; status: 'COMPLETE' }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  await updateRequest(event.requestId, { status: 'COMPLETE' });

  if (req.driverId) {
    await updateDriverStatus(req.driverId, 'available');
  }

  const month = new Date().toISOString().slice(0, 7);
  await putDonationHistory({ ...req, status: 'COMPLETE', month });

  return { requestId: event.requestId, status: 'COMPLETE' };
}
