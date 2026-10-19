import { updateRequest } from '../shared/dynamo';

export async function handler(
  event: { requestId: string; driverId: string },
): Promise<{ requestId: string; driverId: string }> {
  await updateRequest(event.requestId, { driverId: event.driverId });
  return { requestId: event.requestId, driverId: event.driverId };
}
