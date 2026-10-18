import { mockClient } from 'aws-sdk-client-mock';
import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';
import { sendWhatsAppText } from './whatsapp';

const smMock = mockClient(SocialMessagingClient);

beforeEach(() => smMock.reset());

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
});
