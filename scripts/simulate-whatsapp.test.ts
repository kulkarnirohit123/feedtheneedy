import { buildWebhookPayload } from './simulate-whatsapp';

test('builds a Meta-shaped webhook payload for a given sender and text', () => {
  const payload = buildWebhookPayload('+91999', '20 vada pav leftover in Koramangala');
  const message = (payload as never as { entry: { changes: { value: { messages: { from: string; text: { body: string } }[] } }[] }[] })
    .entry[0].changes[0].value.messages[0];
  expect(message.from).toBe('+91999');
  expect(message.text.body).toContain('vada pav');
});
