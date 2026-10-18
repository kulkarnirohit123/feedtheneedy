import { getRequest, getFridges, updateRequest } from '../shared/dynamo';
import { haversineKm } from '../shared/geo';

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; fridgeId: string | null }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  const fridges = await getFridges();
  if (fridges.length === 0) {
    return { requestId: event.requestId, fridgeId: null };
  }
  const nearest = fridges.reduce((best, f) =>
    haversineKm(req.geo, f.geo) < haversineKm(req.geo, best.geo) ? f : best,
  );

  await updateRequest(event.requestId, { fridgeId: nearest.fridgeId, status: 'FRIDGE_MATCHED' });

  return { requestId: event.requestId, fridgeId: nearest.fridgeId };
}
