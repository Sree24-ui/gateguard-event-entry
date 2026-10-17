import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin, CheckCircle2, Ban } from 'lucide-react';
import { api } from '../lib/api';
import { QrTicket } from '../components/QrTicket';
import { PageLoader } from '../components/PageLoader';
import { Wordmark } from '../components/Brand';
import { fmtDate, fmtDateTime, fmtTime } from '../lib/format';

interface PublicTicket {
  code: string;
  qrPayload: string;
  attendeeName: string;
  status: 'valid' | 'cancelled';
  checkedInAt: string | null;
  checkedInGate: string | null;
  event: { id: string; name: string; venue: string; startsAt: string; endsAt: string; status: string };
}

export function TicketPage() {
  const { code = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticket', code],
    queryFn: () => api.get<{ ticket: PublicTicket }>(`/public/tickets/${code}`),
    retry: false
  });

  if (isLoading) return <PageLoader label="Finding your ticket" />;

  if (error || !data) {
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

  const ticket = data.ticket;

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
        ) : ticket.checkedInAt ? (
          <div className="pass__qr" style={{ background: 'var(--ok-soft)' }}>
            <CheckCircle2 size={40} strokeWidth={1.5} aria-hidden />
            <p style={{ fontWeight: 500 }}>Already checked in</p>
            <p className="meta" style={{ textAlign: 'center' }}>
              {fmtDateTime(ticket.checkedInAt)} at {ticket.checkedInGate}
            </p>
          </div>
        ) : (
          <QrTicket
            payload={ticket.qrPayload}
            code={ticket.code}
            fileName={`gateguard-${ticket.attendeeName.replace(/\s+/g, '-').toLowerCase()}`}
          />
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
                  ? 'Checked in'
                  : 'Valid — not yet used'}
            </dd>
          </div>
          <div className="pass__row">
            <dt>Code</dt>
            <dd className="pass__code">{ticket.code}</dd>
          </div>
        </dl>

        {!ticket.checkedInAt && ticket.status === 'valid' && (
          <p className="meta print-hide" style={{ padding: 'var(--s4)', borderTop: '1px solid var(--rule)' }}>
            Show this QR at the gate. It works offline once the page has loaded, and it can only be
            used once.
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
