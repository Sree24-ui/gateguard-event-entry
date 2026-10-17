import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { api } from '../lib/api';
import type { AuditEntry } from '../lib/types';
import { EmptyState } from '../components/EmptyState';
import { PageLoader } from '../components/PageLoader';
import { fmtDateTime } from '../lib/format';

export function ActivityPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<{ entries: AuditEntry[] }>('/audit?limit=120')
  });

  if (isLoading) return <PageLoader label="Loading the audit trail" />;
  const entries = data?.entries ?? [];

  return (
    <div className="shell page" style={{ maxWidth: 860 }}>
      <span className="stamp page__eyebrow">Audit trail</span>
      <h1>Activity</h1>
      <p className="muted" style={{ marginBlock: 'var(--s2) var(--s6)', maxWidth: '64ch' }}>
        Every administrative action on your events — tickets issued, reissued or cancelled,
        operators added, exports taken. Scan records live on each event's Analytics tab.
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing recorded yet"
          body="Actions you take on events, tickets and operators are written here as they happen."
        />
      ) : (
        <div className="feed">
          {entries.map((entry) => (
            <div className="feed__row" key={entry.id}>
              <span className="feed__time">{fmtDateTime(entry.createdAt)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="feed__who">{entry.summary || entry.action}</div>
                <div className="feed__why">by {entry.actorName}</div>
              </div>
              <span className="chip chip--quiet">{entry.action.replace(/[._]/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
