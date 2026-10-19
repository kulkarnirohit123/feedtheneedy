import { useCallback, useEffect, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest, SessionExpiredError } from '../api';
import { signOut } from '../auth';

/**
 * Known limitation: there is no driver picker, so an override always targets this one id. The
 * API accepts any driver id and now 404s an unknown one, so adding a <select> is a UI-only
 * change once a GET /drivers route exists.
 */
const FALLBACK_DRIVER_ID = 'driver-2';
const NOOP = () => {};

export function Dashboard({ onSignedOut = NOOP }: { onSignedOut?: () => void }) {
  const [requests, setRequests] = useState<FoodRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchRequests());
      setError(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load requests.');
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReassign(requestId: string) {
    setBusyRequestId(requestId);
    try {
      await overrideAssign(requestId, FALLBACK_DRIVER_ID);
      setError(null);
      // Refetch so the row actually shows the new driver/status — previously the click's
      // result was never reflected anywhere in the UI, success or failure.
      await load();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Reassign failed.');
    } finally {
      setBusyRequestId(null);
    }
  }

  function handleSignOut() {
    signOut();
    onSignedOut();
  }

  return (
    <div>
      <h1>Live Pickup Requests</h1>
      <button onClick={handleSignOut}>Sign out</button>
      <button onClick={() => void load()}>Refresh</button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {requests.map((r) => (
          <li key={r.requestId}>
            {r.requestId} — {r.status} — {r.qty} of {r.foodType}
            {r.driverId ? ` — ${r.driverId}` : ''}
            <button onClick={() => handleReassign(r.requestId)} disabled={busyRequestId === r.requestId}>
              Reassign
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
