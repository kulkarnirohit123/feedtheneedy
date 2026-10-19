import { createHmac, timingSafeEqual } from 'crypto';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDriverByPhone } from '../shared/dynamo';
import { handleDonorMessage } from './donorHandler';
import { handleDriverMessage } from './driverHandler';

// Meta App Secret / webhook verify token are provisioned in the Meta app console, not by this
// CDK app, so they arrive as env vars wired through CDK context with empty-string defaults
// (same seam as CLASSIFIER_AGENT_ID). Read lazily so a post-deploy console edit takes effect
// on the next cold start without a redeploy, and so tests can set them per-case.
function appSecret(): string {
  return process.env.META_APP_SECRET ?? '';
}

function verifyToken(): string {
  return process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
}

const FORBIDDEN: APIGatewayProxyResult = { statusCode: 403, body: 'Forbidden' };
const OK: APIGatewayProxyResult = { statusCode: 200, body: 'OK' };

interface ParsedWebhookMessage {
  messageId: string;
  fromPhone: string;
  text?: string;
  mediaUrl?: string;
  geo?: { lat: number; lng: number };
}

/** API Gateway preserves the client's header casing, and Meta's casing isn't contractual. */
function header(event: APIGatewayProxyEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key] ?? undefined;
  }
  return undefined;
}

/**
 * Meta signs every webhook POST with HMAC-SHA256 of the raw body keyed by the App Secret,
 * delivered as `X-Hub-Signature-256: sha256=<hex>`. Without this check the endpoint is a public
 * command channel: anyone could forge a donor offer or hijack a driver's live task token.
 *
 * Fails closed when META_APP_SECRET is unset — an unconfigured secret means we cannot
 * distinguish Meta from an attacker, so refusing is the only safe answer.
 */
export function verifySignature(event: APIGatewayProxyEvent): boolean {
  const secret = appSecret();
  if (!secret) {
    console.error('META_APP_SECRET is not configured — rejecting webhook delivery');
    return false;
  }

  const provided = header(event, 'x-hub-signature-256');
  if (!provided || !provided.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(event.body ?? '', 'utf8').digest('hex');
  const providedHex = provided.slice('sha256='.length);
  if (providedHex.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // Non-hex signature — Buffer.from silently truncates, so lengths can mismatch here.
    return false;
  }
}

/**
 * Meta's registration handshake: it GETs the webhook URL with hub.mode/hub.verify_token/
 * hub.challenge and expects the raw challenge echoed back when the token matches.
 */
export function handleVerification(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const params = event.queryStringParameters ?? {};
  const expected = verifyToken();
  if (
    expected &&
    params['hub.mode'] === 'subscribe' &&
    params['hub.verify_token'] === expected &&
    params['hub.challenge']
  ) {
    return { statusCode: 200, body: params['hub.challenge'] as string };
  }
  return FORBIDDEN;
}

/**
 * Returns null for any delivery that isn't an inbound user message — most notably the
 * sent/delivered/read status callbacks, which carry `value.statuses` instead of
 * `value.messages` and fire several times per outbound message (i.e. far more often than
 * the happy path). Every hop is optional-chained because Meta's envelope shape varies by
 * notification type.
 */
export function parseWebhookBody(body: string): ParsedWebhookMessage | null {
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }

  const entry = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!entry) return null;

  // WhatsApp location messages carry the coordinates on the message itself as
  // latitude/longitude — NOT on contacts[0].location, and not as lat/lng.
  const location = entry.location;
  const hasGeo = typeof location?.latitude === 'number' && typeof location?.longitude === 'number';

  return {
    messageId: entry.id,
    fromPhone: entry.from,
    text: entry.text?.body,
    mediaUrl: entry.image?.id ? `media:${entry.image.id}` : undefined,
    geo: hasGeo ? { lat: location.latitude, lng: location.longitude } : undefined,
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'GET') {
    return handleVerification(event);
  }

  if (!verifySignature(event)) {
    return FORBIDDEN;
  }

  // Everything past the auth boundary returns 200 no matter what: a 5xx makes Meta retry the
  // same delivery with backoff, which turns one bad payload into a retry storm and, worse,
  // can re-drive side effects. Failures are logged for CloudWatch instead.
  try {
    const parsed = parseWebhookBody(event.body ?? '{}');
    if (!parsed) {
      return OK;
    }

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
  } catch (err) {
    console.error('Failed to process webhook delivery', err);
  }

  return OK;
}
