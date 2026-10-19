# Food NGO Pickup Platform

AWS-native WhatsApp pickup coordination for surplus food donation.
See `docs/superpowers/specs/2026-10-18-food-ngo-pickup-design.md` for the
full design.

## Deploy the backend

0. First-time only: `cd infra && npx cdk bootstrap` (every Lambda here uses
   `Code.fromAsset`, which needs the CDK toolkit stack deployed to your
   account/region once — `cdk deploy` fails with an explicit error telling
   you to run this if you skip it).
1. `npm install` (repo root — installs all workspaces).
2. `npm run build:services`
3. `cd infra && npx cdk deploy --all --require-approval never`
4. From the CDK output, note: the `WhatsAppWebhookApiEndpoint` URL, the
   `AdminApiEndpoint` URL, `AdminUserPoolId`, `AdminUserPoolClientId`, and
   your AWS region.
5. Register `<WhatsAppWebhookApiEndpoint URL>webhook` (the API's root URL
   plus the `webhook` resource path — not the bare root URL) as the AWS
   End User Messaging Social webhook callback for your WhatsApp Business
   number.
6. `npx ts-node scripts/seed-drivers-fridges.ts`

### Wiring the Bedrock Agent and WhatsApp phone number (once provisioned)

`CLASSIFIER_AGENT_ID`, `CLASSIFIER_AGENT_ALIAS_ID`, and
`WHATSAPP_ORIGINATION_PHONE_NUMBER_ID` are read from CDK context
(`infra/lib/pipeline-stack.ts`), defaulting to empty strings. This plan
does not provision the Bedrock Agent or the WhatsApp phone number
themselves — provision those manually (console or CLI), then either:

- redeploy with the real values: `npx cdk deploy --all -c classifierAgentId=<id> -c classifierAgentAliasId=<alias-id> -c whatsappOriginationPhoneNumberId=<phone-id>`, or
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
WEBHOOK_URL=<WhatsAppWebhookApiEndpoint URL>webhook npx ts-node scripts/simulate-whatsapp.ts donor_offer
WEBHOOK_URL=<WhatsAppWebhookApiEndpoint URL>webhook npx ts-node scripts/simulate-whatsapp.ts spam
```

Watch the `Requests` table: the `donor_offer` scenario should progress
from `RECEIVED` to `MATCHING` to `DRIVER_ASSIGNED`; the `spam` scenario
should create zero `Request` items. The same progression is visible live
in the admin dashboard's request list.

To manually trigger the monthly report outside its schedule:
`aws lambda invoke --function-name <MonthlyReportFn name> --payload '{"month":"2026-10"}' /tmp/out.json`
(omit `month` to default to the previous calendar month, matching what
the real EventBridge schedule sends).
