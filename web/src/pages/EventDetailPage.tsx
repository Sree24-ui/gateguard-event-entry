import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, MapPin, Radio, ScanLine, Pencil, Plus, Search, Download, Link2,
  Users, AlertCircle, Ban, RotateCcw, Trash2, ExternalLink
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Analytics, GateEvent, ScanLogEntry, Ticket } from '../lib/types';
import { Metrics, AttendanceBar } from '../components/Metrics';
import { EmptyState } from '../components/EmptyState';
import { PageLoader } from '../components/PageLoader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TimelineChart, BarList } from '../components/Charts';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useOnline } from '../hooks/useOnline';
import { fmtDate, fmtDateTime, fmtTime, fmtRelative, pluralize } from '../lib/format';

type Tab = 'overview' | 'attendees' | 'analytics';

const OUTCOME_CHIP: Record<string, string> = {
  checked_in: 'chip--ok',
  duplicate: 'chip--reject',
  conflict: 'chip--wait',
  invalid_signature: 'chip--reject',
  malformed: 'chip--reject',
  wrong_event: 'chip--reject',
  unknown: 'chip--reject',
  cancelled: 'chip--reject'
};

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { user } = useAuth();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.get<{ event: GateEvent; role: string }>(`/events/${eventId}`),
    refetchInterval: online ? 8000 : false,
    refetchIntervalInBackground: false
  });

  if (isLoading) return <PageLoader label="Loading the event" />;
  if (error || !data) {
    return (
      <div className="shell page">
        <h1>Event not available</h1>
        <p className="muted" style={{ marginBlock: 'var(--s3) var(--s5)' }}>
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </p>
        <Link className="btn" to="/app">
          Back to events
        </Link>
      </div>
    );
  }

  const event = data.event;
  const isOwner = user?.role === 'organizer';

  return (
    <>
      <div className="page-head-band">
        <div className="shell">
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 'var(--s4)' }}>
            <div style={{ minWidth: 0 }}>
              <div className="row row--wrap" style={{ marginBottom: 'var(--s2)' }}>
                <Link to="/app" className="stamp">
                  Events
                </Link>
                <span className={`chip ${event.status === 'live' ? 'chip--live' : ''}`}>
                  {event.status === 'live' && <span className="dot" aria-hidden />}
                  {event.status}
                </span>
                {event.isDemo && <span className="chip chip--quiet">Demo data</span>}
              </div>
              <h1>{event.name}</h1>
              <div className="event-row__meta" style={{ marginTop: 'var(--s3)' }}>
                <span>
                  <CalendarDays size={13} aria-hidden /> {fmtDate(event.startsAt)} ·{' '}
                  {fmtTime(event.startsAt)}–{fmtTime(event.endsAt)}
                </span>
                {event.venue && (
                  <span>
                    <MapPin size={13} aria-hidden /> {event.venue}
                  </span>
                )}
                <span>
                  <Radio size={13} aria-hidden /> {event.gates.join(' · ')}
                </span>
              </div>
            </div>

            <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
              {isOwner && (
                <Link to={`/app/events/${event.id}/edit`} className="btn btn--sm">
                  <Pencil size={14} aria-hidden /> Edit
                </Link>
              )}
              <Link to={`/app/scan/${event.id}`} className="btn btn--sm btn--primary">
                <ScanLine size={14} aria-hidden /> Open scanner
              </Link>
            </div>
          </div>

          <Metrics stats={event.stats} />
          {event.stats && event.stats.registered > 0 && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <AttendanceBar stats={event.stats} />
            </div>
          )}
        </div>
      </div>

      <div className="shell" style={{ marginTop: 'var(--s5)' }}>
        <div className="tabs" role="tablist">
          {(['overview', 'attendees', 'analytics'] as Tab[]).map((name) => (
            <button
              key={name}
              role="tab"
              className="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="shell page" style={{ paddingTop: 'var(--s5)' }}>
        {tab === 'overview' && <Overview event={event} isOwner={isOwner} />}
        {tab === 'attendees' && <Attendees event={event} isOwner={isOwner} />}
        {tab === 'analytics' && <AnalyticsTab eventId={event.id} />}
      </div>
    </>
  );
}

function Overview({ event, isOwner }: { event: GateEvent; isOwner: boolean }) {
  const online = useOnline();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['scans', event.id],
    queryFn: () => api.get<{ scans: ScanLogEntry[] }>(`/events/${event.id}/scans?limit=20`),
    refetchInterval: online ? 8000 : false,
    refetchIntervalInBackground: false
  });

  const scans = data?.scans ?? [];
  const publicUrl = `${window.location.origin}/e/${event.id}`;

  return (
    <div className="detail-grid">
      <div>
        <div className="section-head">
          <h2>Gate activity</h2>
          <span className="stamp">Last {scans.length}</span>
        </div>

        {scans.length === 0 ? (
          <EmptyState
            icon={ScanLine}
            title="No scans yet"
            body="Once an operator starts checking people in, every scan — accepted or refused — shows up here with its reason."
          />
        ) : (
          <div className="feed">
            {scans.map((scan) => (
              <div className="feed__row" key={scan.id}>
                <span className="feed__time">{fmtTime(scan.scannedAt)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="feed__who truncate">{scan.attendeeName || scan.message}</div>
                  <div className="feed__why truncate">
                    {scan.gate} · {scan.operatorName || 'unknown operator'} · {scan.entry}
                    {scan.mode === 'offline_sync' && ' · synced from offline queue'}
                  </div>
                </div>
                <span className={`chip ${OUTCOME_CHIP[scan.outcome] ?? ''}`}>
                  {scan.outcome.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside>
        <div className="side-block">
          <span className="stamp stamp--ink">Registration link</span>
          {event.publicRegistration && event.status !== 'draft' ? (
            <>
              <p className="meta" style={{ marginTop: 'var(--s2), 0', wordBreak: 'break-all' }}>
                {publicUrl}
              </p>
              <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(publicUrl)
                      .then(() => toast.push('ok', 'Registration link copied.'))
                      .catch(() => toast.push('error', 'Could not copy the link.'));
                  }}
                >
                  <Link2 size={14} aria-hidden /> Copy
                </button>
                <a className="btn btn--sm" href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden /> Open
                </a>
              </div>
            </>
          ) : (
            <p className="meta" style={{ marginTop: 'var(--s2)' }}>
              {event.status === 'draft'
                ? 'Publish the event to open its registration page.'
                : 'Public registration is off. Add attendees from the Attendees tab.'}
            </p>
          )}
        </div>

        <div className="side-block">
          <span className="stamp stamp--ink">Details</span>
          <dl>
            <dt>Capacity</dt>
            <dd>{event.capacity === 0 ? 'Unlimited' : event.capacity.toLocaleString()}</dd>
            <dt>Gates</dt>
            <dd>{event.gates.length}</dd>
            <dt>Last check-in</dt>
            <dd>{fmtRelative(event.stats?.lastCheckInAt)}</dd>
            <dt>Conflicts</dt>
            <dd>{event.stats?.conflicts ?? 0}</dd>
            <dt>Created</dt>
            <dd>{fmtDate(event.createdAt)}</dd>
          </dl>
        </div>

        {isOwner && <DangerZone event={event} />}
      </aside>
    </div>
  );
}

function DangerZone({ event }: { event: GateEvent }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete(`/events/${event.id}?force=true`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.push('ok', 'Event deleted.');
      window.location.assign('/app');
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Could not delete the event.')
  });

  return (
    <div className="side-block">
      <span className="stamp stamp--ink">Danger zone</span>
      <p className="meta" style={{ marginBlock: 'var(--s2) var(--s3)' }}>
        Deleting removes every ticket and scan record for this event. There is no undo.
      </p>
      <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirming(true)}>
        <Trash2 size={14} aria-hidden /> Delete event
      </button>

      <ConfirmDialog
        open={confirming}
        title="Delete this event?"
        danger
        confirmLabel="Delete permanently"
        busy={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate()}
        body={
          <>
            <p>
              <b>{event.name}</b> will be removed along with{' '}
              {pluralize(event.stats?.registered ?? 0, 'ticket')} and every scan record.
            </p>
            {(event.stats?.checkedIn ?? 0) > 0 && (
              <p className="form-alert">
                <AlertCircle size={15} aria-hidden />
                {event.stats?.checkedIn} people have already been checked in. Consider closing the
                event instead.
              </p>
            )}
          </>
        }
      />
    </div>
  );
}

function Attendees({ event, isOwner }: { event: GateEvent; isOwner: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', event.id, query, status],
    queryFn: () =>
      api.get<{ tickets: Ticket[]; total: number }>(
        `/events/${event.id}/tickets?limit=200${query ? `&q=${encodeURIComponent(query)}` : ''}${
          status ? `&status=${status}` : ''
        }`
      )
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'reissue' }) =>
      api.post(`/events/${event.id}/tickets/${id}/${action}`),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', event.id] });
      queryClient.invalidateQueries({ queryKey: ['event', event.id] });
      toast.push(
        'ok',
        variables.action === 'cancel'
          ? 'Ticket cancelled.'
          : 'New QR issued — the previous one no longer works.'
      );
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'That action failed.')
  });

  const tickets = data?.tickets ?? [];

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Attendees</h2>
          <span className="meta">{pluralize(data?.total ?? 0, 'registration')}</span>
        </div>
        <div className="section-head__actions">
          {isOwner && (
            <>
              <a className="btn btn--sm" href={`/api/events/${event.id}/export/tickets.csv`}>
                <Download size={14} aria-hidden /> Export CSV
              </a>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden /> Add attendee
              </button>
            </>
          )}
        </div>
      </div>

      <div className="row row--wrap" style={{ marginBottom: 'var(--s4)' }}>
        <div className="input-affix grow" style={{ maxWidth: 320 }}>
          <input
            className="input"
            placeholder="Search name, email or college ID"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            aria-label="Search attendees"
          />
          <button type="button" tabIndex={-1} aria-hidden>
            <Search size={15} />
          </button>
        </div>
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={status}
          onChange={(changeEvent) => setStatus(changeEvent.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="checked_in">Checked in</option>
          <option value="pending">Not yet in</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {isLoading ? (
        <PageLoader label="Loading attendees" />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query || status ? 'No matches' : 'No attendees yet'}
          body={
            query || status
              ? 'Try a different search or clear the filter.'
              : 'Add attendees here, or share the registration link so they sign up themselves. Each one gets a unique signed QR ticket.'
          }
          action={
            isOwner && !query && !status ? (
              <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
                <Plus size={15} aria-hidden /> Add the first attendee
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Attendee</th>
                <th scope="col">College ID</th>
                <th scope="col">Status</th>
                <th scope="col">Checked in</th>
                <th scope="col">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{ticket.attendee.name}</div>
                    <div className="meta">{ticket.attendee.email}</div>
                  </td>
                  <td className="num meta">{ticket.attendee.collegeId || '—'}</td>
                  <td>
                    {ticket.status === 'cancelled' ? (
                      <span className="chip chip--reject">Cancelled</span>
                    ) : ticket.checkedInAt ? (
                      <span className="chip chip--ok">In</span>
                    ) : (
                      <span className="chip chip--quiet">Expected</span>
                    )}
                    {ticket.conflictCount > 0 && (
                      <span className="chip chip--wait" style={{ marginLeft: 4 }}>
                        {ticket.conflictCount} conflict
                      </span>
                    )}
                  </td>
                  <td className="meta">
                    {ticket.checkedInAt ? `${fmtDateTime(ticket.checkedInAt)} · ${ticket.checkedInGate}` : '—'}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                      <a className="btn btn--sm" href={`/t/${ticket.code}`} target="_blank" rel="noreferrer">
                        View
                      </a>
                      {isOwner && (
                        <>
                          <button
                            type="button"
                            className="btn btn--sm btn--icon"
                            title="Reissue ticket"
                            aria-label={`Reissue ticket for ${ticket.attendee.name}`}
                            onClick={() => act.mutate({ id: ticket.id, action: 'reissue' })}
                            disabled={act.isPending}
                          >
                            <RotateCcw size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--icon btn--danger"
                            title="Cancel ticket"
                            aria-label={`Cancel ticket for ${ticket.attendee.name}`}
                            onClick={() => act.mutate({ id: ticket.id, action: 'cancel' })}
                            disabled={act.isPending || !!ticket.checkedInAt || ticket.status === 'cancelled'}
                          >
                            <Ban size={14} aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddAttendee eventId={event.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddAttendee({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', email: '', phone: '', collegeId: '' });

  const create = useMutation({
    mutationFn: () => api.post<{ ticket: Ticket }>(`/events/${eventId}/tickets`, values),
    onSuccess: ({ ticket }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', eventId] });
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      toast.push('ok', `Ticket issued to ${ticket.attendee.name}.`);
      onClose();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Could not issue the ticket.')
  });

  const set = (key: keyof typeof values) => (changeEvent: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: changeEvent.target.value }));

  return (
    <ConfirmDialog
      open
      title="Add attendee"
      confirmLabel="Issue ticket"
      busy={create.isPending}
      onCancel={onClose}
      onConfirm={() => create.mutate()}
      body={
        <>
          <div className="field">
            <label htmlFor="att-name">Name</label>
            <input id="att-name" className="input" value={values.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="att-email">Email</label>
            <input id="att-email" className="input" type="email" value={values.email} onChange={set('email')} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="att-phone">Phone</label>
              <input id="att-phone" className="input" value={values.phone} onChange={set('phone')} />
            </div>
            <div className="field">
              <label htmlFor="att-id">College ID</label>
              <input id="att-id" className="input" value={values.collegeId} onChange={set('collegeId')} />
            </div>
          </div>
        </>
      }
    />
  );
}

function AnalyticsTab({ eventId }: { eventId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', eventId],
    queryFn: () => api.get<{ analytics: Analytics }>(`/events/${eventId}/analytics`)
  });

  if (isLoading) return <PageLoader label="Crunching the numbers" />;
  const analytics = data?.analytics;
  if (!analytics) return null;

  const rejected = analytics.outcomes.filter((row) => row.outcome !== 'checked_in');

  return (
    <div className="detail-grid">
      <div>
        <div className="section-head">
          <h2>Arrivals</h2>
          <span className="stamp">{analytics.bucketMinutes} minute intervals</span>
        </div>
        <TimelineChart data={analytics.timeline} />

        <div className="section-head" style={{ marginTop: 'var(--s8)' }}>
          <h2>Scan outcomes</h2>
          <a className="btn btn--sm" href={`/api/events/${eventId}/export/scans.csv`}>
            <Download size={14} aria-hidden /> Export scans
          </a>
        </div>
        <BarList rows={analytics.outcomes.map((row) => ({ label: row.outcome, count: row.count }))} />
      </div>

      <aside>
        <div className="side-block">
          <span className="stamp stamp--ink">Throughput by gate</span>
          <div style={{ marginTop: 'var(--s3)' }}>
            <BarList rows={analytics.byGate.map((row) => ({ label: row.gate, count: row.count }))} />
          </div>
        </div>

        <div className="side-block">
          <span className="stamp stamp--ink">Refused entries</span>
          <p className="meta" style={{ marginTop: 'var(--s2)' }}>
            {rejected.length === 0
              ? 'Nothing has been refused at this event.'
              : `${rejected.reduce((sum, row) => sum + row.count, 0)} scans were refused. Duplicates usually mean a shared screenshot; forged signatures mean a QR that GateGuard never issued.`}
          </p>
        </div>
      </aside>
    </div>
  );
}
