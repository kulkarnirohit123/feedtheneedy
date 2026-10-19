# Food NGO Pickup Platform

AWS-native WhatsApp pickup coordination for surplus food donation.
See `docs/superpowers/specs/2026-10-18-food-ngo-pickup-design.md` for the
full design.

## Deploy the backend

0. First-time only: `cd infra && npx cdk bootstrap` (Lambda assets are
   uploaded to the CDK toolkit stack, which must exist in your
   account/region once — `cdk deploy` fails with an explicit error telling
   you to run this if you skip it).
1. `npm install` (repo root — installs all workspaces, including the
   `esbuild` that bundles each Lambda).
2. `cd infra && npx cdk deploy --all --require-approval never`
   (Lambdas are built by `NodejsFunction`/esbuild straight from the
   TypeScript sources, so no separate build step is needed. Each bundle
   includes its AWS SDK clients rather than relying on the managed
   runtime to provide them.)
4. From the CDK output, note: the `WhatsAppWebhookApiEndpoint` URL, the
   `AdminApiEndpoint` URL, `AdminUserPoolId`, `AdminUserPoolClientId`, and
   your AWS region.
5. Register `<WhatsAppWebhookApiEndpoint URL>webhook` (the API's root URL
   plus the `webhook` resource path — not the bare root URL) as the
   webhook callback for your WhatsApp Business number, using the verify
   token you set as `metaWebhookVerifyToken` below. Meta will `GET` that
   URL once with `hub.challenge` to confirm it; the router answers the
   handshake itself.
6. `npx ts-node scripts/seed-drivers-fridges.ts`

> **The webhook rejects every request until `metaAppSecret` is set.** Every
> inbound delivery must carry a valid `X-Hub-Signature-256` HMAC, and the
> router fails closed (403) while the secret is empty — otherwise the
> endpoint would be a public command channel able to forge donor offers and
> hijack a driver's live task token. Set it in step "Wiring Meta
> credentials" below before testing.

### Wiring the Bedrock Agent, WhatsApp phone number, and Meta credentials

These values are read from CDK context (`infra/lib/pipeline-stack.ts`),
all defaulting to empty strings:

| context key | env var | what it is |
| --- | --- | --- |
| `classifierAgentId` | `CLASSIFIER_AGENT_ID` | Bedrock Agent that classifies inbound donor messages |
| `classifierAgentAliasId` | `CLASSIFIER_AGENT_ALIAS_ID` | that agent's alias |
| `whatsappOriginationPhoneNumberId` | `WHATSAPP_ORIGINATION_PHONE_NUMBER_ID` | End User Messaging Social phone-number id used for outbound sends |
| `metaAppSecret` | `META_APP_SECRET` | Meta app secret — verifies the `X-Hub-Signature-256` on every inbound webhook. **Required**; the webhook 403s without it |
| `metaWebhookVerifyToken` | `META_WEBHOOK_VERIFY_TOKEN` | any string you choose; must match what you enter in Meta's webhook-registration form |
| `metaAccessToken` | `META_ACCESS_TOKEN` | Meta Graph API token used to download pickup/fridge photos so they can be archived in S3. Optional — without it the request stores the raw `media:<id>` reference instead of an S3 key |

This plan does not provision the Bedrock Agent or the WhatsApp phone
number themselves — provision those manually (console or CLI), then
either:

- redeploy with the real values: `npx cdk deploy --all -c classifierAgentId=<id> -c classifierAgentAliasId=<alias-id> -c whatsappOriginationPhoneNumberId=<phone-id> -c metaAppSecret=<secret> -c metaWebhookVerifyToken=<token> -c metaAccessToken=<token>`, or
- patch the already-deployed `InboundRouterFn`'s environment directly via
  `aws lambda update-function-configuration` (faster for iterating during
  a demo, but gets overwritten on the next `cdk deploy`).

### Creating an admin user

The dashboard signs in directly against Cognito (`USER_PASSWORD_AUTH`),
which means the user must already have a **permanent** password — a
standard `admin-create-user` leaves the account in
`FORCE_CHANGE_PASSWORD`, and the dashboard's sign-in form has no flow for
that challenge. Set the password as permanent in the same step:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <AdminUserPoolId from the CDK output> \
  --username <admin email> \
  --message-action SUPPRESS
aws cognito-idp admin-set-user-password \
  --user-pool-id <AdminUserPoolId> \
  --username <admin email> \
  --password '<a real password meeting the pool's policy>' \
  --permanent
```

### Running the admin dashboard

The dashboard is a Vite app with no hosting stack in this plan — for the
hackathon demo, run it locally against the deployed API:

1. `cd admin-dashboard` (skip `npm install` here — the repo-root install
   in step 1 above already covers this workspace).
2. Create `.env.local`:
   ```
   VITE_ADMIN_API_URL=<AdminApiEndpoint URL from the CDK output, no trailing slash>
   VITE_AWS_REGION=<your AWS region, e.g. ap-south-1>
   VITE_USER_POOL_CLIENT_ID=<AdminUserPoolClientId from the CDK output>
   ```
3. `npm run dev`, then sign in with the admin user created above.

## Demo script

```bash
# META_APP_SECRET must match the deployed metaAppSecret — the harness signs
# each payload the same way Meta does, or the webhook rejects it with a 403.
export WEBHOOK_URL=<WhatsAppWebhookApiEndpoint URL>webhook
export META_APP_SECRET=<same secret you deployed>
npx ts-node scripts/simulate-whatsapp.ts donor_offer
npx ts-node scripts/simulate-whatsapp.ts spam
```

Watch the `Requests` table: the `donor_offer` scenario should progress
from `RECEIVED` to `MATCHING` to `DRIVER_ASSIGNED`; the `spam` scenario
should create zero `Request` items. The same progression is visible live
in the admin dashboard's request list.

To manually trigger the monthly report outside its schedule:
`aws lambda invoke --function-name <MonthlyReportFn name> --payload '{"month":"2026-10"}' /tmp/out.json`
(omit `month` to default to the previous calendar month, matching what
the real EventBridge schedule sends).
