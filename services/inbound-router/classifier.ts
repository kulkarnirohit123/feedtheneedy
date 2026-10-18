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
  try {
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
      const decoder = new TextDecoder();
      for await (const event of response.completion) {
        if (event.chunk?.bytes) {
          raw += decoder.decode(event.chunk.bytes as Uint8Array, { stream: true });
        }
      }
      // Flush any remaining bytes
      raw += decoder.decode();
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
  } catch (err) {
    if (err instanceof ClassifierError) {
      throw err;
    }
    throw new ClassifierError(
      `Bedrock invocation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
