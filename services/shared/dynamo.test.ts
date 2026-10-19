// services/shared/dynamo.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { putRequest, getRequest, getDriverByPhone, getDriverById, findActiveRequestByDriverPhone, updateRequest, scanAllRequests } from './dynamo';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

test('putRequest writes item, getRequest reads it back', async () => {
  ddbMock.on(PutCommand).resolves({});
  await putRequest({
    requestId: 'req-1',
    donorPhone: '+91999',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 1, lng: 2 },
    status: 'RECEIVED',
    createdAt: 'now',
    updatedAt: 'now',
    reassignCount: 0,
  });
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);

  ddbMock.on(GetCommand).resolves({ Item: { requestId: 'req-1', status: 'RECEIVED' } });
  const result = await getRequest('req-1');
  expect(result?.requestId).toBe('req-1');
});

test('getRequest returns null when item missing', async () => {
  ddbMock.on(GetCommand).resolves({});
  const result = await getRequest('missing');
  expect(result).toBeNull();
});

test('getDriverByPhone finds a driver regardless of busy/available status', async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [{ driverId: 'd1', phone: '+91driver', status: 'busy' }] });
  const result = await getDriverByPhone('+91driver');
  expect(result?.driverId).toBe('d1');
});

test('getDriverByPhone returns null for an unknown phone', async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  const result = await getDriverByPhone('+91unknown');
  expect(result).toBeNull();
});

test('getDriverById reads a driver by id', async () => {
  ddbMock.on(GetCommand).resolves({ Item: { driverId: 'driver-1', phone: '+91999' } });
  const result = await getDriverById('driver-1');
  expect(result?.phone).toBe('+91999');
});

test('findActiveRequestByDriverPhone resolves phone to driverId, then finds the active request', async () => {
  ddbMock.on(ScanCommand, { TableName: 'Drivers' }).resolves({ Items: [{ driverId: 'd1', phone: '+91driver' }] });
  ddbMock.on(ScanCommand, { TableName: 'Requests' }).resolves({
    Items: [{ requestId: 'req-1', driverId: 'd1', status: 'DRIVER_ASSIGNED' }],
  });
  const result = await findActiveRequestByDriverPhone('+91driver');
  expect(result?.requestId).toBe('req-1');
});

test('findActiveRequestByDriverPhone returns null when the phone matches no driver', async () => {
  ddbMock.on(ScanCommand, { TableName: 'Drivers' }).resolves({ Items: [] });
  const result = await findActiveRequestByDriverPhone('+91unknown');
  expect(result).toBeNull();
});

test('findActiveRequestByDriverPhone ignores a COMPLETE request for that driver', async () => {
  ddbMock.on(ScanCommand, { TableName: 'Drivers' }).resolves({ Items: [{ driverId: 'd1', phone: '+91driver' }] });
  ddbMock.on(ScanCommand, { TableName: 'Requests' }).resolves({
    Items: [{ requestId: 'req-old', driverId: 'd1', status: 'COMPLETE' }],
  });
  const result = await findActiveRequestByDriverPhone('+91driver');
  expect(result).toBeNull();
});

test('updateRequest builds a REMOVE clause for undefined fields instead of a SET with an undefined value', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', { status: 'MATCHING', pendingTaskToken: undefined, pendingStep: undefined });

  const call = ddbMock.commandCalls(UpdateCommand)[0];
  const input = call.args[0].input;
  expect(input.UpdateExpression).toContain('SET');
  expect(input.UpdateExpression).toContain('REMOVE');
  expect(Object.values(input.ExpressionAttributeValues ?? {})).toEqual(['MATCHING']);
});

test('updateRequest omits ExpressionAttributeValues entirely when every patch field is undefined', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', { pendingTaskToken: undefined, pendingStep: undefined });

  const call = ddbMock.commandCalls(UpdateCommand)[0];
  const input = call.args[0].input;
  expect(input.UpdateExpression).toBe('REMOVE #f0, #f1');
  expect(input.ExpressionAttributeValues).toBeUndefined();
});

test('scanAllRequests returns every request in the table', async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [{ requestId: 'req-1', status: 'MATCHING' }] });
  const result = await scanAllRequests();
  expect(result).toHaveLength(1);
  expect(result[0].requestId).toBe('req-1');
});
