// services/pipeline/handlePickupPhoto.test.ts
import { startWait, handleResult, handler, InvalidPhotoError } from './handlePickupPhoto';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

test('startWait prompts the assigned driver for a photo and stores pending step and task token', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1' } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);

  await startWait({ requestId: 'req-1', taskToken: 'tok-1' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith('+919111111111', expect.stringContaining('photo'));
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    status: 'DRIVER_ACCEPTED',
    pendingTaskToken: 'tok-1',
    pendingStep: 'PICKUP_PHOTO',
  });
});

test('startWait is where DRIVER_ACCEPTED is recorded — it runs once the ACCEPT has resolved', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1' } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);

  await startWait({ requestId: 'req-1', taskToken: 'tok-1' });

  expect(mockedDynamo.updateRequest.mock.calls[0][1].status).toBe('DRIVER_ACCEPTED');
});

test('handler is an alias for startWait, used as the deployed Lambda entrypoint', () => {
  expect(handler).toBe(startWait);
});

test('handleResult with a valid media url confirms the photo', async () => {
  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:123' });
  expect(result.valid).toBe(true);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'PICKUP_PHOTO_CONFIRMED',
    pickupPhotoUrl: 'media:123',
  }));
});

test('handleResult with no media url throws InvalidPhotoError for Retry to catch', async () => {
  await expect(handleResult({ requestId: 'req-1' })).rejects.toThrow(InvalidPhotoError);
});
