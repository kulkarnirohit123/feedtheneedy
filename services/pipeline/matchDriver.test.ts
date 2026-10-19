import { handler } from './matchDriver';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('picks the nearest available driver', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', geo: { lat: 12.9716, lng: 77.6412 } } as never);
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'far', phone: 'p1', name: 'Far', currentGeo: { lat: 13.1, lng: 77.9 }, status: 'available', lastActive: 'now' },
    { driverId: 'near', phone: 'p2', name: 'Near', currentGeo: { lat: 12.972, lng: 77.64 }, status: 'available', lastActive: 'now' },
  ] as never);

  const result = await handler({ requestId: 'req-1' });

  expect(result.driverId).toBe('near');
});

test('returns null driverId when no drivers available', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', geo: { lat: 0, lng: 0 } } as never);
  mockedDynamo.getAvailableDrivers.mockResolvedValue([]);
  const result = await handler({ requestId: 'req-1' });
  expect(result.driverId).toBeNull();
});

test('excludes driver ids already tried for this request', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-1',
    geo: { lat: 12.9716, lng: 77.6412 },
    triedDriverIds: ['near'],
  } as never);
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'near', phone: 'p2', name: 'Near', currentGeo: { lat: 12.972, lng: 77.64 }, status: 'available', lastActive: 'now' },
  ] as never);
  const result = await handler({ requestId: 'req-1' });
  expect(result.driverId).toBeNull();
});

test('a request with no donor geo returns a null driverId instead of picking an arbitrary driver', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-nogeo' } as never);
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'd1', phone: 'p1', name: 'A', currentGeo: { lat: 1, lng: 1 }, status: 'available', lastActive: 'now' },
  ] as never);

  const result = await handler({ requestId: 'req-nogeo' });

  expect(result.driverId).toBeNull();
  expect(mockedDynamo.getAvailableDrivers).not.toHaveBeenCalled();
});
