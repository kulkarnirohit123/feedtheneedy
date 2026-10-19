import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { Dashboard } from './Dashboard';
import * as api from '../api';

vi.mock('../api');
const mockedApi = vi.mocked(api);

beforeEach(() => vi.clearAllMocks());

test('renders fetched requests and triggers override assign on click', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'DRIVER_ASSIGNED', donorPhone: '+91999', qty: '20 plates', foodType: 'vada pav' } as never,
  ]);
  mockedApi.overrideAssign.mockResolvedValue();

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));

  await waitFor(() => expect(mockedApi.overrideAssign).toHaveBeenCalledWith('req-1', expect.any(String)));
});

test('does not re-fetch on re-render when onSignedOut is omitted', async () => {
  mockedApi.fetchRequests.mockImplementation(() =>
    // A fresh array reference every call, so a setState bailout on reference
    // equality can't mask a bug that re-fires the effect.
    Promise.resolve([
      { requestId: 'req-1', status: 'MATCHING', donorPhone: '+91999', qty: '1 plate', foodType: 'rice' } as never,
    ]),
  );

  const { rerender } = render(<Dashboard />);
  await waitFor(() => expect(mockedApi.fetchRequests).toHaveBeenCalledTimes(1));

  rerender(<Dashboard />);

  // Give a wrongly re-fired effect a chance to resolve before asserting it didn't happen.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mockedApi.fetchRequests).toHaveBeenCalledTimes(1);
});

test('a successful reassign refetches the list so the UI reflects the change', async () => {
  mockedApi.fetchRequests
    .mockResolvedValueOnce([
      { requestId: 'req-1', status: 'DRIVER_ASSIGNED', donorPhone: '+91999', qty: '20 plates', foodType: 'vada pav', driverId: 'driver-1' } as never,
    ])
    .mockResolvedValueOnce([
      { requestId: 'req-1', status: 'DRIVER_ASSIGNED', donorPhone: '+91999', qty: '20 plates', foodType: 'vada pav', driverId: 'driver-2' } as never,
    ]);
  mockedApi.overrideAssign.mockResolvedValue();

  render(<Dashboard />);
  await waitFor(() => expect(screen.getByText(/driver-1/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));

  await waitFor(() => expect(screen.getByText(/driver-2/)).toBeInTheDocument());
  expect(mockedApi.fetchRequests).toHaveBeenCalledTimes(2);
});

test('a failed reassign shows a visible error instead of swallowing it', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'MATCHING', donorPhone: '+91999', qty: '1 plate', foodType: 'rice' } as never,
  ]);
  mockedApi.overrideAssign.mockRejectedValue(new Error('Request to /requests/assign failed with status 404'));

  render(<Dashboard />);
  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/404/));
});

test('a failed load shows a visible error', async () => {
  mockedApi.fetchRequests.mockRejectedValue(new Error('Request to /requests failed with status 500'));
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/500/));
});

test('a session expiry during reassign signs the admin out', async () => {
  class FakeSessionExpired extends Error {}
  // vi.mock replaces the module's class too, so use the mocked module's own export.
  const SessionExpiredError = api.SessionExpiredError ?? FakeSessionExpired;
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'MATCHING', donorPhone: '+91999', qty: '1 plate', foodType: 'rice' } as never,
  ]);
  mockedApi.overrideAssign.mockRejectedValue(new SessionExpiredError('expired'));
  const onSignedOut = vi.fn();

  render(<Dashboard onSignedOut={onSignedOut} />);
  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));

  await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
});
