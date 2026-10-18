import { getRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

const DONOR_ACK_TEXT =
  'Thank you for sharing the information, driver will be available in next 60 minutes';

export async function handler(event: { requestId: string }): Promise<{ requestId: string }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);
  await sendWhatsAppText(req.donorPhone, DONOR_ACK_TEXT);
  return { requestId: event.requestId };
}
