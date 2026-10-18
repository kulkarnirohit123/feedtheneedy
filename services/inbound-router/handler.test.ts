import { handler } from './handler';
import * as dynamo from '../shared/dynamo';
import * as donor from './donorHandler';
import * as driver from './driverHandler';

jest.mock('../shared/dynamo');
jest.mock('./donorHandler');
jest.mock('./driverHandler');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedDonor = donor as jest.Mocked<typeof donor>;
const mockedDriver = driver as jest.Mocked<typeof driver>;

beforeEach(() => jest.clearAllMocks());

function webhookEvent(fromPhone: string, text: string) {
  return {
    body: JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: fromPhone, text: { body: text } }] } }] }],
    }),
  } as never;
}

test('unknown phone routes to donor handler', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  const res = await handler(webhookEvent('+91999', 'leftover food'));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledTimes(1);
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: 'wamid.1', fromPhone: '+91999', text: 'leftover food' }),
  );
  expect(mockedDriver.handleDriverMessage).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('known driver phone routes to driver handler even when currently busy', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(
    { driverId: 'd1', phone: '+91driver', name: 'A', currentGeo: { lat: 0, lng: 0 }, status: 'busy', lastActive: 'now' } as never,
  );
  const res = await handler(webhookEvent('+91driver', 'ACCEPT'));
  expect(mockedDriver.handleDriverMessage).toHaveBeenCalledTimes(1);
  expect(mockedDriver.handleDriverMessage).toHaveBeenCalledWith({
    fromPhone: '+91driver',
    text: 'ACCEPT',
    mediaUrl: undefined,
  });
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});
