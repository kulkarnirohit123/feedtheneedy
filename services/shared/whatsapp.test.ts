import { mockClient } from 'aws-sdk-client-mock';
import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { sendWhatsAppText } from './whatsapp';

const smMock = mockClient(SocialMessagingClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  smMock.reset();
  sqsMock.reset();
  delete process.env.WHATSAPP_DLQ_URL;
});

test('sends a text message via End User Messaging Social', async () => {
  smMock.on(SendWhatsAppMessageCommand).resolves({});
  await sendWhatsAppText('+919999999999', 'Thank you for sharing the information, driver will be available in next 60 minutes');
  const calls = smMock.commandCalls(SendWhatsAppMessageCommand);
  expect(calls).toHaveLength(1);

  const payload = JSON.parse(new TextDecoder().decode(calls[0].args[0].input.message as Uint8Array));
  expect(payload).toEqual({
    messaging_product: 'whatsapp',
    to: '+919999999999',
    type: 'text',
    text: { body: 'Thank you for sharing the information, driver will be available in next 60 minutes' },
  });
  expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
});

test('a failed send is parked on the DLQ and does not propagate', async () => {
  process.env.WHATSAPP_DLQ_URL = 'https://sqs.test/queue/whatsapp-dlq';
  smMock.on(SendWhatsAppMessageCommand).rejects(new Error('ThrottlingException'));
  sqsMock.on(SendMessageCommand).resolves({});

  await expect(sendWhatsAppText('+919999999999', 'Pickup available')).resolves.toBeUndefined();

  const dlqCalls = sqsMock.commandCalls(SendMessageCommand);
  expect(dlqCalls).toHaveLength(1);
  expect(dlqCalls[0].args[0].input.QueueUrl).toBe('https://sqs.test/queue/whatsapp-dlq');
  const parked = JSON.parse(dlqCalls[0].args[0].input.MessageBody as string);
  expect(parked).toEqual(
    expect.objectContaining({ toPhone: '+919999999999', body: 'Pickup available', error: 'ThrottlingException' }),
  );
});

test('a failed send rethrows when no DLQ is configured, rather than vanishing', async () => {
  smMock.on(SendWhatsAppMessageCommand).rejects(new Error('ThrottlingException'));
  await expect(sendWhatsAppText('+919999999999', 'Pickup available')).rejects.toThrow('ThrottlingException');
  expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
});

test('a failed send rethrows when the DLQ enqueue also fails', async () => {
  process.env.WHATSAPP_DLQ_URL = 'https://sqs.test/queue/whatsapp-dlq';
  smMock.on(SendWhatsAppMessageCommand).rejects(new Error('ThrottlingException'));
  sqsMock.on(SendMessageCommand).rejects(new Error('queue gone'));

  await expect(sendWhatsAppText('+919999999999', 'Pickup available')).rejects.toThrow('ThrottlingException');
});
