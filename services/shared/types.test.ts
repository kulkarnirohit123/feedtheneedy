import { FoodRequest, RequestStatus } from './types';

test('FoodRequest accepts a full valid record', () => {
  const r: FoodRequest = {
    requestId: 'req-1',
    donorPhone: '+919999999999',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 12.9716, lng: 77.5946 },
    status: 'RECEIVED' as RequestStatus,
    reassignCount: 0,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  };
  expect(r.status).toBe('RECEIVED');
});
