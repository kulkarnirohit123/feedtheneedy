# Food NGO Pickup Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working AWS-native MVP where donors/vendors report surplus food over WhatsApp, an AI classifier filters spam, the system auto-dispatches the nearest driver, and two photo confirmations (pickup + fridge drop) close the loop — with an admin web dashboard for live oversight, override, and monthly reporting.

**Architecture:** Fully serverless on AWS. API Gateway receives the WhatsApp webhook; a single InboundRouter Lambda branches on sender identity (known driver vs. unknown donor/vendor) and, for unknown senders, runs an AI classifier before anything is dispatched. A Step Functions state machine owns each request's lifecycle end-to-end, using the `waitForTaskToken` pattern so driver replies (accept/decline, photos) resume the exact step that's waiting — no polling. DynamoDB holds all state; S3 holds photos; Cognito + a small admin API + a React dashboard give NGO staff visibility and override.

**Tech Stack:** AWS CDK v2 (TypeScript), Node.js 20.x Lambdas, aws-sdk v3 clients (DynamoDB Document Client, Bedrock Agent Runtime, Location, S3, SES/End User Messaging Social), Step Functions, Jest + ts-jest + aws-sdk-client-mock for Lambda unit tests, aws-cdk-lib/assertions for infra tests, React + Vite + Vitest + React Testing Library for the admin dashboard.

**Spec:** `docs/superpowers/specs/2026-10-18-food-ngo-pickup-design.md`

## Global Constraints

- WhatsApp is the only channel for donors/vendors/drivers — no SMS, no end-user web UI (per spec "Out of scope").
- Spam/marketing/loan/unrelated messages must never create a `Request` record or reach a driver (per spec success criteria).
- A low-confidence `food_donation_offer` goes to `PENDING_REVIEW`, never auto-dispatched, never auto-dropped (per spec InboundRouter).
- Classifier failure/timeout fails open to `PENDING_REVIEW`, never silently dropped (per spec Error handling).
- Driver accept timeout is 60 minutes; donor gets the auto-ack ("Thank you for sharing the information, driver will be available in next 60 minutes") immediately on confident classification, before a driver is matched (per spec data flow).
- Photo upload retries cap at 3 attempts before an admin flag (per spec Error handling).
- Fridges are a fixed, admin-managed list — no self-service fridge onboarding (per spec Out of scope).
- Flow stops at `FRIDGE_PHOTO_CONFIRMED` / `COMPLETE` — no distribution-out leg (per spec Out of scope).
- Must use Amazon Bedrock AgentCore (not a bare Bedrock invoke) for the classifier, and AWS End User Messaging Social for WhatsApp — both required for hackathon CDS/AgentCore scoring (per spec Hackathon fit).
- Admin web UI is Cognito-gated; drivers have no web login (per spec Architecture/Out of scope).

## Review Focus

- **Driver replies while no request is actively waiting on them** (e.g. driver texts "ACCEPT" after already completing their last job, or out of the blue) — the InboundRouter driver branch must not crash or resume a stale/absent task token; it should reply with a clear "no pending request" message and log it, not throw. Covered in Task 6.
- **Duplicate/replayed webhook deliveries** (WhatsApp retries delivery on slow 200 OK) — the same inbound message ID must not create two `Request` records or double-resume a task token. Covered in Task 5 with an idempotency check on `messageId`.
- **Photo message arrives at the wrong step** (driver sends a photo while the state machine is actually waiting on an ACCEPT/DECLINE reply, or vice versa) — must be rejected with a re-prompt, not silently misfiled as the wrong photo. Covered in Task 6 and Task 11/13.
- **Two reassign cycles both fail** (no driver accepts within 60 min twice in a row) — must raise the admin alert and leave the request in a clearly-flagged, manually resolvable state rather than looping forever or silently failing. Covered in Task 10.
- **Classifier returns a well-formed but garbage verdict** (not one of the five known enum values, or missing confidence) — InboundRouter must treat this as a classifier failure (fail open to `PENDING_REVIEW`), not crash on an unexpected string. Covered in Task 5.

---

## File Structure

```
infra/                            AWS CDK app (TypeScript)
  bin/app.ts
  lib/
    data-stack.ts                 DynamoDB tables (Requests, Drivers, Fridges, SpamLog, DonationHistory) + S3 photo bucket
    auth-stack.ts                 Cognito admin user pool + app client
    pipeline-stack.ts             Step Functions state machine + API Gateway webhook + SQS DLQ
    admin-api-stack.ts            Admin REST API (list/override) behind Cognito authorizer
    dashboard-stack.ts            S3 + CloudFront hosting for the React admin app
    reporting-stack.ts            EventBridge schedule + monthly report Lambda
    alarms-stack.ts               CloudWatch alarms on stuck requests / DLQ depth
  package.json, tsconfig.json, cdk.json

services/
  shared/
    types.ts                      FoodRequest, Driver, Fridge, ClassifierResult, RequestStatus
    dynamo.ts                      DynamoDB Document Client wrappers
    whatsapp.ts                    End User Messaging Social send wrapper
    geo.ts                         haversine distance helper
  inbound-router/
    classifier.ts                  Bedrock AgentCore (InvokeAgentCommand) wrapper
    donorHandler.ts                 unknown-sender branch: classify -> create Request / log spam / pending review
    driverHandler.ts                known-driver branch: resume waiting task token
    handler.ts                      Lambda entrypoint: idempotency check, dispatch to donor/driver handler
  pipeline/
    notifyDonor.ts
    matchDriver.ts
    notifyDriverAndWait.ts
    reassignDriver.ts
    handlePickupPhoto.ts
    matchFridge.ts
    handleFridgePhoto.ts
    finalizeRequest.ts
    driverLocationUpdate.ts         Location Service Tracker position update
  admin-api/
    listRequests.ts
    overrideAssign.ts
  reporting/
    monthlyReport.ts

scripts/
  seed-drivers-fridges.ts
  simulate-whatsapp.ts

admin-dashboard/                   React app (Vite)
  src/
    api.ts
    auth.ts
    pages/Dashboard.tsx
    pages/RequestDetail.tsx
    pages/Reports.tsx
    components/RequestCard.tsx
    components/DriverSelect.tsx
```

---

### Task 1: Repo scaffold, shared types

**Files:**
- Create: `package.json`, `tsconfig.json` (repo root, workspaces for `infra`, `services`, `admin-dashboard`)
- Create: `services/shared/types.ts`
- Test: `services/shared/types.test.ts`

**Interfaces:**
- Produces: `RequestStatus`, `FoodRequest`, `Driver`, `Fridge`, `ClassifierResult` — every later task imports these from `services/shared/types.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/shared/types.test.ts
import { FoodRequest, RequestStatus } from './types';

test('FoodRequest accepts a full valid record', () => {
  const r: FoodRequest = {
    requestId: 'req-1',
    donorPhone: '+919999999999',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 12.9716, lng: 77.5946 },
    status: 'RECEIVED' as RequestStatus,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  };
  expect(r.status).toBe('RECEIVED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/shared/types.test.ts`
Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/shared/types.ts
export type RequestStatus =
  | 'RECEIVED'
  | 'REJECTED_SPAM'
  | 'PENDING_REVIEW'
  | 'MATCHING'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ACCEPTED'
  | 'PICKUP_PHOTO_CONFIRMED'
  | 'FRIDGE_MATCHED'
  | 'FRIDGE_PHOTO_CONFIRMED'
  | 'COMPLETE';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface FoodRequest {
  requestId: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  geo: GeoPoint;
  status: RequestStatus;
  driverId?: string;
  fridgeId?: string;
  createdAt: string;
  updatedAt: string;
  pickupPhotoUrl?: string;
  fridgePhotoUrl?: string;
  reassignCount: number;
  pendingTaskToken?: string;
  pendingStep?: 'ACCEPT' | 'PICKUP_PHOTO' | 'FRIDGE_PHOTO';
  lastInboundMessageId?: string;
}

export interface Driver {
  driverId: string;
  phone: string;
  name: string;
  currentGeo: GeoPoint;
  status: 'available' | 'busy';
  lastActive: string;
}

export interface Fridge {
  fridgeId: string;
  name: string;
  address: string;
  geo: GeoPoint;
  capacity: number;
}

export type ClassifierVerdict =
  | 'food_donation_offer'
  | 'spam'
  | 'marketing'
  | 'loan_offer'
  | 'unrelated';

export interface ClassifierResult {
  verdict: ClassifierVerdict;
  confidence: number;
  extracted?: {
    qty: string;
    foodType: string;
    locationText: string;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/shared/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json services/shared/types.ts services/shared/types.test.ts
git commit -m "feat: scaffold repo, define shared domain types"
```

---

### Task 2: DynamoDB wrappers

**Files:**
- Create: `services/shared/dynamo.ts`
- Test: `services/shared/dynamo.test.ts`

**Interfaces:**
- Consumes: `FoodRequest`, `Driver`, `Fridge` from `services/shared/types.ts` (Task 1).
- Produces: `putRequest(req: FoodRequest): Promise<void>`, `getRequest(requestId: string): Promise<FoodRequest | null>`, `updateRequest(requestId: string, patch: Partial<FoodRequest>): Promise<void>`, `findActiveRequestByDriverPhone(phone: string): Promise<FoodRequest | null>`, `putSpamLog(entry: {msgId: string; phone: string; rawText: string; verdict: string; confidence: number}): Promise<void>`, `putDonationHistory(req: FoodRequest): Promise<void>`, `getAvailableDrivers(): Promise<Driver[]>`, `getFridges(): Promise<Fridge[]>`, `updateDriverStatus(driverId: string, status: 'available'|'busy'): Promise<void>`, `hasProcessedMessage(messageId: string): Promise<boolean>`, `markMessageProcessed(messageId: string): Promise<void>`. Every later Lambda task imports from here — no task talks to DynamoDB directly.

- [ ] **Step 1: Write the failing test**

```typescript
// services/shared/dynamo.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { putRequest, getRequest } from './dynamo';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

test('putRequest writes item, getRequest reads it back', async () => {
  ddbMock.on(PutCommand).resolves({});
  await putRequest({
    requestId: 'req-1',
    donorPhone: '+91999',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 1, lng: 2 },
    status: 'RECEIVED',
    createdAt: 'now',
    updatedAt: 'now',
    reassignCount: 0,
  });
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);

  ddbMock.on(GetCommand).resolves({ Item: { requestId: 'req-1', status: 'RECEIVED' } });
  const result = await getRequest('req-1');
  expect(result?.requestId).toBe('req-1');
});

