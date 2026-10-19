import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { scanAllRequests } from '../shared/dynamo';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const requests = await scanAllRequests();
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ requests }) };
}
