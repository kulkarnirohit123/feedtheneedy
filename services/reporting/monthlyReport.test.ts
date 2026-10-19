import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { handler, csvField } from './monthlyReport';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
});

test('queries the month, writes a CSV to S3, returns a summary', async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { requestId: 'req-1', status: 'COMPLETE', qty: '20 plates', foodType: 'vada pav', donorPhone: '+91999' },
      { requestId: 'req-2', status: 'COMPLETE', qty: '15 plates', foodType: 'biryani', donorPhone: '+91888' },
    ],
  });
  s3Mock.on(PutObjectCommand).resolves({});

  const result = await handler({ month: '2026-10' });

  expect(result.totalRequests).toBe(2);
  expect(result.csvS3Key).toContain('2026-10');
  expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);

  const queryCall = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
  expect(queryCall.IndexName).toBe('byMonthStatus');
  expect(queryCall.ExpressionAttributeNames).toEqual({ '#m': 'month' });
  expect(queryCall.ExpressionAttributeValues).toEqual({ ':month': '2026-10' });

  const putCall = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
  expect(putCall.Body).toBe(
    'requestId,status,qty,foodType,donorPhone\n' +
      'req-1,COMPLETE,20 plates,vada pav,+91999\n' +
      'req-2,COMPLETE,15 plates,biryani,+91888',
  );
});

test('defaults to the previous calendar month when event.month is absent (the EventBridge trigger case)', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  s3Mock.on(PutObjectCommand).resolves({});

  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const expectedMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const result = await handler({});

  expect(result.month).toBe(expectedMonth);
  const queryCall = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
  expect(queryCall.ExpressionAttributeValues).toEqual({ ':month': expectedMonth });
});

describe('CSV field escaping', () => {
  test('leaves plain fields untouched', () => {
    expect(csvField('20 plates')).toBe('20 plates');
    expect(csvField('+91999')).toBe('+91999');
  });

  test('quotes fields containing a comma', () => {
    expect(csvField('20 plates, mixed veg')).toBe('"20 plates, mixed veg"');
  });

  test('quotes and doubles internal double-quotes', () => {
    expect(csvField('rice "basmati"')).toBe('"rice ""basmati"""');
  });

  test('quotes fields containing newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  test('renders null/undefined as an empty field', () => {
    expect(csvField(undefined)).toBe('');
    expect(csvField(null)).toBe('');
  });
});

test('a comma in a Bedrock-extracted field does not shift the remaining columns', async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      {
        requestId: 'req-1',
        status: 'COMPLETE',
        qty: '20 plates, approx',
        foodType: 'vada pav, chutney',
        donorPhone: '+91999',
      },
    ],
  });
  s3Mock.on(PutObjectCommand).resolves({});

  await handler({ month: '2026-10' });

  const body = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.Body as string;
  expect(body).toBe(
    'requestId,status,qty,foodType,donorPhone\n' +
      'req-1,COMPLETE,"20 plates, approx","vada pav, chutney",+91999',
  );
});
