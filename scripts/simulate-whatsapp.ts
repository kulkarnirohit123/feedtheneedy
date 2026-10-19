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
