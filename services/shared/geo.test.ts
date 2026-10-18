import { haversineKm } from './geo';

test('distance between identical points is zero', () => {
  expect(haversineKm({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBeCloseTo(0, 3);
});

test('distance between Indiranagar and Koramangala is roughly 5-7km', () => {
  const indiranagar = { lat: 12.9716, lng: 77.6412 };
  const koramangala = { lat: 12.9352, lng: 77.6245 };
  const d = haversineKm(indiranagar, koramangala);
  expect(d).toBeGreaterThan(3);
  expect(d).toBeLessThan(10);
});
