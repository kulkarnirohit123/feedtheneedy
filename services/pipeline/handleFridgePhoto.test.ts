// services/pipeline/handleFridgePhoto.test.ts
import { startWait, handleResult, handler } from './handleFridgePhoto';
import { InvalidPhotoError } from './handlePickupPhoto';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

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
