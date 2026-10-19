// services/shared/dynamo.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { putRequest, getRequest, getDriverByPhone, getDriverById, getFridgeById, findActiveRequestByDriverPhone, updateRequest, scanAllRequests } from './dynamo';

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

/** Reconstructs {fieldName: value} from the #f_n / :v_n indirection the builder emits. */
function patchFrom(input: any): Record<string, unknown> {
  const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
  const values: Record<string, unknown> = input.ExpressionAttributeValues ?? {};
  const out: Record<string, unknown> = {};
  for (const [placeholder, field] of Object.entries(names)) {
    const valueKey = placeholder.replace('#f', ':v');
    if (valueKey in values) out[field] = values[valueKey];
  }
  return out;
}

function removedFields(input: any): string[] {
  const match = /REMOVE (.*)$/.exec(input.UpdateExpression as string);
  if (!match) return [];
  const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
  return match[1].split(', ').map((p) => names[p.trim()]);
}

test('updateRequest builds a REMOVE clause for undefined fields instead of a SET with an undefined value', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', { status: 'MATCHING', pendingTaskToken: undefined, pendingStep: undefined });

  const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input as any;
  expect(input.UpdateExpression).toContain('SET');
  expect(input.UpdateExpression).toContain('REMOVE');
  expect(patchFrom(input).status).toBe('MATCHING');
  expect(removedFields(input).sort()).toEqual(['pendingStep', 'pendingTaskToken']);
});

test('updateRequest still REMOVEs every undefined field when the patch is undefined-only', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', { pendingTaskToken: undefined, pendingStep: undefined });

  const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input as any;
  expect(removedFields(input).sort()).toEqual(['pendingStep', 'pendingTaskToken']);
  // The only SET is the auto-stamped updatedAt.
  expect(Object.keys(patchFrom(input))).toEqual(['updatedAt']);
});

test('updateRequest stamps updatedAt on every patch so no call site can forget it', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  const before = new Date().toISOString();
  await updateRequest('req-1', { status: 'COMPLETE' });

  const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input as any;
  const patch = patchFrom(input);
  expect(patch.status).toBe('COMPLETE');
  expect(typeof patch.updatedAt).toBe('string');
  expect(patch.updatedAt as string >= before).toBe(true);
});

test('an explicit updatedAt in the patch wins over the auto-stamp', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', { status: 'COMPLETE', updatedAt: '2020-01-01T00:00:00.000Z' });

  const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input as any;
  expect(patchFrom(input).updatedAt).toBe('2020-01-01T00:00:00.000Z');
});

test('updateRequest with an empty patch is a no-op, not a bare updatedAt write', async () => {
  ddbMock.on(UpdateCommand).resolves({});
  await updateRequest('req-1', {});
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
});

test('getFridgeById reads a fridge by id', async () => {
  ddbMock.on(GetCommand).resolves({ Item: { fridgeId: 'f1', name: 'Indiranagar Fridge', address: '100ft Road' } });
  const result = await getFridgeById('f1');
  expect(result?.name).toBe('Indiranagar Fridge');
});

test('scanAllRequests returns every request in the table', async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [{ requestId: 'req-1', status: 'MATCHING' }] });
  const result = await scanAllRequests();
  expect(result).toHaveLength(1);
  expect(result[0].requestId).toBe('req-1');
});
