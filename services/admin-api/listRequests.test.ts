import { handler } from './listRequests';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('returns all requests from the scan as a proxy-shaped response', async () => {
  mockedDynamo.scanAllRequests.mockResolvedValue([{ requestId: 'req-1', status: 'MATCHING' }] as never);
  const result = await handler({} as never);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).requests).toHaveLength(1);
});
