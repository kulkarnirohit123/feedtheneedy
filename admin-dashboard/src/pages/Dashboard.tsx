import { useEffect, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest, SessionExpiredError } from '../api';
import { signOut } from '../auth';

const FALLBACK_DRIVER_ID = 'driver-2';
const NOOP = () => {};

export function Dashboard({ onSignedOut = NOOP }: { onSignedOut?: () => void }) {
  const [requests, setRequests] = useState<FoodRequest[]>([]);

  useEffect(() => {
    fetchRequests()
      .then(setRequests)
      .catch((err) => {
        if (err instanceof SessionExpiredError) onSignedOut();
      });
  }, [onSignedOut]);

  async function handleReassign(requestId: string) {
    try {
      await overrideAssign(requestId, FALLBACK_DRIVER_ID);
    } catch (err) {
      if (err instanceof SessionExpiredError) onSignedOut();
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
      <ul>
        {requests.map((r) => (
          <li key={r.requestId}>
            {r.requestId} — {r.status} — {r.qty} of {r.foodType}
            <button onClick={() => handleReassign(r.requestId)}>Reassign</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
