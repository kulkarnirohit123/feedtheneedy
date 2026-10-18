import { handler } from './notifyDriverAndWait';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

test('looks up the driver phone by id and notifies the driver, not the raw driverId', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-1',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 1, lng: 2 },
  } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);

  await handler({ requestId: 'req-1', driverId: 'd1', taskToken: 'tok-abc' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+919111111111',
    expect.stringContaining('20 plates'),
  );
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'DRIVER_ASSIGNED',
    driverId: 'd1',
    pendingTaskToken: 'tok-abc',
    pendingStep: 'ACCEPT',
  }));
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'busy');
});

test('throws if the assigned driverId has no matching driver record', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', qty: '1', foodType: 'x', geo: { lat: 0, lng: 0 } } as never);
  mockedDynamo.getDriverById.mockResolvedValue(null);

  await expect(handler({ requestId: 'req-1', driverId: 'ghost', taskToken: 'tok-abc' })).rejects.toThrow();
});
