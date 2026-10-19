import { handler } from './overrideAssign';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('parses the proxy event body and reassigns a request to the given driver', async () => {
  const event = { body: JSON.stringify({ requestId: 'req-1', driverId: 'driver-2' }) } as never;
  const result = await handler(event);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', { driverId: 'driver-2' });
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body)).toEqual({ requestId: 'req-1', driverId: 'driver-2' });
});
