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
                <span className="req-id">{r.requestId}</span>
                <span className="status-tag">{r.status}</span>
                <span className="ledger-detail">
                  {r.qty} of {r.foodType}
                </span>
                {r.driverId ? <span className="driver-chip">{r.driverId}</span> : null}
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
