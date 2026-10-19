import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { persistWhatsAppMedia, mediaIdFrom } from './media';

const s3Mock = mockClient(S3Client);
const originalFetch = global.fetch;

beforeEach(() => {
  s3Mock.reset();
  process.env.PHOTOS_BUCKET = 'photos-bucket';
  process.env.META_ACCESS_TOKEN = 'meta-token';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.PHOTOS_BUCKET;
  delete process.env.META_ACCESS_TOKEN;
});

function fetchStub(responses: Array<Partial<Response> & { jsonBody?: unknown; bytes?: Uint8Array }>) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.jsonBody,
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    });
  }
  global.fetch = fn as never;
  return fn;
}

test('mediaIdFrom extracts the id, and rejects anything that is not a media reference', () => {
  expect(mediaIdFrom('media:abc123')).toBe('abc123');
  expect(mediaIdFrom('media:')).toBeNull();
  expect(mediaIdFrom('https://example.com/x.jpg')).toBeNull();
});

test('resolves the media id, downloads the bytes, and puts them in the photos bucket', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  const fetchMock = fetchStub([
    { jsonBody: { url: 'https://lookaside.fbsbx.com/media/abc', mime_type: 'image/jpeg' } },
    { bytes },
  ]);
  s3Mock.on(PutObjectCommand).resolves({});

  const key = await persistWhatsAppMedia('media:abc123', 'photos/req-1/pickup');

  expect(key).toBe('photos/req-1/pickup.jpg');

  // Step 1: the Graph API media-id lookup, bearer-authenticated.
  expect(fetchMock.mock.calls[0][0]).toContain('/abc123');
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer meta-token' });
  // Step 2: the token-gated download URL the lookup returned.
  expect(fetchMock.mock.calls[1][0]).toBe('https://lookaside.fbsbx.com/media/abc');

  const put = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
  expect(put.Bucket).toBe('photos-bucket');
  expect(put.Key).toBe('photos/req-1/pickup.jpg');
  expect(put.ContentType).toBe('image/jpeg');
  expect(new Uint8Array(put.Body as Uint8Array)).toEqual(bytes);
});

test('derives the extension from the mime type, falling back to .bin', async () => {
  fetchStub([{ jsonBody: { url: 'https://media/x', mime_type: 'image/png' } }, { bytes: new Uint8Array([1]) }]);
  s3Mock.on(PutObjectCommand).resolves({});
  expect(await persistWhatsAppMedia('media:a', 'photos/req-1/fridge')).toBe('photos/req-1/fridge.png');

  fetchStub([{ jsonBody: { url: 'https://media/x', mime_type: 'application/pdf' } }, { bytes: new Uint8Array([1]) }]);
  expect(await persistWhatsAppMedia('media:a', 'photos/req-1/fridge')).toBe('photos/req-1/fridge.bin');
});

test('returns null (so the caller keeps the raw reference) when the token or bucket is unset', async () => {
  delete process.env.META_ACCESS_TOKEN;
  expect(await persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).toBeNull();

  process.env.META_ACCESS_TOKEN = 'meta-token';
  delete process.env.PHOTOS_BUCKET;
  expect(await persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).toBeNull();

  expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
});

test('returns null rather than throwing when the Graph API lookup fails', async () => {
  fetchStub([{ ok: false, status: 401 }]);
  await expect(persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).resolves.toBeNull();
});

test('returns null when the lookup succeeds but carries no download url', async () => {
  fetchStub([{ jsonBody: { mime_type: 'image/jpeg' } }]);
  await expect(persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).resolves.toBeNull();
});

test('returns null when the binary download fails', async () => {
  fetchStub([{ jsonBody: { url: 'https://media/x', mime_type: 'image/jpeg' } }, { ok: false, status: 404 }]);
  await expect(persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).resolves.toBeNull();
});

test('returns null when the S3 put fails, instead of wedging the pickup', async () => {
  fetchStub([{ jsonBody: { url: 'https://media/x', mime_type: 'image/jpeg' } }, { bytes: new Uint8Array([1]) }]);
  s3Mock.on(PutObjectCommand).rejects(new Error('AccessDenied'));
  await expect(persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).resolves.toBeNull();
});

test('returns null when fetch itself rejects', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as never;
  await expect(persistWhatsAppMedia('media:abc', 'photos/req-1/pickup')).resolves.toBeNull();
});