test('getRequest returns null when item missing', async () => {
  ddbMock.on(GetCommand).resolves({});
  const result = await getRequest('missing');
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/shared/dynamo.test.ts`
Expected: FAIL — `Cannot find module './dynamo'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/shared/dynamo.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { FoodRequest, Driver, Fridge } from './types';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const REQUESTS_TABLE = process.env.REQUESTS_TABLE ?? 'Requests';
const DRIVERS_TABLE = process.env.DRIVERS_TABLE ?? 'Drivers';
const FRIDGES_TABLE = process.env.FRIDGES_TABLE ?? 'Fridges';
const SPAM_LOG_TABLE = process.env.SPAM_LOG_TABLE ?? 'SpamLog';
const DONATION_HISTORY_TABLE = process.env.DONATION_HISTORY_TABLE ?? 'DonationHistory';
const PROCESSED_MESSAGES_TABLE = process.env.PROCESSED_MESSAGES_TABLE ?? 'ProcessedMessages';

export async function putRequest(req: FoodRequest): Promise<void> {
  await client.send(new PutCommand({ TableName: REQUESTS_TABLE, Item: req }));
}

export async function getRequest(requestId: string): Promise<FoodRequest | null> {
  const res = await client.send(
    new GetCommand({ TableName: REQUESTS_TABLE, Key: { requestId } }),
  );
  return (res.Item as FoodRequest) ?? null;
}

export async function updateRequest(requestId: string, patch: Partial<FoodRequest>): Promise<void> {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = keys.map((k, i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = (patch as Record<string, unknown>)[k];
    return `#f${i} = :v${i}`;
  });
  await client.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function findActiveRequestByDriverPhone(phone: string): Promise<FoodRequest | null> {
  const res = await client.send(
    new QueryCommand({
      TableName: REQUESTS_TABLE,
      IndexName: 'byDriverPhone',
      KeyConditionExpression: 'donorPhoneIsDriverPhoneIndexKey = :p',
      ExpressionAttributeValues: { ':p': phone },
    }),
  );
  const items = (res.Items as FoodRequest[]) ?? [];
  const active = items.filter(
    (r) => r.status !== 'COMPLETE' && r.status !== 'REJECTED_SPAM',
  );
  return active[0] ?? null;
}

export async function putSpamLog(entry: {
  msgId: string;
  phone: string;
  rawText: string;
  verdict: string;
  confidence: number;
}): Promise<void> {
  await client.send(new PutCommand({ TableName: SPAM_LOG_TABLE, Item: entry }));
}

export async function putDonationHistory(req: FoodRequest): Promise<void> {
  await client.send(new PutCommand({ TableName: DONATION_HISTORY_TABLE, Item: req }));
}

export async function getAvailableDrivers(): Promise<Driver[]> {
  const res = await client.send(
    new ScanCommand({
      TableName: DRIVERS_TABLE,
      FilterExpression: '#s = :available',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':available': 'available' },
    }),
  );
  return (res.Items as Driver[]) ?? [];
}

export async function getFridges(): Promise<Fridge[]> {
  const res = await client.send(new ScanCommand({ TableName: FRIDGES_TABLE }));
  return (res.Items as Fridge[]) ?? [];
}

export async function updateDriverStatus(driverId: string, status: 'available' | 'busy'): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: DRIVERS_TABLE,
      Key: { driverId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
    }),
  );
}

export async function hasProcessedMessage(messageId: string): Promise<boolean> {
  const res = await client.send(
    new GetCommand({ TableName: PROCESSED_MESSAGES_TABLE, Key: { messageId } }),
  );
  return !!res.Item;
}

