import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { handleDriverMessage } from './driverHandler';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp', () => ({ sendWhatsAppText: jest.fn() }));

const sfnMock = mockClient(SFNClient);
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedSendWhatsAppText = whatsapp.sendWhatsAppText as jest.Mock;

beforeEach(() => {
  sfnMock.reset();
  jest.clearAllMocks();
});

test('ACCEPT reply resumes the waiting ACCEPT step', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-123',
    pendingStep: 'ACCEPT',
    status: 'DRIVER_ASSIGNED',
  } as never);
  sfnMock.on(SendTaskSuccessCommand).resolves({});

  await handleDriverMessage({ fromPhone: '+91driver', text: 'ACCEPT' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(1);
  const call = sfnMock.commandCalls(SendTaskSuccessCommand)[0];
  expect(call.args[0].input.taskToken).toBe('token-123');
  expect(JSON.parse(call.args[0].input.output as string)).toEqual({
    requestId: 'req-1',
    reply: 'ACCEPT',
    mediaUrl: undefined,
  });
});

test('photo arriving while waiting on ACCEPT is rejected with a re-prompt, not misfiled', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-123',
    pendingStep: 'ACCEPT',
    status: 'DRIVER_ASSIGNED',
  } as never);

  await handleDriverMessage({ fromPhone: '+91driver', mediaUrl: 'https://media/photo.jpg' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  expect(mockedSendWhatsAppText).toHaveBeenCalledWith(
    '+91driver',
    expect.stringMatching(/ACCEPT.*DECLINE|ACCEPT or DECLINE/i),
  );
});

test('ACCEPT text arriving while waiting on PICKUP_PHOTO is rejected with a re-prompt for a photo', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-456',
    pendingStep: 'PICKUP_PHOTO',
    status: 'DRIVER_ACCEPTED',
  } as never);

  await handleDriverMessage({ fromPhone: '+91driver', text: 'ACCEPT' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  expect(mockedSendWhatsAppText).toHaveBeenCalledWith(
    '+91driver',
    expect.stringMatching(/photo/i),
  );
});

test('driver reply with no active request logs and replies gracefully, no crash', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue(null);

  await expect(handleDriverMessage({ fromPhone: '+91driver', text: 'ACCEPT' })).resolves.not.toThrow();
  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  expect(mockedSendWhatsAppText).toHaveBeenCalledWith(
    '+91driver',
    expect.stringMatching(/no pending|don't have a pending/i),
  );
});

test('valid pickup photo reply validates via handleResult then resolves the task token', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-456',
    pendingStep: 'PICKUP_PHOTO',
    status: 'DRIVER_ACCEPTED',
  } as never);
  sfnMock.on(SendTaskSuccessCommand).resolves({});

  await handleDriverMessage({ fromPhone: '+91driver', mediaUrl: 'media:abc' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(1);
});

test('missing-media pickup photo reply fails the task token with InvalidPhotoError for Retry', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-456',
    pendingStep: 'PICKUP_PHOTO',
    status: 'DRIVER_ACCEPTED',
  } as never);
  sfnMock.on(SendTaskFailureCommand).resolves({});

  await handleDriverMessage({ fromPhone: '+91driver', mediaUrl: '' });

  const calls = sfnMock.commandCalls(SendTaskFailureCommand);
  expect(calls).toHaveLength(1);
  expect(calls[0].args[0].input.error).toBe('InvalidPhotoError');
});
