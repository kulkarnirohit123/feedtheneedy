import { getRequest, updateRequest, updateDriverStatus } from '../shared/dynamo';

/**
 * Terminal "this request can no longer progress automatically" step.
 *
 * Reached from three different dead ends in the state machine:
 *  - a photo wait that exhausted its InvalidPhotoError retries (Catch on States.ALL),
 *  - MatchDriver returning a null driverId (no driver, or no donor geo),
 *  - MatchFridge returning a null fridgeId.
 *
 * In every one of those cases the request was previously left mid-flow with a stale
 * pendingTaskToken and — worse — its driver pinned to `busy` forever, silently shrinking
 * the fleet. This flags the request for an admin and frees the driver.
 *
 * Deliberately takes nothing but {requestId} so all three call sites can share it, and
 * deliberately does NOT re-enter matching (unlike reassignDriver), so it cannot loop when
 * the driver pool is empty from the start.
 */
export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; status: 'PENDING_REVIEW' }> {
  const req = await getRequest(event.requestId);

  if (!req) {
    console.error(`flagStuckRequest: request not found: ${event.requestId}`);
    return { requestId: event.requestId, status: 'PENDING_REVIEW' };
  }

  if (req.driverId) {
    await updateDriverStatus(req.driverId, 'available');
  }

  await updateRequest(event.requestId, {
    status: 'PENDING_REVIEW',
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, status: 'PENDING_REVIEW' };
}
