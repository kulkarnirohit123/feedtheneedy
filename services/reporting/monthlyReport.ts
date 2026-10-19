import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const DONATION_HISTORY_TABLE = process.env.DONATION_HISTORY_TABLE ?? 'DonationHistory';
const REPORTS_BUCKET = process.env.REPORTS_BUCKET ?? '';

interface HistoryRow {
  requestId: string;
  status: string;
  qty: string;
  foodType: string;
  donorPhone: string;
}

function previousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export async function handler(
  event: { month?: string },
): Promise<{ month: string; totalRequests: number; csvS3Key: string }> {
  const month = event.month ?? previousMonth();

  const res = await ddb.send(
    new QueryCommand({
      TableName: DONATION_HISTORY_TABLE,
      IndexName: 'byMonthStatus',
      KeyConditionExpression: '#m = :month',
      ExpressionAttributeNames: { '#m': 'month' },
      ExpressionAttributeValues: { ':month': month },
    }),
  );
  const rows = (res.Items as HistoryRow[]) ?? [];

  const header = 'requestId,status,qty,foodType,donorPhone';
  const csv = [header, ...rows.map((r) => `${r.requestId},${r.status},${r.qty},${r.foodType},${r.donorPhone}`)].join('\n');

  const csvS3Key = `reports/${month}.csv`;
  await s3.send(new PutObjectCommand({ Bucket: REPORTS_BUCKET, Key: csvS3Key, Body: csv }));

  return { month, totalRequests: rows.length, csvS3Key };
}
