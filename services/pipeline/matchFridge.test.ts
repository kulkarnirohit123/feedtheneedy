import { handler } from './matchFridge';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('picks the nearest fridge to the pickup point and persists the match', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', geo: { lat: 12.9716, lng: 77.6412 } } as never);
  mockedDynamo.getFridges.mockResolvedValue([
    { fridgeId: 'far', name: 'Far', address: 'x', geo: { lat: 13.1, lng: 77.9 }, capacity: 10 },
    { fridgeId: 'near', name: 'Near', address: 'y', geo: { lat: 12.935, lng: 77.6245 }, capacity: 10 },
  ] as never);

  const result = await handler({ requestId: 'req-1' });

  expect(result.fridgeId).toBe('near');
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    fridgeId: 'near',
    status: 'FRIDGE_MATCHED',
  });
});

test('returns null when no fridges configured, does not update the request', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', geo: { lat: 0, lng: 0 } } as never);
  mockedDynamo.getFridges.mockResolvedValue([]);
  const result = await handler({ requestId: 'req-1' });
  expect(result.fridgeId).toBeNull();
  expect(mockedDynamo.updateRequest).not.toHaveBeenCalled();
});
