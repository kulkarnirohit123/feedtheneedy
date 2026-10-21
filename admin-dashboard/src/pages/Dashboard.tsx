import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest, SessionExpiredError } from '../api';
import { signOut } from '../auth';

/**
 * Known limitation: there is no driver picker, so an override always targets this one id. The
 * API accepts any driver id and now 404s an unknown one, so adding a <select> is a UI-only
 * change once a GET /drivers route exists.
 */
const FALLBACK_DRIVER_ID = 'driver-2';
const NOOP = () => {};

const DEFAULT_STATUS_STYLE = statusVars('var(--steel)', 'var(--steel-tint)', 'var(--steel)');

const STATUS_STYLE: Record<string, CSSProperties> = {
  RECEIVED: DEFAULT_STATUS_STYLE,
  PENDING_REVIEW: DEFAULT_STATUS_STYLE,
  REJECTED_SPAM: statusVars('var(--rust)', 'var(--rust-tint)', 'var(--rust-dark)'),
  MATCHING: statusVars('var(--marigold)', 'var(--marigold-tint)', 'var(--marigold-dark)'),
  DRIVER_ASSIGNED: statusVars('var(--marigold)', 'var(--marigold-tint)', 'var(--marigold-dark)'),
  DRIVER_ACCEPTED: statusVars('var(--marigold)', 'var(--marigold-tint)', 'var(--marigold-dark)'),
  PICKUP_PHOTO_CONFIRMED: statusVars('var(--sprout)', 'var(--sprout-tint)', 'var(--sprout)'),
  FRIDGE_MATCHED: statusVars('var(--sprout)', 'var(--sprout-tint)', 'var(--sprout)'),
  FRIDGE_PHOTO_CONFIRMED: statusVars('var(--sprout)', 'var(--sprout-tint)', 'var(--sprout)'),
  COMPLETE: statusVars('var(--leaf)', 'var(--leaf-tint)', 'var(--leaf)'),
};

function statusVars(color: string, tint: string, text: string): CSSProperties {
  return { '--status-color': color, '--status-tint': tint, '--status-text': text } as CSSProperties;
}

const SUMMARY_GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'Pending', statuses: ['RECEIVED', 'PENDING_REVIEW'] },
  { label: 'In progress', statuses: ['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'PICKUP_PHOTO_CONFIRMED', 'FRIDGE_MATCHED', 'FRIDGE_PHOTO_CONFIRMED'] },
  { label: 'Complete', statuses: ['COMPLETE'] },
];

/** First 8 chars of a UUID-style id, with the full id still reachable via the title tooltip. */
function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** The classifier sometimes puts the same words in both qty and foodType — don't echo them twice. */
function describeOffer(qty: string, foodType: string): string {
  if (!foodType || foodType === 'unknown' || qty.toLowerCase().includes(foodType.toLowerCase())) {
    return qty;
  }
  return `${qty} of ${foodType}`;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Dashboard({ onSignedOut = NOOP }: { onSignedOut?: () => void }) {
  const [requests, setRequests] = useState<FoodRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchRequests());
      setError(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load requests.');
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReassign(requestId: string) {
    setBusyRequestId(requestId);
    try {
      await overrideAssign(requestId, FALLBACK_DRIVER_ID);
      setError(null);
      // Refetch so the row actually shows the new driver/status — previously the click's
      // result was never reflected anywhere in the UI, success or failure.
      await load();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Reassign failed.');
    } finally {
      setBusyRequestId(null);
    }
  }

  function handleSignOut() {
    signOut();
    onSignedOut();
  }

  return (
    <div className="app-shell">
      <header className="board-header">
        <div className="board-brand">
          <h1>Feed the Needy</h1>
          <p>Pickup dispatch board</p>
        </div>
        <div className="board-summary">
          {SUMMARY_GROUPS.map((group) => (
            <div className="summary-stat" key={group.label}>
              <span className="summary-count">
                {requests.filter((r) => group.statuses.includes(r.status)).length}
              </span>
              <span className="summary-label">{group.label}</span>
            </div>
          ))}
        </div>
        <div className="board-actions">
          <button className="btn btn-ghost-on-leaf" onClick={() => void load()}>
            Refresh
          </button>
          <button className="btn btn-ghost-on-leaf" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p className="alert-strip" role="alert">
          {error}
        </p>
      )}

      <main className="ledger">
        {requests.length === 0 && !error ? (
          <p className="ledger-empty">No pickup requests yet.</p>
        ) : (
          <ul className="ledger-list">
            {requests.map((r) => (
              <li key={r.requestId} className="ledger-row" style={STATUS_STYLE[r.status] ?? DEFAULT_STATUS_STYLE}>
                <div className="ledger-meta">
                  <span className="req-id" title={r.requestId}>
                    {shortId(r.requestId)}
                  </span>
                  <span className="req-time">{timeAgo(r.createdAt)}</span>
                </div>
                <div className="ledger-main">
                  <span className="status-tag">{r.status}</span>
                  <span className="donor-phone" title="Donor's WhatsApp number">
                    {r.donorPhone}
                  </span>
                  <span className="ledger-detail">{describeOffer(r.qty, r.foodType)}</span>
                  {r.locationText ? <span className="ledger-location">{r.locationText}</span> : null}
                  {r.driverId ? <span className="driver-chip">{r.driverId}</span> : null}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => handleReassign(r.requestId)}
                  disabled={busyRequestId === r.requestId}
                >
                  Reassign
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
