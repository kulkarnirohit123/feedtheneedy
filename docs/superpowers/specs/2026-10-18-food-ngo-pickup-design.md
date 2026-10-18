# Food NGO Pickup Platform — Design Spec

Date: 2026-10-18
Status: Approved (brainstorming), ready for implementation planning

## Purpose

NGO redistributes surplus food (house parties, vendors, events) instead of
landfill. Zero frontend for donors/drivers — WhatsApp is the only UI they
ever touch. NGO staff get a web admin dashboard for oversight, override,
and reporting. Target: working AWS-native MVP demo within a few days for
the AWS CDS Partner hackathon (devpost.com/aws-cds-partner).

## Success criteria (MVP demo)

- Donor/vendor sends WhatsApp msg describing leftover food → system
  classifies it, acknowledges, dispatches nearest driver, driver confirms
  pickup with photo, confirms fridge drop with photo, request marked
  complete.
- Spam/marketing/loan/unrelated WhatsApp messages never reach a driver and
  never create a dispatch request.
- Admin web dashboard shows live requests, can override driver assignment,
  can view/export a monthly report.
- Entire flow built on AWS services (End User Messaging Social, Lambda,
  Step Functions, DynamoDB, S3, Cognito, Location Service, Bedrock,
  EventBridge, QuickSight/CloudWatch) to qualify for hackathon scoring.

## Out of scope (MVP)

- Distribution leg from fridge → beneficiary (stop at "stored in fridge,
  confirmed"). Noted as phase 2.
- Dynamic/self-service fridge partner onboarding — fridges are a fixed,
  admin-managed list.
- SMS channel — WhatsApp only.
- Driver web login for day-to-day use — drivers interact via WhatsApp
  only; web UI is admin-only (plus override controls).

## Architecture

```
WhatsApp Business (Meta)
   ↕ webhook
AWS End User Messaging Social (WhatsApp Business API, AWS-native)
   ↕
API Gateway (REST) ── webhook endpoint, signature verification
   ↕
Lambda: InboundRouter
   ├─ Amazon Bedrock (Claude Haiku) ── classify msg:
   │      {food_donation_offer | spam | marketing | loan_offer | unrelated}
   │      + extract structured fields (qty, location, food type) when
   │        food_donation_offer
   ├─ low confidence food_donation_offer → PENDING_REVIEW (admin queue),
   │      never auto-dispatched, never auto-dropped
   ├─ spam/marketing/loan/unrelated → log to SpamLog, drop silently
   └─ confident food_donation_offer → create Request, send donor
          auto-ack, start PickupStateMachine

Step Functions: PickupStateMachine (per Request)
   ├─ NotifyDonor ── "Thank you for sharing the information, driver will
   │      be available in next 60 minutes" (fires immediately on
   │      confident classification, before a driver is matched)
   ├─ MatchDriver ── Amazon Location Service, nearest available driver
   ├─ NotifyDriver ── WhatsApp msg via End User Messaging Social
   │      (NGO-composed structured message — driver never sees raw
   │      donor text)
   ├─ wait-for-accept, timeout 60 min → widen radius once / reassign;
   │      2 failed reassigns → admin alert
   ├─ HandlePickupPhoto ── photo → S3 (presigned upload via WhatsApp
   │      media), retry up to 3x on bad upload → admin flag on exhaust
   ├─ MatchFridge ── Location Service, nearest fixed fridge
   ├─ HandleFridgePhoto ── photo → S3, same retry policy
   └─ FinalizeRequest ── mark COMPLETE, write DonationHistory record

DynamoDB
   ├─ Requests        — requestId, donorPhone, qty, foodType, geo,
   │                     status, driverId, fridgeId, timestamps,
   │                     pickupPhotoUrl, fridgePhotoUrl
   ├─ Drivers         — driverId, phone, name, currentGeo,
   │                     status(available/busy), lastActive
   ├─ Fridges         — fridgeId, name, address, geo, capacity
   ├─ SpamLog         — msgId, phone, rawText, bedrockVerdict, confidence
   └─ DonationHistory — append-only; GSI on month+status for reports

S3 ── pickup/fridge confirmation photos
Cognito ── Admin user pool (driver web login out of scope for MVP)
Amplify (or S3+CloudFront) ── Admin web dashboard (React)
EventBridge ── scheduled trigger, monthly report Lambda
QuickSight (or Lambda + S3 CSV/PDF) ── analytics dashboards, monthly report
CloudWatch ── logs, alarms (e.g. request stuck >X hrs)
SQS (DLQ) ── buffer/retry when WhatsApp API is down
```

## State machine

```
RECEIVED
  → CLASSIFIED(bedrock)
      → REJECTED_SPAM            (silent drop, logged)
      → PENDING_REVIEW            (low confidence, admin queue)
      → MATCHING                  (confident food_donation_offer;
                                    donor auto-ack sent here)
  → DRIVER_ASSIGNED                (60 min accept timeout → reassign)
  → DRIVER_ACCEPTED
  → PICKUP_PHOTO_CONFIRMED
  → FRIDGE_MATCHED
  → FRIDGE_PHOTO_CONFIRMED
  → COMPLETE
```

Admin override: a pending/active request can be reassigned to a
different driver manually from the dashboard at any point before
DRIVER_ACCEPTED.

## Error handling

- No driver within initial radius → widen radius once; still none →
  admin alert, request stays PENDING with manual-assign option.
- Driver doesn't accept within 60 min → auto-reassign to next-nearest
  driver; after 2 failed reassigns, admin alert.
- Photo upload fails/corrupt → re-prompt driver same step, max 3
  retries → admin flag, request held at that step.
- WhatsApp API unavailable → SQS DLQ buffers outbound messages, retries
  with backoff.
- Bedrock classification fails/times out → fail open to PENDING_REVIEW
  (never silently dropped on a classifier error — only an explicit spam
  verdict drops a message).

## Testing / demo plan

- Seed 3-4 fake drivers + 2-3 fixed fridges with Bangalore coordinates.
- Script sends WhatsApp sandbox messages simulating: donor leftover-food
  offer, vendor leftover offer, spam, marketing, loan offer, unrelated
  chat — verify only genuine offers create a Request and reach a driver.
- Full happy path: donor msg → auto-ack → driver notified → driver
  accepts → pickup photo → fridge photo → COMPLETE, visible live on
  admin dashboard.
- Admin override test: manually reassign a pending request to a
  different driver mid-flow.
- Manually trigger monthly report Lambda for demo, inspect output
  CSV/PDF.

## Open items for implementation planning

- Exact AWS End User Messaging Social onboarding/sandbox setup steps
  (Meta Business verification lead time — flag early, this can block
  the whole demo if not started immediately).
- Confidence threshold value for Bedrock classifier (start conservative,
  tune during testing).
- Admin dashboard auth flow detail (Cognito hosted UI vs custom).
