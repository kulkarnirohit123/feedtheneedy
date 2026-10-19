import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateRequest } from '../shared/dynamo';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { requestId, driverId } = JSON.parse(event.body ?? '{}');
  await updateRequest(requestId, { driverId });
  return { statusCode: 200, body: JSON.stringify({ requestId, driverId }) };
}
