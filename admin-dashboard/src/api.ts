import { getIdToken, signOut } from './auth';

const API_BASE = import.meta.env.VITE_ADMIN_API_URL as string;

export interface FoodRequest {
  requestId: string;
  status: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  driverId?: string;
}

export class SessionExpiredError extends Error {}

function authHeaders(): Record<string, string> {
  const token = getIdToken();
  return token ? { Authorization: token } : {};
}

async function checkResponse(res: Response): Promise<Response> {
  if (res.status === 401) {
    signOut();
    throw new SessionExpiredError('Session expired, please sign in again.');
  }
  return res;
}

export async function fetchRequests(): Promise<FoodRequest[]> {
  const res = await checkResponse(await fetch(`${API_BASE}/requests`, { headers: authHeaders() }));
  const body = await res.json();
  return body.requests;
}

export async function overrideAssign(requestId: string, driverId: string): Promise<void> {
  await checkResponse(
    await fetch(`${API_BASE}/requests/assign`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, driverId }),
    }),
  );
}
