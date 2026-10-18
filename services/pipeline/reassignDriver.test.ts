import { handler } from './reassignDriver';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('first timeout increments reassignCount, frees driver, excludes the timed-out driver, does not alert admin', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1', reassignCount: 0, triedDriverIds: [] } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'available');
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    reassignCount: 1,
    triedDriverIds: ['d1'],
  }));
  expect(result.shouldAlertAdmin).toBe(false);
});

test('second consecutive timeout triggers admin alert', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd2', reassignCount: 1, triedDriverIds: ['d1'] } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(result.shouldAlertAdmin).toBe(true);
  expect(result.reassignCount).toBe(2);
});
