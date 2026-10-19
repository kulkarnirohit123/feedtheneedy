import { scanAllRequests } from '../shared/dynamo';
import { FoodRequest } from '../shared/types';

export async function handler(): Promise<{ requests: FoodRequest[] }> {
  const requests = await scanAllRequests();
  return { requests };
}
