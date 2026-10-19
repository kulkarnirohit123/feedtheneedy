// services/pipeline/handleFridgePhoto.test.ts
import { startWait, handleResult, handler } from './handleFridgePhoto';
import { InvalidPhotoError } from './handlePickupPhoto';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';
import * as media from '../shared/media';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');
jest.mock('../shared/media');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;
const mockedMedia = media as jest.Mocked<typeof media>;

beforeEach(() => jest.clearAllMocks());

test('startWait prompts the assigned driver and stores pending fridge-photo step', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1' } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);

  await startWait({ requestId: 'req-1', taskToken: 'tok-2' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith('+919111111111', expect.stringContaining('fridge'));
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    pendingTaskToken: 'tok-2',
    pendingStep: 'FRIDGE_PHOTO',
  });
});

test('startWait tells the driver WHICH fridge to drop at, by name and address', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1', fridgeId: 'f1' } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);
  mockedDynamo.getFridgeById.mockResolvedValue({
    fridgeId: 'f1',
    name: 'Indiranagar Community Fridge',
    address: '100ft Road, Indiranagar',
  } as never);

  await startWait({ requestId: 'req-1', taskToken: 'tok-2' });

  expect(mockedDynamo.getFridgeById).toHaveBeenCalledWith('f1');
  const [, message] = mockedWhatsapp.sendWhatsAppText.mock.calls[0];
  expect(message).toContain('Indiranagar Community Fridge');
  expect(message).toContain('100ft Road, Indiranagar');
});

test('startWait falls back to the generic prompt when the fridge record is unavailable', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1', fridgeId: 'f-missing' } as never);
  mockedDynamo.getDriverById.mockResolvedValue({ driverId: 'd1', phone: '+919111111111' } as never);
  mockedDynamo.getFridgeById.mockResolvedValue(null);

  await startWait({ requestId: 'req-1', taskToken: 'tok-2' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+919111111111',
    'Please send a photo of the food stored in the fridge to confirm.',
  );
});

test('handler is an alias for startWait', () => {
  expect(handler).toBe(startWait);
});

test('handleResult with valid media url confirms fridge drop', async () => {
  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:456' });
  expect(result.valid).toBe(true);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'FRIDGE_PHOTO_CONFIRMED',
    fridgePhotoUrl: 'media:456',
  }));
});

test('handleResult with missing media url throws InvalidPhotoError', async () => {
  await expect(handleResult({ requestId: 'req-1' })).rejects.toThrow(InvalidPhotoError);
});

test('handleResult archives the fridge photo in S3 and stores the resulting key', async () => {
  mockedMedia.persistWhatsAppMedia.mockResolvedValue('photos/req-1/fridge.jpg');

  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:456' });

  expect(mockedMedia.persistWhatsAppMedia).toHaveBeenCalledWith('media:456', 'photos/req-1/fridge');
  expect(result.fridgePhotoUrl).toBe('photos/req-1/fridge.jpg');
});

test('a failed fridge-photo archive falls back to the raw media reference', async () => {
  mockedMedia.persistWhatsAppMedia.mockResolvedValue(null);
  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:456' });
  expect(result.fridgePhotoUrl).toBe('media:456');
});
