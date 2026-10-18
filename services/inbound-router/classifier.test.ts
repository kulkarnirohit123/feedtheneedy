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

test('correctly handles multi-byte UTF-8 characters split across chunks', async () => {
  // Create JSON with multi-byte character (₹ is 3 bytes in UTF-8)
  const jsonString = JSON.stringify({
    verdict: 'food_donation_offer',
    confidence: 0.9,
    extracted: { qty: '10 meals', foodType: 'dosa', locationText: 'Bangalore ₹100' },
  });

  const fullBytes = new TextEncoder().encode(jsonString);

  // Find where the rupee mark starts and split mid-way through its 3-byte sequence
  const rupeeMark = '₹';
  const posInString = jsonString.indexOf(rupeeMark);
  const bytesBeforeRupee = new TextEncoder().encode(jsonString.substring(0, posInString)).length;
  // Split 1 byte into the 3-byte character
  const splitPoint = bytesBeforeRupee + 1;

  const chunk1 = fullBytes.slice(0, splitPoint);
  const chunk2 = fullBytes.slice(splitPoint);

  bedrockMock.on(InvokeAgentCommand).resolves({
    completion: {
      [Symbol.asyncIterator]: async function* () {
        yield { chunk: { bytes: chunk1 } };
        yield { chunk: { bytes: chunk2 } };
      },
    },
  } as unknown as Record<string, never>);

  const result = await classifyMessage('test');
  expect(result.verdict).toBe('food_donation_offer');
  expect(result.extracted?.locationText).toBe('Bangalore ₹100');
});
