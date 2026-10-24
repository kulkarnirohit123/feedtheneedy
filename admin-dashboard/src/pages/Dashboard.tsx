import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRequests, overrideAssign, FoodRequest, SessionExpiredError } from '../api';
import { signOut } from '../auth';
import {
  MILESTONES,
  StatusTone,
  canReassign,
  describeOffer,
  shortId,
  statusMeta,
  timeAgo,
  whatsappLink,
} from '../status';

const NOOP = () => {};
/** The board polls so a dispatcher doesn't have to keep hitting Refresh while a pickup moves. */
const POLL_INTERVAL_MS = 30_000;

type Filter = 'all' | Exclude<StatusTone, 'spam'>;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs review' },
  { key: 'active', label: 'In progress' },
  { key: 'done', label: 'Delivered' },
];

function matchesQuery(r: FoodRequest, query: string): boolean {
  if (!query) return true;
  const haystack = [r.qty, r.foodType, r.locationText, r.donorPhone, r.driverId, r.requestId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/** DynamoDB Scan returns items in no particular order; dispatchers want the newest on top. */
function newestFirst(a: FoodRequest, b: FoodRequest): number {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

function areaOf(r: FoodRequest): string {
  return r.locationText ?? (r.awaitingLocation ? 'Waiting for location' : 'Area not given');
}

export function Dashboard({ onSignedOut = NOOP }: { onSignedOut?: () => void }) {
  const [requests, setRequests] = useState<FoodRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await fetchRequests());
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load requests.');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    // Keeps the "updated" label and per-row ages honest between polls.
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const sorted = useMemo(() => [...requests].sort(newestFirst), [requests]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: sorted.length, review: 0, active: 0, done: 0 };
    for (const r of sorted) {
      const tone = statusMeta(r.status).tone;
      if (tone !== 'spam') c[tone] += 1;
    }
    return c;
  }, [sorted]);

  const visible = useMemo(
    () =>
      sorted.filter(
        (r) => (filter === 'all' || statusMeta(r.status).tone === filter) && matchesQuery(r, query),
      ),
    [sorted, filter, query],
  );

  const selected = visible.find((r) => r.requestId === selectedId) ?? visible[0] ?? null;

  function handleSelect(requestId: string) {
    setSelectedId(requestId);
    setNotice(null);
    // On a phone the detail section sits below the list, so bring it into view.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px)').matches) {
      detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }

  async function handleReassign(requestId: string, driverId: string) {
    try {
      await overrideAssign(requestId, driverId);
      setError(null);
      setNotice(`Reassigned to ${driverId}. They've been sent a WhatsApp message.`);
      // Refetch so the row actually shows the new driver/status.
      await load();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSignedOut();
        return;
      }
      setNotice(null);
      setError(err instanceof Error ? err.message : 'Reassign failed.');
    }
  }

  function handleSignOut() {
    signOut();
    onSignedOut();
  }

  const updatedLabel = error
    ? "Couldn't reach the server"
    : lastUpdated
      ? `Updated ${timeAgo(new Date(lastUpdated).toISOString(), now)}`
      : 'Loading…';

  return (
    <div className="site">
      <header className="masthead">
        <div className="masthead-inner">
          <span className="wordmark">Feed the Needy</span>
          <span className="masthead-sub">Pickup dispatch</span>
          <div className="masthead-actions">
            <span className="muted">{updatedLabel}</span>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="link-btn" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <h1>Pickup requests</h1>
        <p className="lede">
          {/* Bold only when someone actually has to act. */}
          {counts.review > 0 ? (
            <strong>
              {counts.review} {counts.review === 1 ? 'needs' : 'need'} review
            </strong>
          ) : (
            'None need review'
          )}
          , {counts.active} in progress and {counts.done} delivered, {counts.all} in total. Spam is filtered out
          before it gets here.
        </p>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter by stage">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`tab${filter === f.key ? ' is-active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="tab-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <span>Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Food, area, phone or driver"
            />
          </label>
        </div>

        <div className="workspace">
          <section className="list-col" aria-label="Requests">
            {!loaded ? (
              <p className="muted list-message">Loading requests…</p>
            ) : visible.length === 0 ? (
              <p className="muted list-message">
                {requests.length === 0
                  ? 'No pickup requests yet. New WhatsApp offers will show up here.'
                  : 'No requests match this view.'}
              </p>
            ) : (
              <table className="requests">
                <thead>
                  <tr>
                    <th scope="col">Offer</th>
                    <th scope="col">Donor</th>
                    <th scope="col">Driver</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Received
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <RequestRow
                      key={r.requestId}
                      request={r}
                      now={now}
                      selected={selected?.requestId === r.requestId}
                      onSelect={() => handleSelect(r.requestId)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="detail-col" aria-label="Request details" ref={detailRef}>
            {selected && (
              <RequestDetail
                key={selected.requestId}
                request={selected}
                now={now}
                notice={notice}
                onReassign={(driverId) => handleReassign(selected.requestId, driverId)}
              />
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span className="status" title={status}>
      <span className={`status-mark tone-${meta.tone}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function RequestRow({
  request: r,
  now,
  selected,
  onSelect,
}: {
  request: FoodRequest;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr className={selected ? 'is-selected' : undefined} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <td className="offer">
        <button type="button" className="row-link" onClick={(e) => (e.stopPropagation(), onSelect())}>
          {describeOffer(r.qty, r.foodType)}
        </button>
        <span className="muted">{areaOf(r)}</span>
      </td>
      <td className="nowrap tabular" data-label="Donor">
        {r.donorPhone}
      </td>
      <td className="nowrap" data-label="Driver">
        {r.driverId ?? '—'}
      </td>
      <td className="nowrap" data-label="Status">
        <StatusLabel status={r.status} />
      </td>
      <td className="nowrap num muted" data-label="Received">
        {timeAgo(r.createdAt, now)}
      </td>
    </tr>
  );
}

function RequestDetail({
  request: r,
  now,
  notice,
  onReassign,
}: {
  request: FoodRequest;
  now: number;
  notice: string | null;
  onReassign: (driverId: string) => Promise<void>;
}) {
  const meta = statusMeta(r.status);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const reassignable = canReassign(r.status);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const target = driverId.trim();
    if (!target) return;
    setBusy(true);
    try {
      await onReassign(target);
      setDriverId('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail">
      <p className="muted small" title={r.requestId}>
        Request {shortId(r.requestId)}
        {r.createdAt ? ` · received ${timeAgo(r.createdAt, now)}` : ''}
      </p>
      <h2>{describeOffer(r.qty, r.foodType)}</h2>
      <p className="detail-area">{r.locationText ?? 'Area not given'}</p>

      {r.awaitingLocation && (
        <p className="note">We've asked the donor to share their location on WhatsApp.</p>
      )}

      <dl className="facts">
        <dt>Status</dt>
        <dd>
          <StatusLabel status={r.status} />
        </dd>
        <dt>Donor</dt>
        <dd className="tabular">
          {r.donorPhone} ·{' '}
          <a href={whatsappLink(r.donorPhone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </dd>
        <dt>Driver</dt>
        <dd>
          {r.driverId ?? 'Not assigned yet'}
          {/* reassignCount only tracks the state machine's timeout reassigns, not admin overrides. */}
          {r.reassignCount ? <span className="muted"> (auto-reassigned {r.reassignCount}×)</span> : null}
        </dd>
        {r.fridgeId && (
          <>
            <dt>Fridge</dt>
            <dd>{r.fridgeId}</dd>
          </>
        )}
      </dl>

      <h3>Progress</h3>
      <ol className="progress">
        {MILESTONES.map((m, i) => {
          const state = i <= meta.step ? 'done' : i === meta.step + 1 ? 'next' : 'todo';
          return (
            <li key={m.label} className={`is-${state}`}>
              <span className="progress-mark" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'next' ? '→' : ''}
              </span>
              <span>
                {m.label}
                {state === 'next' && ' (next)'}
                {state === 'done' && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <h3>Reassign driver</h3>
      {reassignable ? (
        <>
          <form onSubmit={submit} className="reassign-form">
            <label className="field">
              <span>Driver ID</span>
              <input
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                placeholder="e.g. driver-2"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn btn-dark" disabled={busy || !driverId.trim()}>
              {busy ? 'Reassigning…' : 'Reassign'}
            </button>
          </form>
          <p className="muted small">The new driver is messaged on WhatsApp and the previous one is released.</p>
        </>
      ) : (
        <p className="small">
          {meta.tone === 'spam'
            ? 'Spam requests are never dispatched.'
            : "The driver has already accepted, so this pickup can't be reassigned."}
        </p>
      )}
      {notice && (
        <p className="success-text" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