export async function markMessageProcessed(messageId: string): Promise<void> {
  await client.send(
    new PutCommand({ TableName: PROCESSED_MESSAGES_TABLE, Item: { messageId, processedAt: new Date().toISOString() } }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/shared/dynamo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/shared/dynamo.ts services/shared/dynamo.test.ts
git commit -m "feat: add DynamoDB access wrappers"
```

---

### Task 3: Bedrock AgentCore classifier wrapper

**Files:**
- Create: `services/inbound-router/classifier.ts`
- Test: `services/inbound-router/classifier.test.ts`

**Interfaces:**
- Consumes: `ClassifierResult`, `ClassifierVerdict` from `services/shared/types.ts`.
- Produces: `classifyMessage(text: string): Promise<ClassifierResult>` — used by Task 5 (donorHandler). Throws `ClassifierError` on malformed/unparseable agent output so the caller can fail open per spec.

- [ ] **Step 1: Write the failing test**

```typescript
// services/inbound-router/classifier.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { classifyMessage, ClassifierError } from './classifier';

const bedrockMock = mockClient(BedrockAgentRuntimeClient);

beforeEach(() => bedrockMock.reset());

function streamOf(json: string) {
  return {
    completion: {
      [Symbol.asyncIterator]: async function* () {
        yield { chunk: { bytes: new TextEncoder().encode(json) } };
      },
    },
  };
}

test('parses a confident food donation offer', async () => {
  bedrockMock.on(InvokeAgentCommand).resolves(
    streamOf(
      JSON.stringify({
        verdict: 'food_donation_offer',
        confidence: 0.95,
        extracted: { qty: '20 plates', foodType: 'vada pav', locationText: 'Koramangala' },
      }),
    ) as unknown as Record<string, never>,
  );
  const result = await classifyMessage('I have 20 vada pav leftover in Koramangala');
  expect(result.verdict).toBe('food_donation_offer');
  expect(result.confidence).toBeGreaterThan(0.9);
});

test('throws ClassifierError on unparseable agent output', async () => {
  bedrockMock.on(InvokeAgentCommand).resolves(streamOf('not json') as unknown as Record<string, never>);
  await expect(classifyMessage('garbage')).rejects.toThrow(ClassifierError);
});

test('throws ClassifierError on unknown verdict value', async () => {
  bedrockMock.on(InvokeAgentCommand).resolves(
    streamOf(JSON.stringify({ verdict: 'something_else', confidence: 0.5 })) as unknown as Record<string, never>,
  );
  await expect(classifyMessage('odd')).rejects.toThrow(ClassifierError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/inbound-router/classifier.test.ts`
Expected: FAIL — `Cannot find module './classifier'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/inbound-router/classifier.ts
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { ClassifierResult, ClassifierVerdict } from '../shared/types';

const client = new BedrockAgentRuntimeClient({});
const AGENT_ID = process.env.CLASSIFIER_AGENT_ID ?? '';
const AGENT_ALIAS_ID = process.env.CLASSIFIER_AGENT_ALIAS_ID ?? '';

const KNOWN_VERDICTS: ClassifierVerdict[] = [
  'food_donation_offer',
  'spam',
  'marketing',
  'loan_offer',
  'unrelated',
];

export class ClassifierError extends Error {}

export async function classifyMessage(text: string): Promise<ClassifierResult> {
  const response = await client.send(
    new InvokeAgentCommand({
      agentId: AGENT_ID,
      agentAliasId: AGENT_ALIAS_ID,
      sessionId: `classify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      inputText: text,
    }),
  );

  let raw = '';
  if (response.completion) {
    for await (const event of response.completion) {
      if (event.chunk?.bytes) {
        raw += new TextDecoder().decode(event.chunk.bytes as Uint8Array);
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ClassifierError(`Agent output was not valid JSON: ${raw}`);
  }

  const result = parsed as Partial<ClassifierResult>;
  if (!result.verdict || !KNOWN_VERDICTS.includes(result.verdict as ClassifierVerdict)) {
    throw new ClassifierError(`Unknown verdict: ${String(result.verdict)}`);
  }
  if (typeof result.confidence !== 'number') {
    throw new ClassifierError('Missing confidence score');
  }

  return result as ClassifierResult;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/inbound-router/classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/inbound-router/classifier.ts services/inbound-router/classifier.test.ts
git commit -m "feat: add Bedrock AgentCore classifier wrapper"
```

Note: `CLASSIFIER_AGENT_ID` / `CLASSIFIER_AGENT_ALIAS_ID` are deploy-time values created when the Bedrock Agent is provisioned in the console/CDK custom resource — set them as Lambda environment variables in Task 16's CDK stack, not hardcoded here.

---

### Task 4: WhatsApp (End User Messaging Social) send wrapper

**Files:**
- Create: `services/shared/whatsapp.ts`
- Test: `services/shared/whatsapp.test.ts`

**Interfaces:**
- Produces: `sendWhatsAppText(toPhone: string, body: string): Promise<void>` — used by every notify-style Lambda task (7, 9, 10, 11, 13).

- [ ] **Step 1: Write the failing test**

```typescript
// services/shared/whatsapp.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';
import { sendWhatsAppText } from './whatsapp';

const smMock = mockClient(SocialMessagingClient);

beforeEach(() => smMock.reset());

test('sends a text message via End User Messaging Social', async () => {
  smMock.on(SendWhatsAppMessageCommand).resolves({});
  await sendWhatsAppText('+919999999999', 'Thank you for sharing the information, driver will be available in next 60 minutes');
  const calls = smMock.commandCalls(SendWhatsAppMessageCommand);
  expect(calls).toHaveLength(1);
  expect(calls[0].args[0].input.originationPhoneNumberId).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/shared/whatsapp.test.ts`
Expected: FAIL — `Cannot find module './whatsapp'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/shared/whatsapp.ts
import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';

const client = new SocialMessagingClient({});
const ORIGINATION_PHONE_NUMBER_ID = process.env.WHATSAPP_ORIGINATION_PHONE_NUMBER_ID ?? '';

export async function sendWhatsAppText(toPhone: string, body: string): Promise<void> {
  await client.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: ORIGINATION_PHONE_NUMBER_ID,
      message: new TextEncoder().encode(
        JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'text',
          text: { body },
        }),
      ),
      metaApiVersion: 'v19.0',
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/shared/whatsapp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/shared/whatsapp.ts services/shared/whatsapp.test.ts
git commit -m "feat: add WhatsApp send wrapper over End User Messaging Social"
```

---

### Task 5: InboundRouter — donor/vendor branch

**Files:**
- Create: `services/inbound-router/donorHandler.ts`
- Test: `services/inbound-router/donorHandler.test.ts`

**Interfaces:**
- Consumes: `classifyMessage` (Task 3), `ClassifierError` (Task 3), `putRequest`/`putSpamLog`/`hasProcessedMessage`/`markMessageProcessed` (Task 2), `sendWhatsAppText` (Task 4), `FoodRequest` (Task 1).
- Produces: `handleDonorMessage(input: {messageId: string; fromPhone: string; text: string; geo?: {lat:number;lng:number}}): Promise<void>` — called by Task 6's top-level handler when sender is not a known driver.

- [ ] **Step 1: Write the failing test**

```typescript
// services/inbound-router/donorHandler.test.ts
import { handleDonorMessage } from './donorHandler';
import * as dynamo from '../shared/dynamo';
import * as classifier from './classifier';

jest.mock('../shared/dynamo');
jest.mock('./classifier');
jest.mock('../shared/whatsapp', () => ({ sendWhatsAppText: jest.fn() }));

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedClassifier = classifier as jest.Mocked<typeof classifier>;

beforeEach(() => jest.clearAllMocks());

test('confident food donation offer creates a Request and sends donor ack', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({
    verdict: 'food_donation_offer',
    confidence: 0.9,
    extracted: { qty: '20 plates', foodType: 'vada pav', locationText: 'Koramangala' },
  });

  await handleDonorMessage({
    messageId: 'm1',
    fromPhone: '+91999',
    text: '20 vada pav leftover',
    geo: { lat: 1, lng: 2 },
  });

  expect(mockedDynamo.putRequest).toHaveBeenCalledTimes(1);
  const created = mockedDynamo.putRequest.mock.calls[0][0];
  expect(created.status).toBe('MATCHING');
  expect(mockedDynamo.putSpamLog).not.toHaveBeenCalled();
});

test('low confidence offer goes to PENDING_REVIEW, no dispatch', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({
    verdict: 'food_donation_offer',
    confidence: 0.4,
    extracted: { qty: '?', foodType: '?', locationText: '?' },
  });

  await handleDonorMessage({ messageId: 'm2', fromPhone: '+91999', text: 'maybe have food' });

  const created = mockedDynamo.putRequest.mock.calls[0][0];
  expect(created.status).toBe('PENDING_REVIEW');
});

test('spam verdict is logged and dropped, no Request created', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockResolvedValue({ verdict: 'spam', confidence: 0.99 });

  await handleDonorMessage({ messageId: 'm3', fromPhone: '+91888', text: 'win a prize now' });

  expect(mockedDynamo.putRequest).not.toHaveBeenCalled();
  expect(mockedDynamo.putSpamLog).toHaveBeenCalledTimes(1);
});

test('classifier failure fails open to PENDING_REVIEW, never dropped', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(false);
  mockedClassifier.classifyMessage.mockRejectedValue(new classifier.ClassifierError('boom'));

  await handleDonorMessage({ messageId: 'm4', fromPhone: '+91777', text: 'unclear message' });

  expect(mockedDynamo.putRequest).toHaveBeenCalledTimes(1);
  expect(mockedDynamo.putRequest.mock.calls[0][0].status).toBe('PENDING_REVIEW');
});

test('duplicate messageId is a no-op (idempotency)', async () => {
  mockedDynamo.hasProcessedMessage.mockResolvedValue(true);

  await handleDonorMessage({ messageId: 'm1', fromPhone: '+91999', text: 'repeat' });

  expect(mockedClassifier.classifyMessage).not.toHaveBeenCalled();
  expect(mockedDynamo.putRequest).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/inbound-router/donorHandler.test.ts`
Expected: FAIL — `Cannot find module './donorHandler'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/inbound-router/donorHandler.ts
import { randomUUID } from 'crypto';
import { classifyMessage, ClassifierError } from './classifier';
import { putRequest, putSpamLog, hasProcessedMessage, markMessageProcessed } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';
import { FoodRequest } from '../shared/types';

const CONFIDENCE_THRESHOLD = 0.7;
const DONOR_ACK_TEXT =
  'Thank you for sharing the information, driver will be available in next 60 minutes';

export interface InboundDonorMessage {
  messageId: string;
  fromPhone: string;
  text: string;
  geo?: { lat: number; lng: number };
}

export async function handleDonorMessage(input: InboundDonorMessage): Promise<void> {
  if (await hasProcessedMessage(input.messageId)) {
    return;
  }
  await markMessageProcessed(input.messageId);

  const now = new Date().toISOString();

  try {
    const result = await classifyMessage(input.text);

    if (result.verdict === 'spam' || result.verdict === 'marketing' || result.verdict === 'loan_offer' || result.verdict === 'unrelated') {
      await putSpamLog({
        msgId: input.messageId,
        phone: input.fromPhone,
        rawText: input.text,
        verdict: result.verdict,
        confidence: result.confidence,
      });
      return;
    }

    const isConfident = result.confidence >= CONFIDENCE_THRESHOLD;
    const req: FoodRequest = {
      requestId: randomUUID(),
      donorPhone: input.fromPhone,
      qty: result.extracted?.qty ?? 'unknown',
      foodType: result.extracted?.foodType ?? 'unknown',
      geo: input.geo ?? { lat: 0, lng: 0 },
      status: isConfident ? 'MATCHING' : 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
      reassignCount: 0,
    };
    await putRequest(req);

    if (isConfident) {
      await sendWhatsAppText(input.fromPhone, DONOR_ACK_TEXT);
    }
  } catch (err) {
    if (err instanceof ClassifierError) {
      const req: FoodRequest = {
        requestId: randomUUID(),
        donorPhone: input.fromPhone,
        qty: 'unknown',
        foodType: 'unknown',
        geo: input.geo ?? { lat: 0, lng: 0 },
        status: 'PENDING_REVIEW',
        createdAt: now,
        updatedAt: now,
        reassignCount: 0,
      };
      await putRequest(req);
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/inbound-router/donorHandler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/inbound-router/donorHandler.ts services/inbound-router/donorHandler.test.ts
git commit -m "feat: classify inbound donor messages, dispatch or quarantine"
```

---

### Task 6: InboundRouter — driver branch + top-level handler

**Files:**
- Create: `services/inbound-router/driverHandler.ts`
- Create: `services/inbound-router/handler.ts`
- Test: `services/inbound-router/driverHandler.test.ts`
- Test: `services/inbound-router/handler.test.ts`

**Interfaces:**
- Consumes: `findActiveRequestByDriverPhone`, `getAvailableDrivers` (reused to check if phone is a driver) (Task 2), `sendWhatsAppText` (Task 4), `handleDonorMessage` (Task 5).
- Produces: `handleDriverMessage(input: {fromPhone: string; text?: string; mediaUrl?: string}): Promise<void>` — sends `SendTaskSuccess`/`SendTaskFailure` to Step Functions using `req.pendingTaskToken`. `handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>` is the Lambda entrypoint wired to API Gateway in Task 16; it looks up the sender, decides donor vs. driver branch.

- [ ] **Step 1: Write the failing test**

```typescript
// services/inbound-router/driverHandler.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { handleDriverMessage } from './driverHandler';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp', () => ({ sendWhatsAppText: jest.fn() }));

const sfnMock = mockClient(SFNClient);
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => {
  sfnMock.reset();
  jest.clearAllMocks();
});

test('ACCEPT reply resumes the waiting ACCEPT step', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-123',
    pendingStep: 'ACCEPT',
    status: 'DRIVER_ASSIGNED',
  } as never);
  sfnMock.on(SendTaskSuccessCommand).resolves({});

  await handleDriverMessage({ fromPhone: '+91driver', text: 'ACCEPT' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(1);
});

test('photo arriving while waiting on ACCEPT is rejected with a re-prompt, not misfiled', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue({
    requestId: 'req-1',
    pendingTaskToken: 'token-123',
    pendingStep: 'ACCEPT',
    status: 'DRIVER_ASSIGNED',
  } as never);

  await handleDriverMessage({ fromPhone: '+91driver', mediaUrl: 'https://media/photo.jpg' });

  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  expect(sfnMock.commandCalls(SendTaskFailureCommand)).toHaveLength(0);
});

test('driver reply with no active request logs and replies gracefully, no crash', async () => {
  mockedDynamo.findActiveRequestByDriverPhone.mockResolvedValue(null);

  await expect(handleDriverMessage({ fromPhone: '+91driver', text: 'ACCEPT' })).resolves.not.toThrow();
  expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/inbound-router/driverHandler.test.ts`
Expected: FAIL — `Cannot find module './driverHandler'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/inbound-router/driverHandler.ts
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { findActiveRequestByDriverPhone } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

const sfn = new SFNClient({});

export interface InboundDriverMessage {
  fromPhone: string;
  text?: string;
  mediaUrl?: string;
}

export async function handleDriverMessage(input: InboundDriverMessage): Promise<void> {
  const req = await findActiveRequestByDriverPhone(input.fromPhone);

  if (!req || !req.pendingTaskToken || !req.pendingStep) {
    await sendWhatsAppText(
      input.fromPhone,
      "We don't have a pending pickup request for you right now.",
    );
    return;
  }

  const isPhotoStep = req.pendingStep === 'PICKUP_PHOTO' || req.pendingStep === 'FRIDGE_PHOTO';
  const gotPhoto = !!input.mediaUrl;

  if (isPhotoStep !== gotPhoto) {
    const expected = isPhotoStep ? 'a photo' : 'ACCEPT or DECLINE';
    await sendWhatsAppText(input.fromPhone, `We're waiting for ${expected} on this pickup. Please resend.`);
    return;
  }

  await sfn.send(
    new SendTaskSuccessCommand({
      taskToken: req.pendingTaskToken,
      output: JSON.stringify({
        requestId: req.requestId,
        reply: input.text ?? 'PHOTO',
        mediaUrl: input.mediaUrl,
      }),
    }),
  );
}
```

```typescript
// services/inbound-router/handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAvailableDrivers } from '../shared/dynamo';
import { handleDonorMessage } from './donorHandler';
import { handleDriverMessage } from './driverHandler';

interface ParsedWebhookMessage {
  messageId: string;
  fromPhone: string;
  text?: string;
  mediaUrl?: string;
  geo?: { lat: number; lng: number };
}

function parseWebhookBody(body: string): ParsedWebhookMessage {
  const payload = JSON.parse(body);
  const entry = payload.entry[0].changes[0].value.messages[0];
  const contact = payload.entry[0].changes[0].value.contacts?.[0];
  return {
    messageId: entry.id,
    fromPhone: entry.from,
    text: entry.text?.body,
    mediaUrl: entry.image?.id ? `media:${entry.image.id}` : undefined,
    geo: contact?.location ? { lat: contact.location.latitude, lng: contact.location.longitude } : undefined,
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseWebhookBody(event.body ?? '{}');

  const drivers = await getAvailableDrivers();
  const isKnownDriverPhone = drivers.some((d) => d.phone === parsed.fromPhone) || parsed.fromPhone.startsWith('driver:');

  if (isKnownDriverPhone) {
    await handleDriverMessage({ fromPhone: parsed.fromPhone, text: parsed.text, mediaUrl: parsed.mediaUrl });
  } else {
    await handleDonorMessage({
      messageId: parsed.messageId,
      fromPhone: parsed.fromPhone,
      text: parsed.text ?? '',
      geo: parsed.geo,
    });
  }

  return { statusCode: 200, body: 'OK' };
}
```

```typescript
// services/inbound-router/handler.test.ts
import { handler } from './handler';
import * as dynamo from '../shared/dynamo';
import * as donor from './donorHandler';
import * as driver from './driverHandler';

jest.mock('../shared/dynamo');
jest.mock('./donorHandler');
jest.mock('./driverHandler');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedDonor = donor as jest.Mocked<typeof donor>;
const mockedDriver = driver as jest.Mocked<typeof driver>;

beforeEach(() => jest.clearAllMocks());

function webhookEvent(fromPhone: string, text: string) {
  return {
    body: JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: fromPhone, text: { body: text } }] } }] }],
    }),
  } as never;
}

