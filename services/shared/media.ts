import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const GRAPH_API_VERSION = 'v19.0';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** `media:<id>` is what inbound-router/handler.ts produces from a WhatsApp image message. */
export function mediaIdFrom(mediaRef: string): string | null {
  return mediaRef.startsWith('media:') ? mediaRef.slice('media:'.length) || null : null;
}

/**
 * Downloads a WhatsApp image from Meta's Graph API and stores it in the photos bucket,
 * returning the S3 key.
 *
 * Meta media is a two-step fetch: the media id resolves to a short-lived, access-token-gated
 * download URL, which then serves the bytes. Both calls need the app's access token.
 *
 * Returns null — rather than throwing — on any failure (token unset, bucket unset, Graph API
 * error). The caller then falls back to persisting the raw `media:<id>` reference. The
 * reasoning: a photo is the driver's proof of pickup, and throwing here would leave the task
 * token unresolved, so the driver would be asked for the same photo again with no way to make
 * progress. A recorded-but-not-archived photo is a degraded audit trail; a wedged pickup is a
 * broken delivery. The failure is logged loudly so the gap is visible in CloudWatch.
 */
export async function persistWhatsAppMedia(
  mediaRef: string,
  keyBase: string,
): Promise<string | null> {
  const bucket = process.env.PHOTOS_BUCKET ?? '';
  const accessToken = process.env.META_ACCESS_TOKEN ?? '';
  const mediaId = mediaIdFrom(mediaRef);

  if (!mediaId) return null;
  if (!bucket || !accessToken) {
    console.error(
      'PHOTOS_BUCKET and/or META_ACCESS_TOKEN not configured — storing the raw media reference instead of archiving the photo',
    );
    return null;
  }

  const auth = { Authorization: `Bearer ${accessToken}` };

  try {
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
      headers: auth,
    });
    if (!metaRes.ok) {
      console.error(`Graph API media lookup for ${mediaId} failed with status ${metaRes.status}`);
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) {
      console.error(`Graph API media lookup for ${mediaId} returned no download url`);
      return null;
    }

    const binaryRes = await fetch(meta.url, { headers: auth });
    if (!binaryRes.ok) {
      console.error(`Media download for ${mediaId} failed with status ${binaryRes.status}`);
      return null;
    }
    const body = new Uint8Array(await binaryRes.arrayBuffer());

    const contentType = meta.mime_type ?? 'application/octet-stream';
    const key = `${keyBase}.${EXTENSIONS[contentType] ?? 'bin'}`;

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  } catch (err) {
    console.error(`Failed to archive WhatsApp media ${mediaId} to S3`, err);
    return null;
  }
}
