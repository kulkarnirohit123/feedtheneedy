import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDriverByPhone } from '../shared/dynamo';
import { handleDonorMessage } from './donorHandler';
import { handleDriverMessage } from './driverHandler';

interface ParsedWebhookMessage {
  messageId: string;
  fromPhone: string;
  text?: string;
  mediaUrl?: string;
  geo?: { lat: number; lng: number };
}

function parseWebhookBody(body: string): ParsedWebhookMessage {
  const payload = JSON.parse(body);
  const entry = payload.entry[0].changes[0].value.messages[0];
  const contact = payload.entry[0].changes[0].value.contacts?.[0];
  return {
    messageId: entry.id,
    fromPhone: entry.from,
    text: entry.text?.body,
    mediaUrl: entry.image?.id ? `media:${entry.image.id}` : undefined,
    geo: contact?.location ? { lat: contact.location.latitude, lng: contact.location.longitude } : undefined,
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseWebhookBody(event.body ?? '{}');

  const driver = await getDriverByPhone(parsed.fromPhone);

  if (driver) {
    await handleDriverMessage({ fromPhone: parsed.fromPhone, text: parsed.text, mediaUrl: parsed.mediaUrl });
  } else {
    await handleDonorMessage({
      messageId: parsed.messageId,
      fromPhone: parsed.fromPhone,
      text: parsed.text ?? '',
      geo: parsed.geo,
    });
  }

  return { statusCode: 200, body: 'OK' };
}
