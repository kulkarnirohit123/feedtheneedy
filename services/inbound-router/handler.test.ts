import { createHmac } from 'crypto';
import { handler } from './handler';
import * as dynamo from '../shared/dynamo';
import * as donor from './donorHandler';
import * as driver from './driverHandler';

jest.mock('../shared/dynamo');
jest.mock('./donorHandler');
jest.mock('./driverHandler');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedDonor = donor as jest.Mocked<typeof donor>;
const mockedDriver = driver as jest.Mocked<typeof driver>;

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
});

afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
});

function signedPost(body: string, secret = APP_SECRET) {
  const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return {
    httpMethod: 'POST',
    headers: { 'X-Hub-Signature-256': `sha256=${signature}` },
    body,
  } as never;
}

function messageBody(fromPhone: string, message: Record<string, unknown>) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: fromPhone, ...message }] } }] }],
  });
}

function webhookEvent(fromPhone: string, text: string) {
  return signedPost(messageBody(fromPhone, { text: { body: text } }));
}

test('unknown phone routes to donor handler', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  const res = await handler(webhookEvent('+91999', 'leftover food'));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledTimes(1);
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: 'wamid.1', fromPhone: '+91999', text: 'leftover food' }),
  );
  expect(mockedDriver.handleDriverMessage).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('known driver phone routes to driver handler even when currently busy', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(
    { driverId: 'd1', phone: '+91driver', name: 'A', currentGeo: { lat: 0, lng: 0 }, status: 'busy', lastActive: 'now' } as never,
  );
  const res = await handler(webhookEvent('+91driver', 'ACCEPT'));
  expect(mockedDriver.handleDriverMessage).toHaveBeenCalledTimes(1);
  expect(mockedDriver.handleDriverMessage).toHaveBeenCalledWith({
    fromPhone: '+91driver',
    text: 'ACCEPT',
    mediaUrl: undefined,
  });
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

// --- C2: signature verification ---

test('a POST with no X-Hub-Signature-256 header is rejected with 403 and never processed', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: messageBody('+91999', { text: { body: 'hi' } }) } as never);
  expect(res).toEqual({ statusCode: 403, body: 'Forbidden' });
  expect(mockedDynamo.getDriverByPhone).not.toHaveBeenCalled();
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});

test('a POST signed with the wrong secret is rejected with 403 and never processed', async () => {
  const res = await handler(signedPost(messageBody('+91999', { text: { body: 'hi' } }), 'attacker-secret'));
  expect(res.statusCode).toBe(403);
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});

test('a tampered body invalidates an otherwise-valid signature', async () => {
  const event = signedPost(messageBody('+91999', { text: { body: 'hi' } })) as any;
  event.body = messageBody('+91999', { text: { body: 'send the driver somewhere else' } });
  const res = await handler(event);
  expect(res.statusCode).toBe(403);
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});

test('header casing is not load-bearing — a lowercase signature header still verifies', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  const body = messageBody('+91999', { text: { body: 'leftover food' } });
  const signature = createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${signature}` },
    body,
  } as never);
  expect(res.statusCode).toBe(200);
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledTimes(1);
});

test('fails closed when META_APP_SECRET is unset rather than accepting unsigned traffic', async () => {
  delete process.env.META_APP_SECRET;
  const res = await handler(signedPost(messageBody('+91999', { text: { body: 'hi' } })));
  expect(res.statusCode).toBe(403);
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});

// --- C2: GET verification handshake ---

test('GET handshake echoes hub.challenge when the verify token matches', async () => {
  const res = await handler({
    httpMethod: 'GET',
    queryStringParameters: {
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    },
  } as never);
  expect(res).toEqual({ statusCode: 200, body: '1158201444' });
});

test('GET handshake is rejected with 403 on a wrong verify token', async () => {
  const res = await handler({
    httpMethod: 'GET',
    queryStringParameters: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '1158201444',
    },
  } as never);
  expect(res.statusCode).toBe(403);
});

test('GET handshake is rejected when no verify token is configured', async () => {
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  const res = await handler({
    httpMethod: 'GET',
    queryStringParameters: { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'c' },
  } as never);
  expect(res.statusCode).toBe(403);
});

// --- C3: non-message deliveries must not crash the router ---

test('a sent/delivered/read status callback returns 200 without routing anything', async () => {
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: 'wamid.out.1', status: 'delivered', recipient_id: '91999' }],
            },
          },
        ],
      },
    ],
  });
  const res = await handler(signedPost(body));
  expect(res).toEqual({ statusCode: 200, body: 'OK' });
  expect(mockedDynamo.getDriverByPhone).not.toHaveBeenCalled();
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
  expect(mockedDriver.handleDriverMessage).not.toHaveBeenCalled();
});

test('an empty / unrecognised envelope returns 200 instead of throwing', async () => {
  for (const body of ['{}', '[]', JSON.stringify({ entry: [] }), JSON.stringify({ entry: [{ changes: [] }] })]) {
    const res = await handler(signedPost(body));
    expect(res.statusCode).toBe(200);
  }
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});

test('a non-JSON body returns 200 instead of a 502 that would make Meta retry', async () => {
  const res = await handler(signedPost('not json at all'));
  expect(res).toEqual({ statusCode: 200, body: 'OK' });
});

test('a downstream routing failure still returns 200 so Meta does not retry-storm', async () => {
  mockedDynamo.getDriverByPhone.mockRejectedValue(new Error('DynamoDB is down'));
  const res = await handler(webhookEvent('+91999', 'leftover food'));
  expect(res).toEqual({ statusCode: 200, body: 'OK' });
});

// --- C4.1: location is read from the message, not from contacts ---

test('a location message is parsed from messages[0].location latitude/longitude', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  const body = messageBody('+91999', { location: { latitude: 12.9352, longitude: 77.6245 } });
  await handler(signedPost(body));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledWith(
    expect.objectContaining({ geo: { lat: 12.9352, lng: 77.6245 } }),
  );
});

test('a message with no location yields geo: undefined, never a fabricated coordinate', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  await handler(webhookEvent('+91999', 'leftover food'));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledWith(
    expect.objectContaining({ geo: undefined }),
  );
});

test('contacts[0].location is NOT treated as the donor geo (the old wrong path)', async () => {
  mockedDynamo.getDriverByPhone.mockResolvedValue(null);
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ location: { latitude: 1, longitude: 2 } }],
              messages: [{ id: 'wamid.1', from: '+91999', text: { body: 'food' } }],
            },
          },
        ],
      },
    ],
  });
  await handler(signedPost(body));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledWith(expect.objectContaining({ geo: undefined }));
});
