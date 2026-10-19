import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { classifyMessage, ClassifierError } from './classifier';

const bedrockMock = mockClient(BedrockRuntimeClient);

beforeEach(() => bedrockMock.reset());

function modelResponse(text: string) {
  return {
    body: new TextEncoder().encode(JSON.stringify({ output: { message: { content: [{ text }] } } })),
  } as unknown as Record<string, never>;
}

test('parses a confident food donation offer', async () => {
  bedrockMock.on(InvokeModelCommand).resolves(
    modelResponse(
      JSON.stringify({
        verdict: 'food_donation_offer',
        confidence: 0.95,
        extracted: { qty: '20 plates', foodType: 'vada pav', locationText: 'Koramangala' },
      }),
    ),
  );
  const result = await classifyMessage('I have 20 vada pav leftover in Koramangala');
  expect(result.verdict).toBe('food_donation_offer');
  expect(result.confidence).toBeGreaterThan(0.9);
});

test('throws ClassifierError on unparseable model output', async () => {
  bedrockMock.on(InvokeModelCommand).resolves(modelResponse('not json'));
  await expect(classifyMessage('garbage')).rejects.toThrow(ClassifierError);
});

test('throws ClassifierError on unknown verdict value', async () => {
  bedrockMock
    .on(InvokeModelCommand)
    .resolves(modelResponse(JSON.stringify({ verdict: 'something_else', confidence: 0.5 })));
  await expect(classifyMessage('odd')).rejects.toThrow(ClassifierError);
});

test('throws ClassifierError when confidence is missing', async () => {
  bedrockMock
    .on(InvokeModelCommand)
    .resolves(modelResponse(JSON.stringify({ verdict: 'spam' })));
  await expect(classifyMessage('win a prize now')).rejects.toThrow(ClassifierError);
});

test('handles multi-byte UTF-8 characters in the extracted fields', async () => {
  const jsonString = JSON.stringify({
    verdict: 'food_donation_offer',
    confidence: 0.9,
    extracted: { qty: '10 meals', foodType: 'dosa', locationText: 'Bangalore ₹100' },
  });

  bedrockMock.on(InvokeModelCommand).resolves(modelResponse(jsonString));

  const result = await classifyMessage('test');
  expect(result.verdict).toBe('food_donation_offer');
  expect(result.extracted?.locationText).toBe('Bangalore ₹100');
});

test('wraps a Bedrock invocation failure as ClassifierError', async () => {
  bedrockMock.on(InvokeModelCommand).rejects(new Error('throttled'));
  await expect(classifyMessage('anything')).rejects.toThrow(ClassifierError);
});
