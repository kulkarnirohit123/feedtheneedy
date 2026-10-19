import * as path from 'path';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Root of the TypeScript Lambda sources. Resolved relative to this file's compiled location,
 * not process.cwd(), so `cdk synth` and `jest` agree regardless of the invoking directory.
 */
export const SERVICES_DIR = path.join(__dirname, '..', '..', 'services');

/**
 * Shared esbuild settings for every Lambda in this app.
 *
 * `bundleAwsSDK: true` is the load-bearing part. NodejsFunction's default for a Node 18+
 * runtime is to treat every `@aws-sdk/*` import as external, on the assumption the managed
 * runtime provides it. AWS only guarantees that for a subset of clients — notably NOT
 * `@aws-sdk/client-socialmessaging` or `@aws-sdk/client-bedrock-runtime`, both of which
 * these handlers import. Leaving them external risks a cold-start Runtime.ImportModuleError,
 * so the SDK is bundled into the asset instead. The cost is a larger artifact; the benefit is
 * that the deployed code depends on nothing the runtime might not ship.
 */
export function nodejsBundling(): BundlingOptions {
  return {
    bundleAwsSDK: true,
    minify: true,
    sourceMap: false,
  };
}
