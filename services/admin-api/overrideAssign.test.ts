import { handler } from './overrideAssign';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('reassigns a request to the given driver', async () => {
  const result = await handler({ requestId: 'req-1', driverId: 'driver-2' });
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', { driverId: 'driver-2' });
  expect(result).toEqual({ requestId: 'req-1', driverId: 'driver-2' });
});
