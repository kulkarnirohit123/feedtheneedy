import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { Dashboard } from './Dashboard';
import * as api from '../api';

vi.mock('../api');
const mockedApi = vi.mocked(api);

beforeEach(() => vi.clearAllMocks());

/** The reassign form has no default driver any more, so every override types one first. */
function reassignTo(driverId: string) {
  fireEvent.change(screen.getByLabelText(/driver id/i), { target: { value: driverId } });
  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));
}

test('renders fetched requests and triggers override assign with the typed driver', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'DRIVER_ASSIGNED', donorPhone: '+91999', qty: '20 plates', foodType: 'vada pav' } as never,
  ]);
  mockedApi.overrideAssign.mockResolvedValue();

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());
  reassignTo('driver-7');

  await waitFor(() => expect(mockedApi.overrideAssign).toHaveBeenCalledWith('req-1', 'driver-7'));
});

test('reassign stays disabled until a driver id is entered', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'MATCHING', donorPhone: '+91999', qty: '1 plate', foodType: 'rice' } as never,
  ]);

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /reassign/i })).toBeDisabled();
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

  await waitFor(() => expect(screen.getAllByText('driver-1').length).toBeGreaterThan(0));
  reassignTo('driver-2');

  await waitFor(() => expect(screen.getAllByText('driver-2').length).toBeGreaterThan(0));
  expect(screen.queryByText('driver-1')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(/reassigned to driver-2/i);
  expect(mockedApi.fetchRequests).toHaveBeenCalledTimes(2);
});

test('a failed reassign shows a visible error instead of swallowing it', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'MATCHING', donorPhone: '+91999', qty: '1 plate', foodType: 'rice' } as never,
  ]);
  mockedApi.overrideAssign.mockRejectedValue(new Error('Request to /requests/assign failed with status 404'));

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());
  reassignTo('driver-9');

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
  reassignTo('driver-2');

  await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
});

test('reassign is not offered once the driver has accepted', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'DRIVER_ACCEPTED', donorPhone: '+91999', qty: '1 plate', foodType: 'rice', driverId: 'driver-1' } as never,
  ]);

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/already accepted/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /reassign/i })).toBeNull();
});

test('stage tabs and search narrow the list', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'PENDING_REVIEW', donorPhone: '+91111', qty: '15 plates', foodType: 'biryani', locationText: 'Indiranagar' } as never,
    { requestId: 'req-2', status: 'COMPLETE', donorPhone: '+91222', qty: '50 chapatis', foodType: 'chapati', locationText: 'Whitefield' } as never,
  ]);

  render(<Dashboard />);

  await waitFor(() => expect(screen.getAllByText('15 plates of biryani').length).toBeGreaterThan(0));
  expect(screen.getAllByText('50 chapatis').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('tab', { name: /delivered/i }));
  expect(screen.queryByText('15 plates of biryani')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: /^all/i }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'indira' } });
  expect(screen.queryByText('50 chapatis')).toBeNull();
  expect(screen.getAllByText('15 plates of biryani').length).toBeGreaterThan(0);
});

test('requests are listed newest first', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'old', status: 'MATCHING', donorPhone: '+91111', qty: 'old offer', foodType: 'unknown', createdAt: '2026-10-01T10:00:00Z' } as never,
    { requestId: 'new', status: 'MATCHING', donorPhone: '+91222', qty: 'new offer', foodType: 'unknown', createdAt: '2026-10-02T10:00:00Z' } as never,
  ]);

  render(<Dashboard />);

  await waitFor(() => expect(screen.getAllByText('new offer').length).toBeGreaterThan(0));
  const rows = screen.getAllByRole('row').slice(1); // skip the header row
  expect(rows[0]).toHaveTextContent('new offer');
  expect(rows[1]).toHaveTextContent('old offer');
});
