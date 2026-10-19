import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DRIVERS = [
  { driverId: 'driver-1', phone: '+919111111111', name: 'Ravi', currentGeo: { lat: 12.9716, lng: 77.6412 }, status: 'available' as const, lastActive: new Date().toISOString() },
  { driverId: 'driver-2', phone: '+919111111112', name: 'Suresh', currentGeo: { lat: 12.9352, lng: 77.6245 }, status: 'available' as const, lastActive: new Date().toISOString() },
  { driverId: 'driver-3', phone: '+919111111113', name: 'Kiran', currentGeo: { lat: 12.9784, lng: 77.6408 }, status: 'available' as const, lastActive: new Date().toISOString() },
];

const FRIDGES = [
  { fridgeId: 'fridge-1', name: 'Koramangala Community Fridge', address: '5th Block, Koramangala', geo: { lat: 12.9352, lng: 77.6245 }, capacity: 50 },
  { fridgeId: 'fridge-2', name: 'Indiranagar Community Fridge', address: '100ft Road, Indiranagar', geo: { lat: 12.9716, lng: 77.6412 }, capacity: 50 },
];

async function main() {
  for (const d of DRIVERS) {
    await client.send(new PutCommand({ TableName: process.env.DRIVERS_TABLE ?? 'Drivers', Item: d }));
  }
  for (const f of FRIDGES) {
    await client.send(new PutCommand({ TableName: process.env.FRIDGES_TABLE ?? 'Fridges', Item: f }));
  }
  console.log(`Seeded ${DRIVERS.length} drivers and ${FRIDGES.length} fridges.`);
}

main();
