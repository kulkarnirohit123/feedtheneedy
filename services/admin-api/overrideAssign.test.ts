import { handler } from './overrideAssign';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

function event(body: unknown) {
  return { body: typeof body === 'string' ? body : JSON.stringify(body) } as never;
}

test('reassigns the request, frees the old driver, marks the new one busy, and notifies them', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-1',
    driverId: 'driver-1',
    qty: '20 plates',
    foodType: 'vada pav',
    locationText: 'Koramangala 5th Block',
    status: 'DRIVER_ASSIGNED',
    triedDriverIds: [],
  } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'driver-2', phone: '+91222' } as never);

  const result = await handler(event({ requestId: 'req-1', driverId: 'driver-2' }));

  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('driver-1', 'available');
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('driver-2', 'busy');
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    driverId: 'driver-2',
    status: 'DRIVER_ASSIGNED',
    triedDriverIds: ['driver-1'],
  });
  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+91222',
    expect.stringContaining('Koramangala 5th Block'),
  );
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body)).toEqual({
    requestId: 'req-1',
    driverId: 'driver-2',
    previousDriverId: 'driver-1',
  });
});

test('an unassigned request can be assigned without touching any previous driver', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-2',
    qty: '5 plates',
    foodType: 'rice',
    status: 'PENDING_REVIEW',
  } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'driver-3', phone: '+91333' } as never);

  const result = await handler(event({ requestId: 'req-2', driverId: 'driver-3' }));

  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledTimes(1);
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('driver-3', 'busy');
  expect(JSON.parse(result.body).previousDriverId).toBeNull();
});

test('a missing requestId or driverId is a clean 400, not a 502', async () => {
  expect((await handler(event({ requestId: 'req-1' }))).statusCode).toBe(400);
  expect((await handler(event({ driverId: 'driver-2' }))).statusCode).toBe(400);
  expect(mockedDynamo.updateRequest).not.toHaveBeenCalled();
});

test('a malformed JSON body is a clean 400', async () => {
  const result = await handler(event('{not json'));
  expect(result.statusCode).toBe(400);
  expect(mockedDynamo.updateRequest).not.toHaveBeenCalled();
});

test('an unknown request or driver is a 404 and changes nothing', async () => {
  mockedDynamo.getRequest.mockResolvedValue(null);
  expect((await handler(event({ requestId: 'nope', driverId: 'driver-2' }))).statusCode).toBe(404);

  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1' } as never);
  mockedDynamo.getDriverById.mockResolvedValue(null);
  expect((await handler(event({ requestId: 'req-1', driverId: 'ghost' }))).statusCode).toBe(404);

  expect(mockedDynamo.updateRequest).not.toHaveBeenCalled();
  expect(mockedWhatsapp.sendWhatsAppText).not.toHaveBeenCalled();
});
