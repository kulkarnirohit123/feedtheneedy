import { getRequest, updateRequest, updateDriverStatus } from '../shared/dynamo';

const MAX_REASSIGNS = 2;

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; reassignCount: number; shouldAlertAdmin: boolean }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  if (req.driverId) {
    await updateDriverStatus(req.driverId, 'available');
  }

  const reassignCount = req.reassignCount + 1;
  const shouldAlertAdmin = reassignCount >= MAX_REASSIGNS;
  const triedDriverIds = req.driverId
    ? [...(req.triedDriverIds ?? []), req.driverId]
    : (req.triedDriverIds ?? []);

  await updateRequest(event.requestId, {
    reassignCount,
    triedDriverIds,
    status: shouldAlertAdmin ? 'PENDING_REVIEW' : 'MATCHING',
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, reassignCount, shouldAlertAdmin };
}
