import { getIdToken } from './auth';

const API_BASE = import.meta.env.VITE_ADMIN_API_URL as string;

export interface FoodRequest {
  requestId: string;
  status: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  driverId?: string;
}

function authHeaders(): Record<string, string> {
  const token = getIdToken();
  return token ? { Authorization: token } : {};
}

export async function fetchRequests(): Promise<FoodRequest[]> {
  const res = await fetch(`${API_BASE}/requests`, { headers: authHeaders() });
  const body = await res.json();
  return body.requests;
}

export async function overrideAssign(requestId: string, driverId: string): Promise<void> {
  await fetch(`${API_BASE}/requests/assign`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, driverId }),
  });
}
