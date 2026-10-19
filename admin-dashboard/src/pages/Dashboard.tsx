import { useEffect, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest } from '../api';

const FALLBACK_DRIVER_ID = 'driver-2';

export function Dashboard() {
  const [requests, setRequests] = useState<FoodRequest[]>([]);

  useEffect(() => {
    fetchRequests().then(setRequests);
  }, []);

  async function handleReassign(requestId: string) {
    await overrideAssign(requestId, FALLBACK_DRIVER_ID);
  }

  return (
    <div>
      <h1>Live Pickup Requests</h1>
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
