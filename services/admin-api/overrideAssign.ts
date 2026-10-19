import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequest, getDriverById, updateRequest, updateDriverStatus } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

/**
 * Admin override: move a request to a different driver.
 *
 * Known limitation (deliberate): this path has no live Step Functions task token to resume.
 * The running execution is still parked on NotifyDriverAndWait holding the OLD driver's token,
 * so the new driver's WhatsApp ACCEPT resolves against a request whose pendingTaskToken was
 * written for the previous assignment. What this handler does guarantee is that the new driver
 * is actually told about the pickup, that the old driver is released back to `available`
 * instead of being pinned busy forever, and that the new driver is marked busy. Full
 * token-level resumption would need the override to either re-drive the execution or send a
 * task failure, which is a larger change than this fix wave.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let parsed: { requestId?: string; driverId?: string };
  try {
    parsed = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ message: 'Malformed JSON body' }) };
  }

  const { requestId, driverId } = parsed;
  if (!requestId || !driverId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'requestId and driverId are required' }),
    };
  }

  const req = await getRequest(requestId);
  if (!req) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ message: 'Request not found' }) };
  }

  const newDriver = await getDriverById(driverId);
  if (!newDriver) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ message: 'Driver not found' }) };
  }

  const oldDriverId = req.driverId;
  if (oldDriverId && oldDriverId !== driverId) {
    await updateDriverStatus(oldDriverId, 'available');
  }
  await updateDriverStatus(driverId, 'busy');

  await updateRequest(requestId, {
    driverId,
    status: 'DRIVER_ASSIGNED',
    // Keep the old driver on the tried list so an automated reassign never loops back to them.
    triedDriverIds:
      oldDriverId && oldDriverId !== driverId
        ? [...(req.triedDriverIds ?? []), oldDriverId]
        : req.triedDriverIds ?? [],
  });

  const at = req.locationText ? ` at ${req.locationText}` : '';
  await sendWhatsAppText(
    newDriver.phone,
    `You have been assigned a pickup by an admin: ${req.qty} of ${req.foodType}${at}. Reply ACCEPT or DECLINE.`,
  );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ requestId, driverId, previousDriverId: oldDriverId ?? null }),
  };
}
