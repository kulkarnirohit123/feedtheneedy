import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateRequest } from '../shared/dynamo';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { requestId, driverId } = JSON.parse(event.body ?? '{}');
  await updateRequest(requestId, { driverId });
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ requestId, driverId }) };
}
