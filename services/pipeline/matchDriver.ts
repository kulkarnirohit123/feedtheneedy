import { getRequest, getAvailableDrivers } from '../shared/dynamo';
import { haversineKm } from '../shared/geo';

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; driverId: string | null }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  const drivers = await getAvailableDrivers();
  const excluded = new Set(req.triedDriverIds ?? []);
  const candidates = drivers.filter((d) => !excluded.has(d.driverId));

  if (candidates.length === 0) {
    return { requestId: event.requestId, driverId: null };
  }

  const nearest = candidates.reduce((best, d) => {
    const dist = haversineKm(req.geo, d.currentGeo);
    const bestDist = haversineKm(req.geo, best.currentGeo);
    return dist < bestDist ? d : best;
  });

  return { requestId: event.requestId, driverId: nearest.driverId };
}
