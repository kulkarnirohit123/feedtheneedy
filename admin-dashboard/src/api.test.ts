import { vi } from 'vitest';
import { fetchRequests, overrideAssign, SessionExpiredError } from './api';
import * as auth from './auth';

vi.mock('./auth', () => ({
  getIdToken: vi.fn(() => 'id-token'),
  signOut: vi.fn(),
}));

const mockedAuth = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.getIdToken.mockReturnValue('id-token');
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

test('fetchRequests attaches the id token and returns the request list', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ requests: [{ requestId: 'req-1' }] }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(fetchRequests()).resolves.toEqual([{ requestId: 'req-1' }]);
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'id-token' });
});

test('a 401 signs out and raises SessionExpiredError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

  await expect(fetchRequests()).rejects.toBeInstanceOf(SessionExpiredError);
  expect(mockedAuth.signOut).toHaveBeenCalled();
});

test('a network-level fetch rejection is also treated as an expired session, not an opaque crash', async () => {
  // This is what a CORS-blocked gateway response looks like to the browser: the status is
  // never readable, fetch just rejects with a TypeError.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  await expect(fetchRequests()).rejects.toBeInstanceOf(SessionExpiredError);
  expect(mockedAuth.signOut).toHaveBeenCalled();
});

test('a non-auth error status raises a readable error and does NOT sign the admin out', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

  await expect(fetchRequests()).rejects.toThrow(/status 500/);
  expect(mockedAuth.signOut).not.toHaveBeenCalled();
});

test('overrideAssign posts the requestId/driverId as JSON and surfaces a 404', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
  vi.stubGlobal('fetch', fetchMock);
  await overrideAssign('req-1', 'driver-2');
  const init = fetchMock.mock.calls[0][1];
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ requestId: 'req-1', driverId: 'driver-2' });

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
  await expect(overrideAssign('req-1', 'ghost')).rejects.toThrow(/status 404/);
});
