/**
 * Presentation metadata for the backend's RequestStatus values (services/shared/types.ts).
 *
 * `step` counts how many of the five pickup milestones are done, so the board can draw a
 * progress track without knowing the state machine: 0 = no driver yet, 5 = delivered.
 */
export type StatusTone = 'review' | 'active' | 'done' | 'spam';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  step: number;
  /** One line describing what the request is waiting on. */
  waitingOn: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  RECEIVED: { label: 'Received', tone: 'review', step: 0, waitingOn: 'Being classified' },
  PENDING_REVIEW: { label: 'Needs review', tone: 'review', step: 0, waitingOn: 'Waiting on an admin' },
  REJECTED_SPAM: { label: 'Spam', tone: 'spam', step: 0, waitingOn: 'Dropped as spam' },
  MATCHING: { label: 'Finding driver', tone: 'active', step: 0, waitingOn: 'Matching the nearest driver' },
  DRIVER_ASSIGNED: { label: 'Driver notified', tone: 'active', step: 1, waitingOn: 'Waiting for the driver to accept' },
  DRIVER_ACCEPTED: { label: 'On the way', tone: 'active', step: 2, waitingOn: 'Driver heading to the donor' },
  PICKUP_PHOTO_CONFIRMED: { label: 'Picked up', tone: 'active', step: 3, waitingOn: 'Choosing a fridge' },
  FRIDGE_MATCHED: { label: 'To fridge', tone: 'active', step: 3, waitingOn: 'Driver heading to the fridge' },
  FRIDGE_PHOTO_CONFIRMED: { label: 'At fridge', tone: 'active', step: 4, waitingOn: 'Wrapping up' },
  COMPLETE: { label: 'Delivered', tone: 'done', step: 5, waitingOn: 'Stored in a fridge' },
};

const UNKNOWN_STATUS: StatusMeta = { label: 'Unknown', tone: 'review', step: 0, waitingOn: 'Unrecognised status' };

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { ...UNKNOWN_STATUS, label: status };
}

export const MILESTONES: { label: string; hint: string }[] = [
  { label: 'Offer received', hint: 'Classified as a food donation' },
  { label: 'Driver notified', hint: 'Nearest free driver messaged' },
  { label: 'Driver accepted', hint: 'Replied ACCEPT on WhatsApp' },
  { label: 'Picked up', hint: 'Pickup photo confirmed' },
  { label: 'At the fridge', hint: 'Drop-off photo confirmed' },
  { label: 'Delivered', hint: 'Request complete' },
];

/** The spec only allows an admin override before the driver has accepted. */
export function canReassign(status: string): boolean {
  const meta = statusMeta(status);
  return meta.tone !== 'spam' && meta.step <= 1;
}

/** First 8 chars of a UUID-style id, with the full id still reachable via the title tooltip. */
export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** The classifier sometimes puts the same words in both qty and foodType — don't echo them twice. */
export function describeOffer(qty: string, foodType: string): string {
  const hasQty = qty && qty !== 'unknown';
  const hasFood = foodType && foodType !== 'unknown';
  if (!hasQty && !hasFood) return 'Details not extracted';
  if (!hasFood) return qty;
  if (!hasQty) return foodType;
  if (qty.toLowerCase().includes(foodType.toLowerCase())) return qty;
  return `${qty} of ${foodType}`;
}

export function timeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** wa.me wants the number as bare digits, country code included. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}
