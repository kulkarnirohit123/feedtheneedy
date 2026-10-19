import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './monthlyReport';

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
