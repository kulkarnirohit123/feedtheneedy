import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { scanAllRequests } from '../shared/dynamo';

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const requests = await scanAllRequests();
  return { statusCode: 200, body: JSON.stringify({ requests }) };
}
