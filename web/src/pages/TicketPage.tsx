import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin, CheckCircle2, Ban, RefreshCw, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { QrTicket } from '../components/QrTicket';
import { PageLoader } from '../components/PageLoader';
import { Wordmark } from '../components/Brand';
import { fmtDate, fmtDateTime, fmtTime } from '../lib/format';
import { useRotatingPayload } from '../hooks/useRotatingPayload';

interface PublicTicket {
  code: string;
  qrPayload: string;
  rotatingPayload?: string;
  attendeeName: string;
  status: 'valid' | 'cancelled';
  state: 'issued' | 'inside' | 'outside';
  checkedInAt: string | null;
  checkedInGate: string | null;
  event: {
    id: string;
    name: string;
    venue: string;
    startsAt: string;
    endsAt: string;
    status: string;
    reEntry: boolean;
  };
}

export function TicketPage() {
  const { code = '' } = useParams();
  return <TicketView code={code} />;
}

function TicketView({ code }: { code: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticket', code],
    queryFn: () => api.get<{ ticket: PublicTicket }>(`/public/tickets/${code}`),
    retry: false
  });

  const ticket = data?.ticket;
  // A code is worth showing when it could still open a gate: never used, or
  // used and left with re-entry allowed.
  const usable =
    !!ticket &&
    ticket.status === 'valid' &&
    (ticket.state === 'issued' || (ticket.state === 'outside' && ticket.event.reEntry));
  const { payload, live } = useRotatingPayload(code, ticket?.qrPayload ?? '', usable);

  if (isLoading) return <PageLoader label="Finding your ticket" />;

  if (error || !data || !ticket) {
    return (
      <div className="public-shell">
        <Wordmark size={22} />
        <h1 style={{ marginBlock: 'var(--s7) var(--s3)' }}>Ticket not found</h1>
        <p className="muted">
          This link is no longer valid. If the organizer reissued your ticket, use the newest link
          they sent you.
        </p>
      </div>
    );
  }

  return (
    <div className="ticket-page">
      <div className="pass">
        <div className="pass__head">
          <Wordmark size={18} />
          <span className="stamp stamp--on-carbon">Entry pass</span>
        </div>

        <div className="pass__event">
          <h1>{ticket.event.name}</h1>
          <div className="public-facts">
            <div>
              <CalendarDays size={13} aria-hidden /> {fmtDate(ticket.event.startsAt)} ·{' '}
              {fmtTime(ticket.event.startsAt)}
            </div>
            {ticket.event.venue && (
              <div>
                <MapPin size={13} aria-hidden /> {ticket.event.venue}
              </div>
            )}
          </div>
        </div>

        {ticket.status === 'cancelled' ? (
          <div className="pass__qr" style={{ background: 'var(--reject-soft)' }}>
            <Ban size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--reject)' }} />
            <p style={{ color: 'var(--reject)', fontWeight: 500 }}>This ticket was cancelled</p>
            <p className="meta" style={{ textAlign: 'center' }}>
              Contact the organizing team if you think this is a mistake.
            </p>
          </div>
        ) : !usable ? (
          <div className="pass__qr" style={{ background: 'var(--ok-soft)' }}>
            <CheckCircle2 size={40} strokeWidth={1.5} aria-hidden />
            <p style={{ fontWeight: 500 }}>
              {ticket.state === 'inside' ? 'You are inside' : 'Already attended'}
            </p>
            <p className="meta" style={{ textAlign: 'center' }}>
              {ticket.state === 'inside'
                ? `Entered ${fmtDateTime(ticket.checkedInAt)} at ${ticket.checkedInGate}`
                : 'This event does not allow re-entry.'}
            </p>
          </div>
        ) : (
          <>
            <QrTicket
              payload={payload}
              code={ticket.code}
              fileName={`gateguard-${ticket.attendeeName.replace(/\s+/g, '-').toLowerCase()}`}
              staticPayload={ticket.qrPayload}
            />
            <p className={`pass__rotating ${live ? '' : 'is-stale'}`}>
              {live ? (
                <>
                  <RefreshCw size={12} aria-hidden /> This code changes every 30 seconds. A
                  screenshot will not get anyone in.
                </>
              ) : (
                <>
                  <WifiOff size={12} aria-hidden /> Offline — showing your backup code. It still
                  works at the gate.
                </>
              )}
            </p>
          </>
        )}

        <div className="pass__perf" aria-hidden />

        <dl className="pass__stub">
          <div className="pass__row">
            <dt>Attendee</dt>
            <dd>{ticket.attendeeName}</dd>
          </div>
          <div className="pass__row">
            <dt>Status</dt>
            <dd>
              {ticket.status === 'cancelled'
                ? 'Cancelled'
                : ticket.checkedInAt
                  ? ticket.state === 'inside'
                    ? 'Inside'
                    : 'Attended'
                  : 'Valid — not yet used'}
            </dd>
          </div>
          <div className="pass__row">
            <dt>Code</dt>
            <dd className="pass__code">{ticket.code}</dd>
          </div>
        </dl>

        {usable && (
          <p className="meta print-hide" style={{ padding: 'var(--s4)', borderTop: '1px solid var(--rule)' }}>
            Show this QR at the gate. It refreshes every 30 seconds while you have signal, and
            falls back to a backup code that still works offline.
          </p>
        )}
      </div>
    </div>
  );
}

export function TicketFooterLink() {
  return (
    <p className="meta" style={{ textAlign: 'center', paddingBottom: 'var(--s6)' }}>
      <Link to="/">What is GateGuard?</Link>
    </p>
  );
}
