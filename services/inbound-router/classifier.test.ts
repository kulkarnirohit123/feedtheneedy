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
