import { getIdToken, signOut } from './auth';

const API_BASE = import.meta.env.VITE_ADMIN_API_URL as string;

export interface FoodRequest {
  requestId: string;
  status: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  driverId?: string;
  createdAt?: string;
  updatedAt?: string;
  locationText?: string;
  fridgeId?: string;
  reassignCount?: number;
  /** Set while a confident offer waits for the donor to share a WhatsApp location. */
  awaitingLocation?: boolean;
  pickupPhotoUrl?: string;
  fridgePhotoUrl?: string;
}

export class SessionExpiredError extends Error {}

function authHeaders(): Record<string, string> {
  const token = getIdToken();
  return token ? { Authorization: token } : {};
}

function expireSession(): never {
  signOut();
  throw new SessionExpiredError('Session expired, please sign in again.');
}

/**
 * Every call goes through here so that BOTH failure shapes land on the same recovery path:
 *
 *  - a readable 401 from the Cognito authorizer, and
 *  - a network-level fetch rejection.
 *
 * The second case is the one that bit us: API Gateway serves an authorizer rejection from its
 * DEFAULT_4XX gateway response, which carries no CORS header unless the stack adds one
 * explicitly. The browser then blocks the response before any code can read res.status, so
 * fetch rejects with an opaque TypeError and the 401 branch never runs. The CDK stack now adds
 * those headers, and this treats an unreadable response as a probable expiry anyway, so a
 * future missing-CORS regression degrades to "please sign in again" rather than a dead UI.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    expireSession();
  }

  if (res.status === 401 || res.status === 403) {
    expireSession();
  }
  if (!res.ok) {
    throw new Error(`Request to ${path} failed with status ${res.status}`);
  }
  return res;
}

export async function fetchRequests(): Promise<FoodRequest[]> {
  const res = await request('/requests', { headers: authHeaders() });
  const body = await res.json();
  return body.requests;
}

export async function overrideAssign(requestId: string, driverId: string): Promise<void> {
  await request('/requests/assign', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, driverId }),
  });
}
