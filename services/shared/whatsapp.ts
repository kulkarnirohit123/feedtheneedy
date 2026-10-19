import { SocialMessagingClient, SendWhatsAppMessageCommand } from '@aws-sdk/client-socialmessaging';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const client = new SocialMessagingClient({});
const sqs = new SQSClient({});
const ORIGINATION_PHONE_NUMBER_ID = process.env.WHATSAPP_ORIGINATION_PHONE_NUMBER_ID ?? '';

/**
 * A failed WhatsApp send is parked on the DLQ rather than propagated.
 *
 * Rationale for swallowing: every caller is mid-flow (a donor ack, a driver prompt, a
 * re-prompt). Rethrowing would fail the Step Functions execution or the webhook Lambda over a
 * transient messaging error, stranding the request with a stale task token — strictly worse
 * than continuing and letting the 60-minute timeout/reassign path or an admin pick it up. The
 * DLQ message is the durable record, and the CloudWatch alarm on queue depth is what surfaces
 * it. If the DLQ enqueue ALSO fails there is nowhere left to record the failure, so that case
 * rethrows the original error.
 */
export async function sendWhatsAppText(toPhone: string, body: string): Promise<void> {
  try {
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
  } catch (err) {
    console.error(`WhatsApp send to ${toPhone} failed, routing to DLQ`, err);

    // Read at call time, not module load, so the same module works in callers that do and
    // don't have a DLQ wired (e.g. the admin API, which lives in a different stack).
    const dlqUrl = process.env.WHATSAPP_DLQ_URL ?? '';
    if (!dlqUrl) {
      console.error('WHATSAPP_DLQ_URL is not configured — failed send cannot be parked');
      throw err;
    }

    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: dlqUrl,
          MessageBody: JSON.stringify({
            toPhone,
            body,
            failedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          }),
        }),
      );
    } catch (dlqErr) {
      console.error('Failed to park the WhatsApp send on the DLQ', dlqErr);
      throw err;
    }
  }
}
