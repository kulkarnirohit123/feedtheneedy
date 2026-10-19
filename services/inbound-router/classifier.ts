import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ClassifierResult, ClassifierVerdict } from '../shared/types';

const client = new BedrockRuntimeClient({});
const MODEL_ID = process.env.CLASSIFIER_MODEL_ID ?? '';

const KNOWN_VERDICTS: ClassifierVerdict[] = [
  'food_donation_offer',
  'spam',
  'marketing',
  'loan_offer',
  'unrelated',
];

// Bedrock's classic Agents product is in maintenance mode for new accounts (CreateAgent is
// blocked), so classification is a direct single-shot InvokeModel call rather than an
// orchestrated Agent — there were no tools/action groups to orchestrate anyway, just one prompt
// in, one JSON verdict out. Anthropic's models additionally require an AWS Marketplace model
// agreement that this account's entitlements can't complete, so this uses Amazon Nova (a
// first-party Bedrock model, no marketplace subscription involved) via its own Converse-style
// request/response shape rather than Anthropic's Messages API.
const SYSTEM_PROMPT = `You are the message classifier for Feed the Needy, a food-rescue NGO's WhatsApp intake line. You receive the raw text of one incoming WhatsApp message and must classify it.

Classify into exactly one verdict:
- food_donation_offer: sender has surplus or leftover cooked food to give away for pickup (a host after an event, a restaurant, a food vendor with unsold stock). Only use this when food is being OFFERED, not requested.
- spam: scams, phishing, prize/lottery claims, suspicious links, impersonation.
- marketing: product promotions, discounts, sales, business advertising unrelated to donating food.
- loan_offer: loan, credit, EMI, instant cash, financial product offers.
- unrelated: anything else — casual chat, questions, requests for food for oneself, wrong numbers.

When the verdict is food_donation_offer, also extract (only if explicitly present in the text, never guess):
- qty: the quantity as written, e.g. "20 plates"
- foodType: the food item, e.g. "vada pav"
- locationText: any neighborhood or address mentioned, e.g. "Koramangala"

Respond with ONLY one JSON object and nothing else — no prose, no markdown code fences, no explanation. The shape must be exactly:
{"verdict": "food_donation_offer", "confidence": 0.93, "extracted": {"qty": "20 plates", "foodType": "vada pav", "locationText": "Koramangala"}}

confidence is a number from 0 to 1 reflecting how certain you are. Omit the "extracted" key entirely for every verdict other than food_donation_offer, and omit any of its sub-fields you could not find in the text.`;

export class ClassifierError extends Error {}

export async function classifyMessage(text: string): Promise<ClassifierResult> {
  try {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          system: [{ text: SYSTEM_PROMPT }],
          messages: [{ role: 'user', content: [{ text }] }],
          inferenceConfig: { maxTokens: 300 },
        }),
      }),
    );

    const decoded = new TextDecoder().decode(response.body as Uint8Array);

    let envelope: unknown;
    try {
      envelope = JSON.parse(decoded);
    } catch {
      throw new ClassifierError(`Model response was not valid JSON: ${decoded}`);
    }

    const raw = (
      envelope as { output?: { message?: { content?: { text?: string }[] } } }
    ).output?.message?.content?.[0]?.text;
    if (!raw) {
      throw new ClassifierError(`Model response had no text content: ${decoded}`);
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
