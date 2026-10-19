import { getRequest, getFridges, updateRequest } from '../shared/dynamo';
import { haversineKm } from '../shared/geo';

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; fridgeId: string | null }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  // Same contract as matchDriver: a null fridgeId means "cannot match", and the FridgeFound
  // Choice routes it to FlagStuckRequest instead of waiting forever on a fridge photo.
  const geo = req.geo;
  if (!geo) {
    return { requestId: event.requestId, fridgeId: null };
  }

  const fridges = await getFridges();
  if (fridges.length === 0) {
    return { requestId: event.requestId, fridgeId: null };
  }
  const nearest = fridges.reduce((best, f) =>
    haversineKm(geo, f.geo) < haversineKm(geo, best.geo) ? f : best,
  );

  await updateRequest(event.requestId, { fridgeId: nearest.fridgeId, status: 'FRIDGE_MATCHED' });

  return { requestId: event.requestId, fridgeId: nearest.fridgeId };
}
