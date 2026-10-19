import { createHmac } from 'crypto';

/**
 * The webhook now verifies Meta's X-Hub-Signature-256 HMAC, so the simulator has to sign its
 * payloads with the same App Secret the deployed Lambda reads from META_APP_SECRET.
 */
export function signBody(body: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')}`;
}

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
  const appSecret = process.env.META_APP_SECRET;
  if (!scenario || !SCENARIOS[scenario] || !webhookUrl || !appSecret) {
    console.error(
      `Usage: WEBHOOK_URL=<url> META_APP_SECRET=<secret> npx ts-node scripts/simulate-whatsapp.ts <${Object.keys(SCENARIOS).join('|')}>`,
    );
    process.exit(1);
  }
  const { from, text } = SCENARIOS[scenario];
  const body = JSON.stringify(buildWebhookPayload(from, text));
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signBody(body, appSecret) },
      body,
    });
    console.log(`Sent "${scenario}" scenario, response status: ${res.status}`);
  } catch (err) {
    console.error(`Failed to reach ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
