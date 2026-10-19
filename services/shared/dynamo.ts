import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { FoodRequest, Driver, Fridge } from './types';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const REQUESTS_TABLE = process.env.REQUESTS_TABLE ?? 'Requests';
const DRIVERS_TABLE = process.env.DRIVERS_TABLE ?? 'Drivers';
const FRIDGES_TABLE = process.env.FRIDGES_TABLE ?? 'Fridges';
const SPAM_LOG_TABLE = process.env.SPAM_LOG_TABLE ?? 'SpamLog';
const DONATION_HISTORY_TABLE = process.env.DONATION_HISTORY_TABLE ?? 'DonationHistory';
const PROCESSED_MESSAGES_TABLE = process.env.PROCESSED_MESSAGES_TABLE ?? 'ProcessedMessages';

export async function putRequest(req: FoodRequest): Promise<void> {
  await client.send(new PutCommand({ TableName: REQUESTS_TABLE, Item: req }));
}

export async function getRequest(requestId: string): Promise<FoodRequest | null> {
  const res = await client.send(
    new GetCommand({ TableName: REQUESTS_TABLE, Key: { requestId } }),
  );
  return (res.Item as FoodRequest) ?? null;
}

export async function updateRequest(requestId: string, patch: Partial<FoodRequest>): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  // updatedAt is stamped here rather than at each call site so no caller can forget it —
  // before this, a request's updatedAt stayed frozen at creation time for its whole lifecycle.
  // An explicit updatedAt in the patch still wins.
  const stamped: Partial<FoodRequest> = { updatedAt: new Date().toISOString(), ...patch };
  const keys = Object.keys(stamped) as (keyof FoodRequest)[];

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const removeClauses: string[] = [];

  keys.forEach((k, i) => {
    names[`#f${i}`] = k;
    const v = (stamped as Record<string, unknown>)[k];
    if (v === undefined) {
      removeClauses.push(`#f${i}`);
    } else {
      values[`:v${i}`] = v;
      setClauses.push(`#f${i} = :v${i}`);
    }
  });

  const expressionParts: string[] = [];
  if (setClauses.length > 0) expressionParts.push(`SET ${setClauses.join(', ')}`);
  if (removeClauses.length > 0) expressionParts.push(`REMOVE ${removeClauses.join(', ')}`);

  await client.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: expressionParts.join(' '),
      ExpressionAttributeNames: names,
      ...(setClauses.length > 0 ? { ExpressionAttributeValues: values } : {}),
    }),
  );
}

export async function findActiveRequestByDriverPhone(phone: string): Promise<FoodRequest | null> {
  const driver = await getDriverByPhone(phone);
  if (!driver) return null;

  const res = await client.send(
    new ScanCommand({
      TableName: REQUESTS_TABLE,
      FilterExpression: 'driverId = :d',
      ExpressionAttributeValues: { ':d': driver.driverId },
    }),
  );
  const items = (res.Items as FoodRequest[]) ?? [];
  const active = items.filter(
    (r) => r.status !== 'COMPLETE' && r.status !== 'REJECTED_SPAM',
  );
  return active[0] ?? null;
}

export async function putSpamLog(entry: {
  msgId: string;
  phone: string;
  rawText: string;
  verdict: string;
  confidence: number;
}): Promise<void> {
  await client.send(new PutCommand({ TableName: SPAM_LOG_TABLE, Item: entry }));
}

export async function putDonationHistory(req: FoodRequest): Promise<void> {
  await client.send(new PutCommand({ TableName: DONATION_HISTORY_TABLE, Item: req }));
}

export async function getAvailableDrivers(): Promise<Driver[]> {
  const res = await client.send(
    new ScanCommand({
      TableName: DRIVERS_TABLE,
      FilterExpression: '#s = :available',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':available': 'available' },
    }),
  );
  return (res.Items as Driver[]) ?? [];
}

export async function getFridges(): Promise<Fridge[]> {
  const res = await client.send(new ScanCommand({ TableName: FRIDGES_TABLE }));
  return (res.Items as Fridge[]) ?? [];
}

export async function getFridgeById(fridgeId: string): Promise<Fridge | null> {
  const res = await client.send(new GetCommand({ TableName: FRIDGES_TABLE, Key: { fridgeId } }));
  return (res.Item as Fridge) ?? null;
}

export async function getDriverByPhone(phone: string): Promise<Driver | null> {
  const res = await client.send(
    new ScanCommand({
      TableName: DRIVERS_TABLE,
      FilterExpression: 'phone = :p',
      ExpressionAttributeValues: { ':p': phone },
    }),
  );
  const items = (res.Items as Driver[]) ?? [];
  return items[0] ?? null;
}

export async function getDriverById(driverId: string): Promise<Driver | null> {
  const res = await client.send(new GetCommand({ TableName: DRIVERS_TABLE, Key: { driverId } }));
  return (res.Item as Driver) ?? null;
}

export async function updateDriverStatus(driverId: string, status: 'available' | 'busy'): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: DRIVERS_TABLE,
      Key: { driverId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
    }),
  );
}

export async function hasProcessedMessage(messageId: string): Promise<boolean> {
  const res = await client.send(
    new GetCommand({ TableName: PROCESSED_MESSAGES_TABLE, Key: { messageId } }),
  );
  return !!res.Item;
}

export async function markMessageProcessed(messageId: string): Promise<void> {
  await client.send(
    new PutCommand({ TableName: PROCESSED_MESSAGES_TABLE, Item: { messageId, processedAt: new Date().toISOString() } }),
  );
}

export async function scanAllRequests(): Promise<FoodRequest[]> {
  const res = await client.send(new ScanCommand({ TableName: REQUESTS_TABLE }));
  return (res.Items as FoodRequest[]) ?? [];
}
