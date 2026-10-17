import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import type { GateEvent } from '../lib/types';
import { EmptyState } from '../components/EmptyState';
import { PageLoader } from '../components/PageLoader';
import { fmtDate, pluralize } from '../lib/format';

export function ScanPickPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<{ events: GateEvent[] }>('/events')
  });

  if (isLoading) return <PageLoader label="Loading your events" />;

  const scannable = (data?.events ?? []).filter((event) => event.status !== 'draft');

  return (
    <div className="shell page" style={{ maxWidth: 760 }}>
      <span className="stamp page__eyebrow">Gate scanner</span>
      <h1>Which gate are you working?</h1>
      <p className="muted" style={{ marginBlock: 'var(--s2) var(--s6)' }}>
        Pick the event you are standing at. You can choose the specific gate on the next screen.
      </p>

      {scannable.length === 0 ? (
        <EmptyState
          icon={ScanLine}
          title="Nothing to scan"
          body="Only published or live events can take check-ins. Publish an event first, then come back here."
          action={
            <Link to="/app" className="btn">
              Back to events
            </Link>
          }
        />
      ) : (
        <div>
          {scannable.map((event) => (
            <Link key={event.id} to={`/app/scan/${event.id}`} className="pick-row">
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontWeight: 500 }}>{event.name}</b>
                <span className="meta">
                  {fmtDate(event.startsAt)} · {pluralize(event.gates.length, 'gate')} ·{' '}
                  {event.stats?.checkedIn ?? 0}/{event.stats?.registered ?? 0} in
                </span>
              </span>
              <span className="row" style={{ gap: 'var(--s3)' }}>
                {event.status === 'live' && (
                  <span className="chip chip--live">
                    <span className="dot" aria-hidden />
                    live
                  </span>
                )}
                <ChevronRight size={18} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