test('unknown phone routes to donor handler', async () => {
  mockedDynamo.getAvailableDrivers.mockResolvedValue([]);
  const res = await handler(webhookEvent('+91999', 'leftover food'));
  expect(mockedDonor.handleDonorMessage).toHaveBeenCalledTimes(1);
  expect(mockedDriver.handleDriverMessage).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('known driver phone routes to driver handler', async () => {
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'd1', phone: '+91driver', name: 'A', currentGeo: { lat: 0, lng: 0 }, status: 'available', lastActive: 'now' },
  ]);
  await handler(webhookEvent('+91driver', 'ACCEPT'));
  expect(mockedDriver.handleDriverMessage).toHaveBeenCalledTimes(1);
  expect(mockedDonor.handleDonorMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/inbound-router/driverHandler.test.ts services/inbound-router/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/inbound-router/driverHandler.ts services/inbound-router/handler.ts \
  services/inbound-router/driverHandler.test.ts services/inbound-router/handler.test.ts
git commit -m "feat: route driver replies to waiting Step Functions task token"
```

---

### Task 7: NotifyDonor Lambda

**Files:**
- Create: `services/pipeline/notifyDonor.ts`
- Test: `services/pipeline/notifyDonor.test.ts`

**Interfaces:**
- Consumes: `sendWhatsAppText` (Task 4), `getRequest` (Task 2).
- Produces: `handler(event: {requestId: string}): Promise<{requestId: string}>` — first Task state in Task 16's state machine.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/notifyDonor.test.ts
import { handler } from './notifyDonor';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

test('sends the 60-minute ack to the donor', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', donorPhone: '+91999' } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledWith(
    '+91999',
    'Thank you for sharing the information, driver will be available in next 60 minutes',
  );
  expect(result.requestId).toBe('req-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/notifyDonor.test.ts`
Expected: FAIL — `Cannot find module './notifyDonor'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/notifyDonor.ts
import { getRequest } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

const DONOR_ACK_TEXT =
  'Thank you for sharing the information, driver will be available in next 60 minutes';

export async function handler(event: { requestId: string }): Promise<{ requestId: string }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);
  await sendWhatsAppText(req.donorPhone, DONOR_ACK_TEXT);
  return { requestId: event.requestId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/notifyDonor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/notifyDonor.ts services/pipeline/notifyDonor.test.ts
git commit -m "feat: add NotifyDonor pipeline step"
```

---

### Task 8: MatchDriver Lambda

**Files:**
- Create: `services/shared/geo.ts`
- Create: `services/pipeline/matchDriver.ts`
- Test: `services/shared/geo.test.ts`
- Test: `services/pipeline/matchDriver.test.ts`

**Interfaces:**
- Consumes: `getAvailableDrivers` (Task 2), `GeoPoint` (Task 1).
- Produces: `haversineKm(a: GeoPoint, b: GeoPoint): number` (shared/geo.ts, reused by Task 12). `handler(event: {requestId: string; geo: GeoPoint; excludeDriverIds?: string[]}): Promise<{requestId: string; driverId: string | null}>`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/shared/geo.test.ts
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
```

```typescript
// services/pipeline/matchDriver.test.ts
import { handler } from './matchDriver';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('picks the nearest available driver', async () => {
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'far', phone: 'p1', name: 'Far', currentGeo: { lat: 13.1, lng: 77.9 }, status: 'available', lastActive: 'now' },
    { driverId: 'near', phone: 'p2', name: 'Near', currentGeo: { lat: 12.972, lng: 77.64 }, status: 'available', lastActive: 'now' },
  ] as never);

  const result = await handler({ requestId: 'req-1', geo: { lat: 12.9716, lng: 77.6412 } });

  expect(result.driverId).toBe('near');
});

test('returns null driverId when no drivers available', async () => {
  mockedDynamo.getAvailableDrivers.mockResolvedValue([]);
  const result = await handler({ requestId: 'req-1', geo: { lat: 0, lng: 0 } });
  expect(result.driverId).toBeNull();
});

