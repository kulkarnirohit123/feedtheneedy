import { handler } from './finalizeRequest';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('marks the request COMPLETE, frees the driver, writes history', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1' } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', { status: 'COMPLETE' });
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'available');
  expect(mockedDynamo.putDonationHistory).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('COMPLETE');
});
