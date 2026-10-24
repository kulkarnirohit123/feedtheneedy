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
import { BrandMark, RefreshIcon, SearchIcon } from '../icons';

const NOOP = () => {};
/** The board polls so a dispatcher doesn't have to keep hitting Refresh while a pickup moves. */
const POLL_INTERVAL_MS = 30_000;

type Filter = 'all' | 'review' | 'active' | 'done';

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
    // Keeps the "updated Xs ago" label and per-row ages honest between polls.
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
    // On a phone the detail panel stacks below the list, so bring it into view.
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

  const updatedLabel = lastUpdated
    ? `Updated ${timeAgo(new Date(lastUpdated).toISOString(), now)}`
    : 'Connecting…';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <BrandMark />
            <div className="brand-text">
              <span className="brand-name">Feed the Needy</span>
              <span className="brand-sub">Pickup dispatch</span>
            </div>
          </div>

          <label className="search">
            <SearchIcon />
            <span className="sr-only">Search requests</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search food, area, phone or driver"
            />
          </label>

          <div className="topbar-actions">
            <span className="live">
              <span className={`live-dot${error ? ' is-error' : ''}`} aria-hidden="true" />
              {error ? 'Connection problem' : updatedLabel}
            </span>
            <button className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
              <RefreshIcon spinning={loading} />
              Refresh
            </button>
            <button className="btn btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <h1>Pickup requests</h1>
          <p>Every WhatsApp food offer, from first message to fridge drop-off.</p>
        </div>

        {error && (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        )}

        <section className="stats" aria-label="Summary">
          <Stat tone="review" label="Needs review" value={counts.review} hint="Unsure offers or missing location" />
          <Stat tone="active" label="In progress" value={counts.active} hint="Finding a driver through fridge drop" />
          <Stat tone="done" label="Delivered" value={counts.done} hint="Stored in a community fridge" />
          <Stat label="All requests" value={counts.all} hint="Spam never reaches this board" />
        </section>

        <div className="workspace">
          <section className="list-col" aria-label="Requests">
            <div className="list-toolbar">
              <div className="tabs" role="tablist" aria-label="Filter by stage">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`tab${filter === f.key ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                    <span className="tab-count">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
              <span className="muted-sm">Newest first</span>
            </div>

            {!loaded ? (
              <ul className="cards" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="card-skeleton" aria-hidden="true" />
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className="empty">
                {requests.length === 0
                  ? 'No pickup requests yet. New WhatsApp offers will appear here.'
                  : 'No requests match this view.'}
              </div>
            ) : (
              <ul className="cards">
                {visible.map((r) => (
                  <li key={r.requestId}>
                    <RequestCard
                      request={r}
                      now={now}
                      selected={selected?.requestId === r.requestId}
                      onSelect={() => handleSelect(r.requestId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="detail-col" aria-label="Request details" ref={detailRef}>
            {selected ? (
              <DetailPanel
                key={selected.requestId}
                request={selected}
                now={now}
                notice={notice}
                onReassign={(driverId) => handleReassign(selected.requestId, driverId)}
              />
            ) : (
              <div className="detail-empty">Select a request to see its progress.</div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Stat({ tone, label, value, hint }: { tone?: StatusTone; label: string; value: number; hint: string }) {
  const attention = tone === 'review' && value > 0;
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}${attention ? ' needs-attention' : ''}`}>
      <span className="stat-label">
        {tone && <span className="dot" aria-hidden="true" />}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span className={`pill tone-${meta.tone}`} title={status}>
      {meta.label}
    </span>
  );
}

function ProgressTrack({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span className={`track tone-${meta.tone}`} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`track-seg${i <= meta.step ? ' is-done' : ''}`} />
      ))}
    </span>
  );
}

function RequestCard({
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
  const meta = statusMeta(r.status);
  const area = r.locationText ?? (r.awaitingLocation ? 'Waiting for location' : 'Area not given');
  return (
    <button
      type="button"
      className={`card tone-${meta.tone}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="card-top">
        <span className="card-titles">
          <span className="card-title">{describeOffer(r.qty, r.foodType)}</span>
          <span className="card-sub">
            {area} · <span className="mono">{r.donorPhone}</span>
          </span>
        </span>
        <StatusPill status={r.status} />
      </span>
      <span className="card-bottom">
        <ProgressTrack status={r.status} />
        <span className="card-stage">{meta.waitingOn}</span>
        <span className="card-driver mono">{r.driverId ?? 'No driver yet'}</span>
        <span className="card-age">{timeAgo(r.createdAt, now)}</span>
      </span>
    </button>
  );
}

function DetailPanel({
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

  // reassignCount only tracks the state machine's timeout reassigns, not admin overrides.
  const driverNote = r.reassignCount
    ? `Auto-reassigned ${r.reassignCount}×`
    : r.driverId
      ? 'Current driver'
      : 'Not matched yet';

  return (
    <div className={`detail tone-${meta.tone}`}>
      <div className="detail-head">
        <span className="mono muted-sm" title={r.requestId}>
          #{shortId(r.requestId)}
          {r.createdAt ? ` · ${timeAgo(r.createdAt, now)}` : ''}
        </span>
        <StatusPill status={r.status} />
      </div>

      <div className="detail-title">
        <h2>{describeOffer(r.qty, r.foodType)}</h2>
        <span className="muted">{r.locationText ?? 'Area not given'}</span>
      </div>

      {r.awaitingLocation && (
        <p className="banner banner-warn">The donor has been asked to share their location on WhatsApp.</p>
      )}

      <div className="facts">
        <div className="fact">
          <span className="fact-label">Donor</span>
          <span className="mono">{r.donorPhone}</span>
          <a href={whatsappLink(r.donorPhone)} target="_blank" rel="noreferrer">
            Open in WhatsApp
          </a>
        </div>
        <div className="fact">
          <span className="fact-label">Driver</span>
          <span className="mono">{r.driverId ?? 'Not assigned'}</span>
          <span className="muted-sm">{driverNote}</span>
        </div>
        {r.fridgeId && (
          <div className="fact">
            <span className="fact-label">Fridge</span>
            <span className="mono">{r.fridgeId}</span>
          </div>
        )}
      </div>

      <div>
        <h3 className="section-label">Progress</h3>
        <ol className="timeline">
          {MILESTONES.map((m, i) => {
            const state = i <= meta.step ? 'done' : i === meta.step + 1 ? 'current' : 'todo';
            return (
              <li key={m.label} className={`step is-${state}`}>
                <span className="step-rail" aria-hidden="true">
                  <span className="step-dot" />
                  <span className="step-line" />
                </span>
                <span className="step-body">
                  <span className="step-label">
                    {m.label}
                    {state === 'current' && <span className="sr-only"> (next)</span>}
                  </span>
                  <span className="step-hint">{m.hint}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="reassign">
        <h3 className="section-label">Reassign driver</h3>
        {reassignable ? (
          <>
            <form onSubmit={submit} className="reassign-form">
              <label className="field">
                <span>Driver ID</span>
                <input
                  className="mono"
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  placeholder="e.g. driver-2"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || !driverId.trim()}>
                {busy ? 'Reassigning…' : 'Reassign'}
              </button>
            </form>
            <p className="muted-sm">The new driver gets a WhatsApp message and the previous one is freed up.</p>
          </>
        ) : (
          <p className="muted-box">
            {meta.tone === 'spam'
              ? 'Spam requests are never dispatched.'
              : 'The driver has already accepted, so this pickup can no longer be reassigned.'}
          </p>
        )}
        {notice && (
          <p className="banner banner-ok" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
