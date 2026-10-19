import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { Dashboard } from './Dashboard';
import * as api from '../api';

vi.mock('../api');
const mockedApi = vi.mocked(api);

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
