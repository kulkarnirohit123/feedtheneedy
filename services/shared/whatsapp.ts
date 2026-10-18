import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';

const client = new SocialMessagingClient({});
const ORIGINATION_PHONE_NUMBER_ID = process.env.WHATSAPP_ORIGINATION_PHONE_NUMBER_ID ?? '';

export async function sendWhatsAppText(toPhone: string, body: string): Promise<void> {
  await client.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: ORIGINATION_PHONE_NUMBER_ID,
      message: new TextEncoder().encode(
        JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'text',
          text: { body },
        }),
      ),
      metaApiVersion: 'v19.0',
    }),
  );
}
