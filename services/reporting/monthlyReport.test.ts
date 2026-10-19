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
});