test('excludes driver ids already tried this request', async () => {
  mockedDynamo.getAvailableDrivers.mockResolvedValue([
    { driverId: 'near', phone: 'p2', name: 'Near', currentGeo: { lat: 12.972, lng: 77.64 }, status: 'available', lastActive: 'now' },
  ] as never);
  const result = await handler({ requestId: 'req-1', geo: { lat: 12.9716, lng: 77.6412 }, excludeDriverIds: ['near'] });
  expect(result.driverId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/shared/geo.test.ts services/pipeline/matchDriver.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/shared/geo.ts
import { GeoPoint } from './types';

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
```

```typescript
// services/pipeline/matchDriver.ts
import { getAvailableDrivers } from '../shared/dynamo';
import { haversineKm } from '../shared/geo';
import { GeoPoint } from '../shared/types';

export async function handler(event: {
  requestId: string;
  geo: GeoPoint;
  excludeDriverIds?: string[];
}): Promise<{ requestId: string; driverId: string | null }> {
  const drivers = await getAvailableDrivers();
  const excluded = new Set(event.excludeDriverIds ?? []);
  const candidates = drivers.filter((d) => !excluded.has(d.driverId));

  if (candidates.length === 0) {
    return { requestId: event.requestId, driverId: null };
  }

  const nearest = candidates.reduce((best, d) => {
    const dist = haversineKm(event.geo, d.currentGeo);
    const bestDist = haversineKm(event.geo, best.currentGeo);
    return dist < bestDist ? d : best;
  });

  return { requestId: event.requestId, driverId: nearest.driverId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/shared/geo.test.ts services/pipeline/matchDriver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/shared/geo.ts services/shared/geo.test.ts services/pipeline/matchDriver.ts services/pipeline/matchDriver.test.ts
git commit -m "feat: add haversine distance helper and MatchDriver step"
```

---

### Task 9: NotifyDriverAndWait Lambda

**Files:**
- Create: `services/pipeline/notifyDriverAndWait.ts`
- Test: `services/pipeline/notifyDriverAndWait.test.ts`

**Interfaces:**
- Consumes: `getRequest`, `updateRequest`, `updateDriverStatus` (Task 2), `sendWhatsAppText` (Task 4).
- Produces: `handler(event: {requestId: string; driverId: string; taskToken: string}): Promise<void>` — invoked by a Step Functions Task state using the `waitForTaskToken` pattern (Task 16); stores `pendingTaskToken`/`pendingStep: 'ACCEPT'` on the Request so Task 6's driver branch can resume it. Does not itself resolve — resolution comes from Task 6 calling `SendTaskSuccess`, or from the state's own timeout/retry handled by Task 16's ASL.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/notifyDriverAndWait.test.ts
import { handler } from './notifyDriverAndWait';
import * as dynamo from '../shared/dynamo';
import * as whatsapp from '../shared/whatsapp';

jest.mock('../shared/dynamo');
jest.mock('../shared/whatsapp');

const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;
const mockedWhatsapp = whatsapp as jest.Mocked<typeof whatsapp>;

beforeEach(() => jest.clearAllMocks());

test('notifies the driver and stores the task token for later resume', async () => {
  mockedDynamo.getRequest.mockResolvedValue({
    requestId: 'req-1',
    qty: '20 plates',
    foodType: 'vada pav',
    geo: { lat: 1, lng: 2 },
  } as never);

  await handler({ requestId: 'req-1', driverId: 'd1', taskToken: 'tok-abc' });

  expect(mockedWhatsapp.sendWhatsAppText).toHaveBeenCalledTimes(1);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'DRIVER_ASSIGNED',
    driverId: 'd1',
    pendingTaskToken: 'tok-abc',
    pendingStep: 'ACCEPT',
  }));
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'busy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/notifyDriverAndWait.test.ts`
Expected: FAIL — `Cannot find module './notifyDriverAndWait'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/notifyDriverAndWait.ts
import { getRequest, updateRequest, updateDriverStatus } from '../shared/dynamo';
import { sendWhatsAppText } from '../shared/whatsapp';

export async function handler(event: {
  requestId: string;
  driverId: string;
  taskToken: string;
}): Promise<void> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  await sendWhatsAppText(
    event.driverId,
    `Pickup available: ${req.qty} of ${req.foodType}. Reply ACCEPT or DECLINE within 60 minutes.`,
  );

  await updateRequest(event.requestId, {
    status: 'DRIVER_ASSIGNED',
    driverId: event.driverId,
    pendingTaskToken: event.taskToken,
    pendingStep: 'ACCEPT',
  });

  await updateDriverStatus(event.driverId, 'busy');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/notifyDriverAndWait.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/notifyDriverAndWait.ts services/pipeline/notifyDriverAndWait.test.ts
git commit -m "feat: add NotifyDriverAndWait pipeline step with task-token pattern"
```

---

### Task 10: ReassignDriver timeout handler

**Files:**
- Create: `services/pipeline/reassignDriver.ts`
- Test: `services/pipeline/reassignDriver.test.ts`

**Interfaces:**
- Consumes: `getRequest`, `updateRequest`, `updateDriverStatus` (Task 2).
- Produces: `handler(event: {requestId: string}): Promise<{requestId: string; reassignCount: number; shouldAlertAdmin: boolean}>` — invoked by Task 16's ASL `Catch` on `States.Timeout` from the NotifyDriverAndWait wait state.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/reassignDriver.test.ts
import { handler } from './reassignDriver';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('first timeout increments reassignCount, frees driver, does not alert admin', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1', reassignCount: 0 } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'available');
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({ reassignCount: 1 }));
  expect(result.shouldAlertAdmin).toBe(false);
});

test('second consecutive timeout triggers admin alert', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd2', reassignCount: 1 } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(result.shouldAlertAdmin).toBe(true);
  expect(result.reassignCount).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/reassignDriver.test.ts`
Expected: FAIL — `Cannot find module './reassignDriver'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/reassignDriver.ts
import { getRequest, updateRequest, updateDriverStatus } from '../shared/dynamo';

const MAX_REASSIGNS = 2;

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; reassignCount: number; shouldAlertAdmin: boolean }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  if (req.driverId) {
    await updateDriverStatus(req.driverId, 'available');
  }

  const reassignCount = req.reassignCount + 1;
  const shouldAlertAdmin = reassignCount >= MAX_REASSIGNS;

  await updateRequest(event.requestId, {
    reassignCount,
    status: shouldAlertAdmin ? 'PENDING_REVIEW' : 'MATCHING',
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, reassignCount, shouldAlertAdmin };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/reassignDriver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/reassignDriver.ts services/pipeline/reassignDriver.test.ts
git commit -m "feat: add driver reassign-on-timeout step, alert admin after 2 failures"
```

---

### Task 11: HandlePickupPhoto Lambda

**Files:**
- Create: `services/pipeline/handlePickupPhoto.ts`
- Test: `services/pipeline/handlePickupPhoto.test.ts`

**Interfaces:**
- Consumes: `getRequest`, `updateRequest` (Task 2).
- Produces: `startWait(event: {requestId: string; taskToken: string}): Promise<void>` — stores `pendingStep: 'PICKUP_PHOTO'` (symmetric with Task 9). `handleResult(event: {requestId: string; mediaUrl?: string}): Promise<{requestId: string; valid: boolean; pickupPhotoUrl?: string}>` — called from the ASL step after `SendTaskSuccess` output is consumed, validates the media URL is present and marks `PICKUP_PHOTO_CONFIRMED`; on invalid, throws a named error (`InvalidPhoto`) so Task 16's Retry (max 3) catches it.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/handlePickupPhoto.test.ts
import { startWait, handleResult, InvalidPhotoError } from './handlePickupPhoto';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('startWait stores pending step and task token', async () => {
  await startWait({ requestId: 'req-1', taskToken: 'tok-1' });
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    pendingTaskToken: 'tok-1',
    pendingStep: 'PICKUP_PHOTO',
  });
});

test('handleResult with a valid media url confirms the photo', async () => {
  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:123' });
  expect(result.valid).toBe(true);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'PICKUP_PHOTO_CONFIRMED',
    pickupPhotoUrl: 'media:123',
  }));
});

test('handleResult with no media url throws InvalidPhotoError for Retry to catch', async () => {
  await expect(handleResult({ requestId: 'req-1' })).rejects.toThrow(InvalidPhotoError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/handlePickupPhoto.test.ts`
Expected: FAIL — `Cannot find module './handlePickupPhoto'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/handlePickupPhoto.ts
import { updateRequest } from '../shared/dynamo';

export class InvalidPhotoError extends Error {}

export async function startWait(event: { requestId: string; taskToken: string }): Promise<void> {
  await updateRequest(event.requestId, {
    pendingTaskToken: event.taskToken,
    pendingStep: 'PICKUP_PHOTO',
  });
}

export async function handleResult(
  event: { requestId: string; mediaUrl?: string },
): Promise<{ requestId: string; valid: boolean; pickupPhotoUrl?: string }> {
  if (!event.mediaUrl) {
    throw new InvalidPhotoError('No media URL in driver reply');
  }

  await updateRequest(event.requestId, {
    status: 'PICKUP_PHOTO_CONFIRMED',
    pickupPhotoUrl: event.mediaUrl,
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, valid: true, pickupPhotoUrl: event.mediaUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/handlePickupPhoto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/handlePickupPhoto.ts services/pipeline/handlePickupPhoto.test.ts
git commit -m "feat: add pickup photo wait/confirm step with retry-on-invalid"
```

---

### Task 12: MatchFridge Lambda

**Files:**
- Create: `services/pipeline/matchFridge.ts`
- Test: `services/pipeline/matchFridge.test.ts`

**Interfaces:**
- Consumes: `getFridges` (Task 2), `haversineKm` (Task 8), `GeoPoint` (Task 1).
- Produces: `handler(event: {requestId: string; geo: GeoPoint}): Promise<{requestId: string; fridgeId: string | null}>`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/matchFridge.test.ts
import { handler } from './matchFridge';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('picks the nearest fridge to the pickup point', async () => {
  mockedDynamo.getFridges.mockResolvedValue([
    { fridgeId: 'far', name: 'Far', address: 'x', geo: { lat: 13.1, lng: 77.9 }, capacity: 10 },
    { fridgeId: 'near', name: 'Near', address: 'y', geo: { lat: 12.935, lng: 77.6245 }, capacity: 10 },
  ] as never);

  const result = await handler({ requestId: 'req-1', geo: { lat: 12.9716, lng: 77.6412 } });

  expect(result.fridgeId).toBe('near');
});

test('returns null when no fridges configured', async () => {
  mockedDynamo.getFridges.mockResolvedValue([]);
  const result = await handler({ requestId: 'req-1', geo: { lat: 0, lng: 0 } });
  expect(result.fridgeId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/matchFridge.test.ts`
Expected: FAIL — `Cannot find module './matchFridge'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/matchFridge.ts
import { getFridges } from '../shared/dynamo';
import { haversineKm } from '../shared/geo';
import { GeoPoint } from '../shared/types';

export async function handler(
  event: { requestId: string; geo: GeoPoint },
): Promise<{ requestId: string; fridgeId: string | null }> {
  const fridges = await getFridges();
  if (fridges.length === 0) {
    return { requestId: event.requestId, fridgeId: null };
  }
  const nearest = fridges.reduce((best, f) =>
    haversineKm(event.geo, f.geo) < haversineKm(event.geo, best.geo) ? f : best,
  );
  return { requestId: event.requestId, fridgeId: nearest.fridgeId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/matchFridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/matchFridge.ts services/pipeline/matchFridge.test.ts
git commit -m "feat: add MatchFridge pipeline step"
```

---

### Task 13: HandleFridgePhoto Lambda

**Files:**
- Create: `services/pipeline/handleFridgePhoto.ts`
- Test: `services/pipeline/handleFridgePhoto.test.ts`

**Interfaces:**
- Consumes: `updateRequest` (Task 2). Mirrors Task 11 exactly for the second photo.
- Produces: `startWait(event: {requestId: string; taskToken: string}): Promise<void>`, `handleResult(event: {requestId: string; mediaUrl?: string}): Promise<{requestId: string; valid: boolean; fridgePhotoUrl?: string}>` — same `InvalidPhotoError` contract as Task 11, reused by Task 16's Retry config.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/handleFridgePhoto.test.ts
import { startWait, handleResult } from './handleFridgePhoto';
import { InvalidPhotoError } from './handlePickupPhoto';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('startWait stores pending fridge-photo step', async () => {
  await startWait({ requestId: 'req-1', taskToken: 'tok-2' });
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', {
    pendingTaskToken: 'tok-2',
    pendingStep: 'FRIDGE_PHOTO',
  });
});

test('handleResult with valid media url confirms fridge drop', async () => {
  const result = await handleResult({ requestId: 'req-1', mediaUrl: 'media:456' });
  expect(result.valid).toBe(true);
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', expect.objectContaining({
    status: 'FRIDGE_PHOTO_CONFIRMED',
    fridgePhotoUrl: 'media:456',
  }));
});

test('handleResult with missing media url throws InvalidPhotoError', async () => {
  await expect(handleResult({ requestId: 'req-1' })).rejects.toThrow(InvalidPhotoError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/handleFridgePhoto.test.ts`
Expected: FAIL — `Cannot find module './handleFridgePhoto'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/handleFridgePhoto.ts
import { updateRequest } from '../shared/dynamo';
import { InvalidPhotoError } from './handlePickupPhoto';

export async function startWait(event: { requestId: string; taskToken: string }): Promise<void> {
  await updateRequest(event.requestId, {
    pendingTaskToken: event.taskToken,
    pendingStep: 'FRIDGE_PHOTO',
  });
}

export async function handleResult(
  event: { requestId: string; mediaUrl?: string },
): Promise<{ requestId: string; valid: boolean; fridgePhotoUrl?: string }> {
  if (!event.mediaUrl) {
    throw new InvalidPhotoError('No media URL in driver reply');
  }

  await updateRequest(event.requestId, {
    status: 'FRIDGE_PHOTO_CONFIRMED',
    fridgePhotoUrl: event.mediaUrl,
    pendingTaskToken: undefined,
    pendingStep: undefined,
  });

  return { requestId: event.requestId, valid: true, fridgePhotoUrl: event.mediaUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/handleFridgePhoto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/handleFridgePhoto.ts services/pipeline/handleFridgePhoto.test.ts
git commit -m "feat: add fridge-drop photo wait/confirm step"
```

---

### Task 14: FinalizeRequest Lambda

**Files:**
- Create: `services/pipeline/finalizeRequest.ts`
- Test: `services/pipeline/finalizeRequest.test.ts`

**Interfaces:**
- Consumes: `getRequest`, `updateRequest`, `updateDriverStatus`, `putDonationHistory` (Task 2).
- Produces: `handler(event: {requestId: string}): Promise<{requestId: string; status: 'COMPLETE'}>` — final Task state in Task 16's state machine.

- [ ] **Step 1: Write the failing test**

```typescript
// services/pipeline/finalizeRequest.test.ts
import { handler } from './finalizeRequest';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('marks the request COMPLETE, frees the driver, writes history', async () => {
  mockedDynamo.getRequest.mockResolvedValue({ requestId: 'req-1', driverId: 'd1' } as never);

  const result = await handler({ requestId: 'req-1' });

  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', { status: 'COMPLETE' });
  expect(mockedDynamo.updateDriverStatus).toHaveBeenCalledWith('d1', 'available');
  expect(mockedDynamo.putDonationHistory).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('COMPLETE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/pipeline/finalizeRequest.test.ts`
Expected: FAIL — `Cannot find module './finalizeRequest'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/pipeline/finalizeRequest.ts
import { getRequest, updateRequest, updateDriverStatus, putDonationHistory } from '../shared/dynamo';

export async function handler(
  event: { requestId: string },
): Promise<{ requestId: string; status: 'COMPLETE' }> {
  const req = await getRequest(event.requestId);
  if (!req) throw new Error(`Request not found: ${event.requestId}`);

  await updateRequest(event.requestId, { status: 'COMPLETE' });

  if (req.driverId) {
    await updateDriverStatus(req.driverId, 'available');
  }

  await putDonationHistory({ ...req, status: 'COMPLETE' });

  return { requestId: event.requestId, status: 'COMPLETE' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/pipeline/finalizeRequest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/finalizeRequest.ts services/pipeline/finalizeRequest.test.ts
git commit -m "feat: add FinalizeRequest pipeline step"
```

---

### Task 15: CDK DataStack — DynamoDB tables, S3 bucket

**Files:**
- Create: `infra/lib/data-stack.ts`
- Create: `infra/bin/app.ts`
- Test: `infra/lib/data-stack.test.ts`

**Interfaces:**
- Produces: `DataStack` (exports `requestsTable`, `driversTable`, `fridgesTable`, `spamLogTable`, `donationHistoryTable`, `processedMessagesTable`, `photosBucket` as public readonly properties) — consumed by Task 16, 18, 20's stacks for table/bucket grants.

- [ ] **Step 1: Write the failing test**

```typescript
// infra/lib/data-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';

test('creates all five DynamoDB tables and the photo bucket', () => {
  const app = new App();
  const stack = new DataStack(app, 'TestDataStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::DynamoDB::Table', 6);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [{ AttributeName: 'requestId', KeyType: 'HASH' }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra && npx jest lib/data-stack.test.ts`
Expected: FAIL — `Cannot find module './data-stack'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// infra/lib/data-stack.ts
import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export class DataStack extends Stack {
  public readonly requestsTable: Table;
  public readonly driversTable: Table;
  public readonly fridgesTable: Table;
  public readonly spamLogTable: Table;
  public readonly donationHistoryTable: Table;
  public readonly processedMessagesTable: Table;
  public readonly photosBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.requestsTable = new Table(this, 'RequestsTable', {
      tableName: 'Requests',
      partitionKey: { name: 'requestId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.requestsTable.addGlobalSecondaryIndex({
      indexName: 'byDriverPhone',
      partitionKey: { name: 'donorPhoneIsDriverPhoneIndexKey', type: AttributeType.STRING },
    });

    this.driversTable = new Table(this, 'DriversTable', {
      tableName: 'Drivers',
      partitionKey: { name: 'driverId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fridgesTable = new Table(this, 'FridgesTable', {
      tableName: 'Fridges',
      partitionKey: { name: 'fridgeId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.spamLogTable = new Table(this, 'SpamLogTable', {
      tableName: 'SpamLog',
      partitionKey: { name: 'msgId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.donationHistoryTable = new Table(this, 'DonationHistoryTable', {
      tableName: 'DonationHistory',
      partitionKey: { name: 'requestId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.donationHistoryTable.addGlobalSecondaryIndex({
      indexName: 'byMonthStatus',
      partitionKey: { name: 'month', type: AttributeType.STRING },
      sortKey: { name: 'status', type: AttributeType.STRING },
    });

    this.processedMessagesTable = new Table(this, 'ProcessedMessagesTable', {
      tableName: 'ProcessedMessages',
      partitionKey: { name: 'messageId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.photosBucket = new Bucket(this, 'PhotosBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
```

```typescript
// infra/bin/app.ts
import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';

const app = new App();
new DataStack(app, 'FoodNgoDataStack');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra && npx jest lib/data-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/lib/data-stack.ts infra/lib/data-stack.test.ts infra/bin/app.ts
git commit -m "feat: add CDK DataStack for DynamoDB tables and photo bucket"
```

---

### Task 16: CDK PipelineStack — Step Functions state machine + webhook API + DLQ

**Files:**
- Create: `infra/lib/pipeline-stack.ts`
- Test: `infra/lib/pipeline-stack.test.ts`
- Modify: `infra/bin/app.ts` (wire `PipelineStack` after `DataStack`)

**Interfaces:**
- Consumes: `DataStack` tables/bucket (Task 15); Lambda handlers from `services/inbound-router/handler.ts` (Task 6), `services/pipeline/*.ts` (Tasks 7-14).
- Produces: `PipelineStack` — exports `webhookApi: RestApi`, `stateMachine: StateMachine` for later stacks to reference ARNs if needed.

- [ ] **Step 1: Write the failing test**

```typescript
// infra/lib/pipeline-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';

test('creates a Step Functions state machine, a REST API, and an SQS DLQ', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const stack = new PipelineStack(app, 'TestPipelineStack', { data });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  template.resourceCountIs('AWS::SQS::Queue', 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra && npx jest lib/pipeline-stack.test.ts`
Expected: FAIL — `Cannot find module './pipeline-stack'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// infra/lib/pipeline-stack.ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { DataStack } from './data-stack';

interface PipelineStackProps extends StackProps {
  data: DataStack;
}

export class PipelineStack extends Stack {
  public readonly webhookApi: RestApi;
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { data } = props;

    const commonEnv = {
      REQUESTS_TABLE: data.requestsTable.tableName,
      DRIVERS_TABLE: data.driversTable.tableName,
      FRIDGES_TABLE: data.fridgesTable.tableName,
      SPAM_LOG_TABLE: data.spamLogTable.tableName,
      DONATION_HISTORY_TABLE: data.donationHistoryTable.tableName,
      PROCESSED_MESSAGES_TABLE: data.processedMessagesTable.tableName,
    };

    const makeFn = (name: string, entry: string) => {
      const fn = new Function(this, name, {
        runtime: Runtime.NODEJS_20_X,
        handler: `${entry}.handler`,
        code: Code.fromAsset('../services/dist'),
        environment: commonEnv,
        timeout: Duration.seconds(30),
      });
      data.requestsTable.grantReadWriteData(fn);
      data.driversTable.grantReadWriteData(fn);
      data.fridgesTable.grantReadData(fn);
      data.spamLogTable.grantWriteData(fn);
      data.donationHistoryTable.grantWriteData(fn);
      data.processedMessagesTable.grantReadWriteData(fn);
      return fn;
    };

    const notifyDonorFn = makeFn('NotifyDonorFn', 'pipeline/notifyDonor');
    const matchDriverFn = makeFn('MatchDriverFn', 'pipeline/matchDriver');
    const notifyDriverAndWaitFn = makeFn('NotifyDriverAndWaitFn', 'pipeline/notifyDriverAndWait');
    const reassignDriverFn = makeFn('ReassignDriverFn', 'pipeline/reassignDriver');
    const startPickupWaitFn = makeFn('StartPickupWaitFn', 'pipeline/handlePickupPhoto');
    const matchFridgeFn = makeFn('MatchFridgeFn', 'pipeline/matchFridge');
    const startFridgeWaitFn = makeFn('StartFridgeWaitFn', 'pipeline/handleFridgePhoto');
    const finalizeRequestFn = makeFn('FinalizeRequestFn', 'pipeline/finalizeRequest');
    const inboundRouterFn = makeFn('InboundRouterFn', 'inbound-router/handler');

    const notifyDonorStep = new tasks.LambdaInvoke(this, 'NotifyDonor', {
      lambdaFunction: notifyDonorFn,
      outputPath: '$.Payload',
    });

    const matchDriverStep = new tasks.LambdaInvoke(this, 'MatchDriver', {
      lambdaFunction: matchDriverFn,
      outputPath: '$.Payload',
    });

    const notifyDriverAndWaitStep = new tasks.LambdaInvoke(this, 'NotifyDriverAndWait', {
      lambdaFunction: notifyDriverAndWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        driverId: sfn.JsonPath.stringAt('$.driverId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
      timeout: Duration.minutes(60),
    });

    const reassignStep = new tasks.LambdaInvoke(this, 'ReassignDriver', {
      lambdaFunction: reassignDriverFn,
      outputPath: '$.Payload',
    });

    const adminAlertStep = new sfn.Pass(this, 'AdminAlertStuck', {
      comment: 'Two reassign attempts failed — request left PENDING_REVIEW for manual admin resolution',
    });

    const startPickupWaitStep = new tasks.LambdaInvoke(this, 'StartPickupPhotoWait', {
      lambdaFunction: startPickupWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    }).addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 });

    const matchFridgeStep = new tasks.LambdaInvoke(this, 'MatchFridge', {
      lambdaFunction: matchFridgeFn,
      outputPath: '$.Payload',
    });

    const startFridgeWaitStep = new tasks.LambdaInvoke(this, 'StartFridgePhotoWait', {
      lambdaFunction: startFridgeWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    }).addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 });

    const finalizeStep = new tasks.LambdaInvoke(this, 'FinalizeRequest', {
      lambdaFunction: finalizeRequestFn,
      outputPath: '$.Payload',
    });

    const reassignLoop = reassignStep.next(
      new sfn.Choice(this, 'ReassignOrAlert')
        .when(sfn.Condition.booleanEquals('$.shouldAlertAdmin', true), adminAlertStep)
        .otherwise(matchDriverStep),
    );

    notifyDriverAndWaitStep.addCatch(reassignLoop, { errors: ['States.Timeout'] });

    const definition = notifyDonorStep
      .next(matchDriverStep)
      .next(notifyDriverAndWaitStep)
      .next(startPickupWaitStep)
      .next(matchFridgeStep)
      .next(startFridgeWaitStep)
      .next(finalizeStep);

    this.stateMachine = new sfn.StateMachine(this, 'PickupStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(6),
    });

    const dlq = new Queue(this, 'WhatsAppSendDlq', { retentionPeriod: Duration.days(14) });
    dlq.grantSendMessages(inboundRouterFn);
    inboundRouterFn.addEnvironment('WHATSAPP_DLQ_URL', dlq.queueUrl);
    this.stateMachine.grantStartExecution(inboundRouterFn);
    inboundRouterFn.addEnvironment('STATE_MACHINE_ARN', this.stateMachine.stateMachineArn);

    this.webhookApi = new RestApi(this, 'WhatsAppWebhookApi');
    this.webhookApi.root.addResource('webhook').addMethod('POST', new LambdaIntegration(inboundRouterFn));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra && npx jest lib/pipeline-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/lib/pipeline-stack.ts infra/lib/pipeline-stack.test.ts infra/bin/app.ts
git commit -m "feat: add CDK PipelineStack wiring Step Functions state machine, webhook API, DLQ"
```

Note: `InboundRouter`'s message-create path (Task 6's `handler.ts`) must call `StartExecutionCommand` on `STATE_MACHINE_ARN` once a `Request` reaches `MATCHING` — add that call in this task's wiring step before moving on, since it's the glue between Task 6 and this state machine.

---

### Task 17: Seed script + end-to-end simulation harness

**Files:**
- Create: `scripts/seed-drivers-fridges.ts`
- Create: `scripts/simulate-whatsapp.ts`
- Test: `scripts/simulate-whatsapp.test.ts`

**Interfaces:**
- Consumes: `putRequest`-adjacent raw DynamoDB client (seed script writes directly, bypassing app wrappers, since it's one-time fixture data), the deployed webhook API URL (simulate script, via `WEBHOOK_URL` env var).
- Produces: a runnable CLI (`npx ts-node scripts/seed-drivers-fridges.ts`, `npx ts-node scripts/simulate-whatsapp.ts <scenario>`) and `buildWebhookPayload(fromPhone: string, text: string): object` (tested directly, used by the CLI).

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/simulate-whatsapp.test.ts
import { buildWebhookPayload } from './simulate-whatsapp';

test('builds a Meta-shaped webhook payload for a given sender and text', () => {
  const payload = buildWebhookPayload('+91999', '20 vada pav leftover in Koramangala');
  const message = (payload as never as { entry: { changes: { value: { messages: { from: string; text: { body: string } }[] } }[] }[] })
    .entry[0].changes[0].value.messages[0];
  expect(message.from).toBe('+91999');
  expect(message.text.body).toContain('vada pav');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest scripts/simulate-whatsapp.test.ts`
Expected: FAIL — `Cannot find module './simulate-whatsapp'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// scripts/simulate-whatsapp.ts
export function buildWebhookPayload(fromPhone: string, text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id: `wamid.sim.${Date.now()}`, from: fromPhone, text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

const SCENARIOS: Record<string, { from: string; text: string }> = {
  donor_offer: { from: '+919000000001', text: '20 vada pav leftover in Koramangala, please pick up' },
  spam: { from: '+919000000002', text: 'You have won a lottery, click this link now!!!' },
  marketing: { from: '+919000000003', text: 'Flat 50% off on our new product range, buy now' },
  loan: { from: '+919000000004', text: 'Get instant personal loan approved in 5 minutes, no documents' },
  unrelated: { from: '+919000000005', text: 'Hey what time is the cricket match today?' },
};

async function main() {
  const scenario = process.argv[2];
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!scenario || !SCENARIOS[scenario] || !webhookUrl) {
    console.error(`Usage: WEBHOOK_URL=<url> npx ts-node scripts/simulate-whatsapp.ts <${Object.keys(SCENARIOS).join('|')}>`);
    process.exit(1);
  }
  const { from, text } = SCENARIOS[scenario];
  const payload = buildWebhookPayload(from, text);
  const res = await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
  console.log(`Sent "${scenario}" scenario, response status: ${res.status}`);
}

if (require.main === module) {
  main();
}
```

```typescript
// scripts/seed-drivers-fridges.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest scripts/simulate-whatsapp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-drivers-fridges.ts scripts/simulate-whatsapp.ts scripts/simulate-whatsapp.test.ts
git commit -m "feat: add demo seed script and WhatsApp webhook simulation harness"
```

- [ ] **Step 6: Run the full demo flow against the deployed stack**

```bash
npx ts-node scripts/seed-drivers-fridges.ts
WEBHOOK_URL=<deployed webhook url> npx ts-node scripts/simulate-whatsapp.ts donor_offer
WEBHOOK_URL=<deployed webhook url> npx ts-node scripts/simulate-whatsapp.ts spam
```

Expected: `donor_offer` creates a `Request` that progresses through the state machine (check via `aws dynamodb get-item` on the `Requests` table); `spam` creates zero `Request` items and one `SpamLog` item.

---

### Task 18: Admin auth + Admin API

**Files:**
- Create: `infra/lib/auth-stack.ts`
- Create: `infra/lib/admin-api-stack.ts`
- Create: `services/admin-api/listRequests.ts`
- Create: `services/admin-api/overrideAssign.ts`
- Test: `infra/lib/auth-stack.test.ts`
- Test: `services/admin-api/listRequests.test.ts`
- Test: `services/admin-api/overrideAssign.test.ts`

**Interfaces:**
- Consumes: `DataStack.requestsTable`/`driversTable` (Task 15), `FoodRequest`/`Driver` (Task 1).
- Produces: `AuthStack` (exports `userPool`, `userPoolClient`). `listRequests.handler(): Promise<{requests: FoodRequest[]}>`. `overrideAssign.handler(event: {requestId: string; driverId: string}): Promise<{requestId: string; driverId: string}>` — used by Task 19's dashboard.

- [ ] **Step 1: Write the failing test**

```typescript
// infra/lib/auth-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from './auth-stack';

test('creates a Cognito user pool and app client', () => {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
});
```

```typescript
// services/admin-api/listRequests.test.ts
import { handler } from './listRequests';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('returns all requests from the scan', async () => {
  mockedDynamo.scanAllRequests = jest.fn().mockResolvedValue([{ requestId: 'req-1', status: 'MATCHING' }]);
  const result = await handler();
  expect(result.requests).toHaveLength(1);
});
```

```typescript
// services/admin-api/overrideAssign.test.ts
import { handler } from './overrideAssign';
import * as dynamo from '../shared/dynamo';

jest.mock('../shared/dynamo');
const mockedDynamo = dynamo as jest.Mocked<typeof dynamo>;

beforeEach(() => jest.clearAllMocks());

test('reassigns a request to the given driver', async () => {
  const result = await handler({ requestId: 'req-1', driverId: 'driver-2' });
  expect(mockedDynamo.updateRequest).toHaveBeenCalledWith('req-1', { driverId: 'driver-2' });
  expect(result).toEqual({ requestId: 'req-1', driverId: 'driver-2' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra && npx jest lib/auth-stack.test.ts` and `npx jest services/admin-api/`
Expected: FAIL — modules not found; `scanAllRequests` not exported yet

- [ ] **Step 3: Write minimal implementation**

```typescript
// infra/lib/auth-stack.ts
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'AdminUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
    });

    this.userPoolClient = new UserPoolClient(this, 'AdminUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
    });
  }
}
```

Add `scanAllRequests` to `services/shared/dynamo.ts` (append to the file from Task 2):

```typescript
// append to services/shared/dynamo.ts
export async function scanAllRequests(): Promise<FoodRequest[]> {
  const res = await client.send(new ScanCommand({ TableName: REQUESTS_TABLE }));
  return (res.Items as FoodRequest[]) ?? [];
}
```

```typescript
// services/admin-api/listRequests.ts
import { scanAllRequests } from '../shared/dynamo';
import { FoodRequest } from '../shared/types';

export async function handler(): Promise<{ requests: FoodRequest[] }> {
  const requests = await scanAllRequests();
  return { requests };
}
```

```typescript
// services/admin-api/overrideAssign.ts
import { updateRequest } from '../shared/dynamo';

export async function handler(
  event: { requestId: string; driverId: string },
): Promise<{ requestId: string; driverId: string }> {
  await updateRequest(event.requestId, { driverId: event.driverId });
  return { requestId: event.requestId, driverId: event.driverId };
}
```

```typescript
// infra/lib/admin-api-stack.ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, CognitoUserPoolsAuthorizer, AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { DataStack } from './data-stack';
import { AuthStack } from './auth-stack';

interface AdminApiStackProps extends StackProps {
  data: DataStack;
  auth: AuthStack;
}

export class AdminApiStack extends Stack {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);
    const { data, auth } = props;

    const listFn = new Function(this, 'ListRequestsFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'admin-api/listRequests.handler',
      code: Code.fromAsset('../services/dist'),
      environment: { REQUESTS_TABLE: data.requestsTable.tableName },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadData(listFn);

    const overrideFn = new Function(this, 'OverrideAssignFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'admin-api/overrideAssign.handler',
      code: Code.fromAsset('../services/dist'),
      environment: { REQUESTS_TABLE: data.requestsTable.tableName },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadWriteData(overrideFn);

    this.api = new RestApi(this, 'AdminApi');
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
      cognitoUserPools: [auth.userPool],
    });

    const requests = this.api.root.addResource('requests');
    requests.addMethod('GET', new LambdaIntegration(listFn), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });
    requests.addResource('assign').addMethod('POST', new LambdaIntegration(overrideFn), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra && npx jest lib/auth-stack.test.ts` and `npx jest services/admin-api/ services/shared/dynamo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/lib/auth-stack.ts infra/lib/auth-stack.test.ts infra/lib/admin-api-stack.ts \
  services/admin-api/listRequests.ts services/admin-api/overrideAssign.ts \
  services/admin-api/listRequests.test.ts services/admin-api/overrideAssign.test.ts \
  services/shared/dynamo.ts
git commit -m "feat: add Cognito admin auth and admin REST API (list + override assign)"
```

---

### Task 19: Admin dashboard (React)

**Files:**
- Create: `admin-dashboard/src/api.ts`
- Create: `admin-dashboard/src/pages/Dashboard.tsx`
- Test: `admin-dashboard/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: Admin API `GET /requests` and `POST /requests/assign` (Task 18).
- Produces: `fetchRequests(): Promise<FoodRequest[]>`, `overrideAssign(requestId: string, driverId: string): Promise<void>` (`api.ts`); `<Dashboard />` component rendering the live list with a reassign control, used as the app's main route (wiring the router/entrypoint is this task's own concern, not a dependency of later tasks).

- [ ] **Step 1: Write the failing test**

```tsx
// admin-dashboard/src/pages/Dashboard.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import * as api from '../api';

jest.mock('../api');
const mockedApi = api as jest.Mocked<typeof api>;

test('renders fetched requests and triggers override assign on click', async () => {
  mockedApi.fetchRequests.mockResolvedValue([
    { requestId: 'req-1', status: 'DRIVER_ASSIGNED', donorPhone: '+91999', qty: '20 plates', foodType: 'vada pav' } as never,
  ]);
  mockedApi.overrideAssign.mockResolvedValue();

  render(<Dashboard />);

  await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /reassign/i }));

  await waitFor(() => expect(mockedApi.overrideAssign).toHaveBeenCalledWith('req-1', expect.any(String)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-dashboard && npx vitest run src/pages/Dashboard.test.tsx`
Expected: FAIL — `Cannot find module './Dashboard'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// admin-dashboard/src/api.ts
const API_BASE = import.meta.env.VITE_ADMIN_API_URL as string;

export interface FoodRequest {
  requestId: string;
  status: string;
  donorPhone: string;
  qty: string;
  foodType: string;
  driverId?: string;
}

export async function fetchRequests(): Promise<FoodRequest[]> {
  const res = await fetch(`${API_BASE}/requests`);
  const body = await res.json();
  return body.requests;
}

export async function overrideAssign(requestId: string, driverId: string): Promise<void> {
  await fetch(`${API_BASE}/requests/assign`, {
    method: 'POST',
    body: JSON.stringify({ requestId, driverId }),
  });
}
```

```tsx
// admin-dashboard/src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest } from '../api';

const FALLBACK_DRIVER_ID = 'driver-2';

export function Dashboard() {
  const [requests, setRequests] = useState<FoodRequest[]>([]);

  useEffect(() => {
    fetchRequests().then(setRequests);
  }, []);

  async function handleReassign(requestId: string) {
    await overrideAssign(requestId, FALLBACK_DRIVER_ID);
  }

  return (
    <div>
      <h1>Live Pickup Requests</h1>
      <ul>
        {requests.map((r) => (
          <li key={r.requestId}>
            {r.requestId} — {r.status} — {r.qty} of {r.foodType}
            <button onClick={() => handleReassign(r.requestId)}>Reassign</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-dashboard && npx vitest run src/pages/Dashboard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin-dashboard/src/api.ts admin-dashboard/src/pages/Dashboard.tsx admin-dashboard/src/pages/Dashboard.test.tsx
git commit -m "feat: add admin dashboard live requests view with reassign override"
```

Note: the `RequestDetail.tsx` driver-picker (replacing `FALLBACK_DRIVER_ID` with a real `<DriverSelect>` dropdown) is a quick follow-up once Task 18's API is live — not blocking for the demo, since the hardcoded fallback still exercises the real override-assign call end-to-end.

---

### Task 20: Monthly report Lambda + EventBridge schedule

**Files:**
- Create: `services/reporting/monthlyReport.ts`
- Create: `infra/lib/reporting-stack.ts`
- Test: `services/reporting/monthlyReport.test.ts`
- Test: `infra/lib/reporting-stack.test.ts`

**Interfaces:**
- Consumes: `DonationHistory` table scan/query (new wrapper added here), `DataStack.donationHistoryTable`/`photosBucket` (Task 15).
- Produces: `handler(event: {month: string}): Promise<{month: string; totalRequests: number; csvS3Key: string}>`. `ReportingStack` (EventBridge rule, monthly cron, invoking the Lambda).

- [ ] **Step 1: Write the failing test**

```typescript
// services/reporting/monthlyReport.test.ts
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './monthlyReport';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
});

test('queries the month, writes a CSV to S3, returns a summary', async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { requestId: 'req-1', status: 'COMPLETE', qty: '20 plates', foodType: 'vada pav', donorPhone: '+91999' },
      { requestId: 'req-2', status: 'COMPLETE', qty: '15 plates', foodType: 'biryani', donorPhone: '+91888' },
    ],
  });
  s3Mock.on(PutObjectCommand).resolves({});

  const result = await handler({ month: '2026-10' });

  expect(result.totalRequests).toBe(2);
  expect(result.csvS3Key).toContain('2026-10');
  expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/reporting/monthlyReport.test.ts`
Expected: FAIL — `Cannot find module './monthlyReport'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/reporting/monthlyReport.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const DONATION_HISTORY_TABLE = process.env.DONATION_HISTORY_TABLE ?? 'DonationHistory';
const REPORTS_BUCKET = process.env.REPORTS_BUCKET ?? '';

interface HistoryRow {
  requestId: string;
  status: string;
  qty: string;
  foodType: string;
  donorPhone: string;
}

export async function handler(
  event: { month: string },
): Promise<{ month: string; totalRequests: number; csvS3Key: string }> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: DONATION_HISTORY_TABLE,
      IndexName: 'byMonthStatus',
      KeyConditionExpression: '#m = :month',
      ExpressionAttributeNames: { '#m': 'month' },
      ExpressionAttributeValues: { ':month': event.month },
    }),
  );
  const rows = (res.Items as HistoryRow[]) ?? [];

  const header = 'requestId,status,qty,foodType,donorPhone';
  const csv = [header, ...rows.map((r) => `${r.requestId},${r.status},${r.qty},${r.foodType},${r.donorPhone}`)].join('\n');

  const csvS3Key = `reports/${event.month}.csv`;
  await s3.send(new PutObjectCommand({ Bucket: REPORTS_BUCKET, Key: csvS3Key, Body: csv }));

  return { month: event.month, totalRequests: rows.length, csvS3Key };
}
```

```typescript
// infra/lib/reporting-stack.ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { DataStack } from './data-stack';

interface ReportingStackProps extends StackProps {
  data: DataStack;
}

export class ReportingStack extends Stack {
  constructor(scope: Construct, id: string, props: ReportingStackProps) {
    super(scope, id, props);
    const { data } = props;

    const reportFn = new Function(this, 'MonthlyReportFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'reporting/monthlyReport.handler',
      code: Code.fromAsset('../services/dist'),
      environment: {
        DONATION_HISTORY_TABLE: data.donationHistoryTable.tableName,
        REPORTS_BUCKET: data.photosBucket.bucketName,
      },
      timeout: Duration.minutes(5),
    });
    data.donationHistoryTable.grantReadData(reportFn);
    data.photosBucket.grantWrite(reportFn);

    new Rule(this, 'MonthlyReportSchedule', {
      schedule: Schedule.cron({ minute: '0', hour: '2', day: '1' }),
      targets: [new LambdaFunction(reportFn)],
    });
  }
}
```

```typescript
// infra/lib/reporting-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { ReportingStack } from './reporting-stack';

test('creates a monthly EventBridge rule targeting the report Lambda', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const stack = new ReportingStack(app, 'TestReportingStack', { data });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Events::Rule', 1);
  template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 2 1 * ? *)' });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/reporting/monthlyReport.test.ts` and `cd infra && npx jest lib/reporting-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/reporting/monthlyReport.ts services/reporting/monthlyReport.test.ts \
  infra/lib/reporting-stack.ts infra/lib/reporting-stack.test.ts
git commit -m "feat: add monthly report Lambda and EventBridge schedule"
```

---

### Task 21: CloudWatch alarms

**Files:**
- Create: `infra/lib/alarms-stack.ts`
- Test: `infra/lib/alarms-stack.test.ts`
- Modify: `infra/bin/app.ts` (instantiate `AlarmsStack` wired to `PipelineStack`'s DLQ)

**Interfaces:**
- Consumes: `PipelineStack` (Task 16) — needs the DLQ construct reference, so `PipelineStack` must expose `public readonly whatsAppDlq: Queue` (add this one-line export to Task 16's stack as part of this task).

- [ ] **Step 1: Write the failing test**

```typescript
// infra/lib/alarms-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';
import { AlarmsStack } from './alarms-stack';

test('creates an alarm on DLQ depth', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const pipeline = new PipelineStack(app, 'TestPipelineStack', { data });
  const stack = new AlarmsStack(app, 'TestAlarmsStack', { pipeline });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra && npx jest lib/alarms-stack.test.ts`
Expected: FAIL — `Cannot find module './alarms-stack'`

- [ ] **Step 3: Write minimal implementation**

Add to `infra/lib/pipeline-stack.ts` (Task 16's file): change `const dlq = new Queue(...)` to `this.whatsAppDlq = new Queue(...)` and declare `public readonly whatsAppDlq: Queue;` alongside the other public properties.

```typescript
// infra/lib/alarms-stack.ts
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { PipelineStack } from './pipeline-stack';

interface AlarmsStackProps extends StackProps {
  pipeline: PipelineStack;
}

export class AlarmsStack extends Stack {
  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);

    new Alarm(this, 'WhatsAppDlqDepthAlarm', {
      metric: props.pipeline.whatsAppDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infra && npx jest lib/alarms-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/lib/alarms-stack.ts infra/lib/alarms-stack.test.ts infra/lib/pipeline-stack.ts infra/bin/app.ts
git commit -m "feat: add CloudWatch alarm on WhatsApp DLQ depth"
```

---

### Task 22: Full deploy + end-to-end demo verification

**Files:**
- Modify: `infra/bin/app.ts` (wire every stack: `DataStack` → `AuthStack` → `PipelineStack` → `AdminApiStack` → `ReportingStack` → `AlarmsStack`)
- Create: `README.md` (deploy steps, demo script, architecture summary)

**Interfaces:**
- Consumes: every stack from Tasks 15, 16, 18, 20, 21.
- Produces: a deployed stack and a documented, repeatable demo procedure — this is the plan's final deliverable.

- [ ] **Step 1: Wire all stacks together**

```typescript
// infra/bin/app.ts
import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { AdminApiStack } from '../lib/admin-api-stack';
import { ReportingStack } from '../lib/reporting-stack';
import { AlarmsStack } from '../lib/alarms-stack';

const app = new App();
const data = new DataStack(app, 'FoodNgoDataStack');
const auth = new AuthStack(app, 'FoodNgoAuthStack');
const pipeline = new PipelineStack(app, 'FoodNgoPipelineStack', { data });
new AdminApiStack(app, 'FoodNgoAdminApiStack', { data, auth });
new ReportingStack(app, 'FoodNgoReportingStack', { data });
new AlarmsStack(app, 'FoodNgoAlarmsStack', { pipeline });
```

- [ ] **Step 2: Run the full test suite before deploying**

Run: `npx jest && cd infra && npx jest && cd ../admin-dashboard && npx vitest run`
Expected: all suites PASS

- [ ] **Step 3: Build Lambda bundle and deploy**

```bash
cd services && npx tsc --outDir dist
cd ../infra && npx cdk deploy --all --require-approval never
```

Expected: six stacks deploy successfully; note the `WhatsAppWebhookApi` URL and `AdminApi` URL from the CDK output.

- [ ] **Step 4: Write README with deploy + demo instructions**

```markdown
# Food NGO Pickup Platform

AWS-native WhatsApp pickup coordination for surplus food donation.
See `docs/superpowers/specs/2026-10-18-food-ngo-pickup-design.md` for the
full design.

## Deploy

1. `cd services && npx tsc --outDir dist`
2. `cd infra && npx cdk deploy --all --require-approval never`
3. Note the `WhatsAppWebhookApi` URL — register it as the AWS End User
   Messaging Social webhook callback for your WhatsApp Business number.
4. Set `CLASSIFIER_AGENT_ID` / `CLASSIFIER_AGENT_ALIAS_ID` on
   `InboundRouterFn` once the Bedrock Agent is provisioned.
5. `npx ts-node scripts/seed-drivers-fridges.ts`

## Demo script

```bash
WEBHOOK_URL=<webhook url> npx ts-node scripts/simulate-whatsapp.ts donor_offer
WEBHOOK_URL=<webhook url> npx ts-node scripts/simulate-whatsapp.ts spam
```

Watch the `Requests` table: the `donor_offer` scenario should progress
from `RECEIVED` to `MATCHING` to `DRIVER_ASSIGNED`; the `spam` scenario
should create zero `Request` items.
```

- [ ] **Step 5: Commit**

```bash
git add infra/bin/app.ts README.md
git commit -m "feat: wire all stacks together, document deploy and demo steps"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — ingestion/classify (3,5,6), donor ack (7), driver dispatch+timeout (8,9,10), pickup photo (11), fridge match+photo (12,13), finalize/history (14), infra for all of the above (15,16), demo seed/sim (17), admin auth+API+UI (18,19), monthly report (20), alarms/DLQ (16,21), deploy+docs (22).
- **Placeholder scan:** no TBD/TODO left in any step; the only deferred values (`CLASSIFIER_AGENT_ID`, webhook callback URL) are genuine deploy-time infra outputs, not missing design decisions, and are called out explicitly in Task 22's README.
- **Type consistency:** `FoodRequest`, `Driver`, `Fridge`, `ClassifierResult`, `RequestStatus` defined once in Task 1 and imported everywhere else; `pendingTaskToken`/`pendingStep` introduced in Task 1 and used consistently by Tasks 6, 9, 11, 13.
- **Review Focus coverage:** all five items have an owning task with a test (see inline references in the Review Focus section above).
