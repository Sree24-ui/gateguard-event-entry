import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, MapPin, Plus, Radio, Ticket as TicketIcon, ScanLine, Clock
} from 'lucide-react';
import { api } from '../lib/api';
import type { GateEvent } from '../lib/types';
import { useAuth } from '../hooks/useAuth';
import { useOnline } from '../hooks/useOnline';
import { EmptyState } from '../components/EmptyState';
import { AttendanceBar } from '../components/Metrics';
import { fmtDate, fmtTime, pluralize } from '../lib/format';

const STATUS_CHIP: Record<GateEvent['status'], string> = {
  draft: 'chip--quiet',
  published: '',
  live: 'chip--live',
  closed: 'chip--quiet'
};

export function DashboardPage() {
  const { user } = useAuth();
  const online = useOnline();

  const { data, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<{ events: GateEvent[] }>('/events'),
    // Polling keeps the committee's dashboard honest without needing sticky
    // connections on a serverless host. Paused when the tab is hidden.
    refetchInterval: online ? 8000 : false,
    refetchIntervalInBackground: false
  });

  const events = data?.events ?? [];
  const totals = events.reduce(
    (sum, event) => ({
      registered: sum.registered + (event.stats?.registered ?? 0),
      checkedIn: sum.checkedIn + (event.stats?.checkedIn ?? 0)
    }),
    { registered: 0, checkedIn: 0 }
  );

  return (
    <div className="shell page">
      <div className="spread" style={{ marginBottom: 'var(--s6)', alignItems: 'flex-end' }}>
        <div>
          <span className="stamp page__eyebrow">
            {user?.role === 'operator' ? 'Assigned to you' : 'Your events'}
          </span>
          <h1>Good to go, {user?.name.split(' ')[0]}</h1>
          <p className="muted" style={{ marginTop: 'var(--s2)' }}>
            {events.length === 0
              ? 'Nothing scheduled yet.'
              : `${pluralize(events.length, 'event')} · ${totals.checkedIn.toLocaleString()} of ${totals.registered.toLocaleString()} attendees through the gate.`}
          </p>
        </div>
        {user?.role === 'organizer' && (
          <Link to="/app/events/new" className="btn btn--primary">
            <Plus size={15} aria-hidden /> New event
          </Link>
        )}
      </div>

      {user?.status === 'pending' && (
        <div className="pending-note" role="status">
          <Clock size={16} aria-hidden />
          <div>
            <b>Your account is awaiting approval.</b> You can create events, add attendees and
            test the scanner right now — everything works. What needs approval is publishing:
            until an administrator approves you, your events stay drafts and their registration
            pages are not public.
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="stack" style={{ gap: 'var(--s5)', borderTop: '1px solid var(--ink)', paddingTop: 'var(--s5)' }}>
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <span className="skeleton skeleton--line" style={{ width: '40%', height: 18 }} />
              <span className="skeleton skeleton--line" style={{ width: '25%' }} />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No events yet"
          body={
            user?.role === 'organizer'
              ? 'Create an event, add your attendee list, and GateGuard issues a signed QR ticket for every one of them.'
              : 'Your organizer has not assigned you to an event yet. Once they do, it shows up here ready to scan.'
          }
          action={
            user?.role === 'organizer' ? (
              <Link to="/app/events/new" className="btn btn--primary">
                <Plus size={15} aria-hidden /> Create your first event
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: GateEvent }) {
  const stats = event.stats;
  return (
    <article className="event-row">
      <div style={{ minWidth: 0 }}>
        <div className="event-row__title">
          <h2>
            <Link to={`/app/events/${event.id}`}>{event.name}</Link>
          </h2>
          <span className={`chip ${STATUS_CHIP[event.status]}`}>
            {event.status === 'live' && <span className="dot" aria-hidden />}
            {event.status}
          </span>
          {event.isDemo && <span className="chip chip--quiet">Demo data</span>}
        </div>

        <div className="event-row__meta">
          <span>
            <CalendarDays size={13} aria-hidden /> {fmtDate(event.startsAt)} · {fmtTime(event.startsAt)}
          </span>
          {event.venue && (
            <span>
              <MapPin size={13} aria-hidden /> {event.venue}
            </span>
          )}
          <span>
            <Radio size={13} aria-hidden /> {pluralize(event.gates.length, 'gate')}
          </span>
        </div>

        {stats && stats.registered > 0 && (
          <div style={{ maxWidth: 360, marginTop: 'var(--s4)' }}>
            <AttendanceBar stats={stats} />
          </div>
        )}
      </div>

      <div className="event-row__stats">
        <div className="event-row__count">
          <span className="stamp">In</span>
          <b>{stats?.checkedIn ?? 0}</b>
        </div>
        <div className="event-row__count">
          <span className="stamp">Registered</span>
          <b>{stats?.registered ?? 0}</b>
        </div>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <Link to={`/app/events/${event.id}`} className="btn btn--sm">
            <TicketIcon size={14} aria-hidden /> Manage
          </Link>
          <Link to={`/app/scan/${event.id}`} className="btn btn--sm btn--primary">
            <ScanLine size={14} aria-hidden /> Scan
          </Link>
        </div>
      </div>
    </article>
  );
}
