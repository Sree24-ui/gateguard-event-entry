import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserCheck, Ban, Undo2, EyeOff, Users, CalendarDays } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { GateEvent, User } from '../lib/types';
import { useToast } from '../hooks/useToast';
import { PageLoader } from '../components/PageLoader';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDate, fmtDateTime } from '../lib/format';

type Tab = 'organisers' | 'events';

interface AdminEvent extends GateEvent {
  registered: number;
  organizer: { id: string; name: string; email: string; status: string } | null;
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('organisers');

  return (
    <div className="shell page" style={{ maxWidth: 960 }}>
      <span className="stamp page__eyebrow">
        <ShieldCheck size={11} aria-hidden style={{ display: 'inline', marginRight: 4 }} />
        Administration
      </span>
      <h1>Trust and safety</h1>
      <p className="muted" style={{ marginBlock: 'var(--s2) var(--s5)', maxWidth: '66ch' }}>
        An organiser can build an event and issue tickets the moment they sign up. Reaching the
        public — a registration page anyone can open — is what waits for you here.
      </p>

      <div className="tabs" role="tablist" style={{ marginBottom: 'var(--s5)' }}>
        {(['organisers', 'events'] as Tab[]).map((name) => (
          <button
            key={name}
            role="tab"
            className="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name === 'organisers' ? 'Organisers' : 'Published events'}
          </button>
        ))}
      </div>

      {tab === 'organisers' ? <Organisers /> : <PublishedEvents />}
    </div>
  );
}

function Organisers() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [suspending, setSuspending] = useState<User | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', filter],
    queryFn: () =>
      api.get<{ users: User[]; counts: Record<string, number> }>(
        `/admin/users${filter ? `?status=${filter}` : ''}`
      )
  });

  const act = useMutation({
    mutationFn: ({ id, action, why }: { id: string; action: string; why?: string }) =>
      api.post(`/admin/users/${id}/${action}`, why ? { reason: why } : undefined),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.push(
        'ok',
        variables.action === 'approve'
          ? 'Approved. They can publish now.'
          : variables.action === 'suspend'
            ? 'Suspended, and their public pages are down.'
            : 'Reinstated. Their events stay unpublished.'
      );
      setSuspending(null);
      setReason('');
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'That action failed.')
  });

  if (isLoading) return <PageLoader label="Loading accounts" />;
  const users = data?.users ?? [];

  return (
    <div>
      <div className="row row--wrap" style={{ marginBottom: 'var(--s4)' }}>
        {[
          ['pending', 'Awaiting approval'],
          ['approved', 'Approved'],
          ['suspended', 'Suspended'],
          ['', 'Everyone']
        ].map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            className={`btn btn--sm ${filter === value ? 'btn--solid' : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
            {data?.counts?.[value] !== undefined && value ? ` (${data.counts[value]})` : ''}
          </button>
        ))}
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filter === 'pending' ? 'Nothing waiting' : 'No accounts here'}
          body={
            filter === 'pending'
              ? 'Signups from an institutional email domain are approved automatically and never reach this queue.'
              : 'Try another filter.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Signed up</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{user.name}</div>
                    <div className="meta">{user.email}</div>
                  </td>
                  <td className="meta">{user.role}</td>
                  <td>
                    <span
                      className={`chip ${
                        user.status === 'approved'
                          ? 'chip--ok'
                          : user.status === 'suspended'
                            ? 'chip--reject'
                            : 'chip--wait'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="meta">{fmtDate(user.createdAt)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                      {user.status !== 'approved' && (
                        <button
                          type="button"
                          className="btn btn--sm btn--primary"
                          onClick={() =>
                            act.mutate({
                              id: user.id,
                              action: user.status === 'suspended' ? 'reinstate' : 'approve'
                            })
                          }
                          disabled={act.isPending}
                        >
                          {user.status === 'suspended' ? (
                            <>
                              <Undo2 size={14} aria-hidden /> Reinstate
                            </>
                          ) : (
                            <>
                              <UserCheck size={14} aria-hidden /> Approve
                            </>
                          )}
                        </button>
                      )}
                      {user.status !== 'suspended' && user.role !== 'admin' && (
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          onClick={() => setSuspending(user)}
                          disabled={act.isPending}
                        >
                          <Ban size={14} aria-hidden /> Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!suspending}
        title={`Suspend ${suspending?.name ?? ''}?`}
        danger
        confirmLabel="Suspend"
        busy={act.isPending}
        onCancel={() => {
          setSuspending(null);
          setReason('');
        }}
        onConfirm={() =>
          suspending && act.mutate({ id: suspending.id, action: 'suspend', why: reason })
        }
        body={
          <>
            <p>
              They are signed out immediately and every event they published goes back to draft.
              Tickets and scan records are kept.
            </p>
            <div className="field">
              <label htmlFor="suspend-reason">Reason (recorded in the audit trail)</label>
              <input
                id="suspend-reason"
                className="input"
                value={reason}
                onChange={(changeEvent) => setReason(changeEvent.target.value)}
                placeholder="What did they do?"
              />
            </div>
          </>
        }
      />
    </div>
  );
}

function PublishedEvents() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AdminEvent | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-events'],
    queryFn: () => api.get<{ events: AdminEvent[] }>('/admin/events')
  });

  const unpublish = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) =>
      api.post(`/admin/events/${id}/unpublish`, { reason: why }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.push('ok', 'Unpublished. Its registration page is gone.');
      setTarget(null);
      setReason('');
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Could not unpublish that.')
  });

  if (isLoading) return <PageLoader label="Loading events" />;
  const events = data?.events ?? [];

  return (
    <div>
      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nothing is public"
          body="Events still in draft are private to their organiser and do not appear here."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Organiser</th>
                <th scope="col">Registered</th>
                <th scope="col">Starts</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{event.name}</div>
                    <div className="meta">
                      {event.status}
                      {event.publicRegistration ? ' · open registration' : ' · invite only'}
                    </div>
                  </td>
                  <td className="meta">{event.organizer?.email ?? 'unknown'}</td>
                  <td className="num">{event.registered}</td>
                  <td className="meta">{fmtDateTime(event.startsAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => setTarget(event)}
                    >
                      <EyeOff size={14} aria-hidden /> Unpublish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title="Unpublish this event?"
        danger
        confirmLabel="Unpublish"
        busy={unpublish.isPending}
        onCancel={() => {
          setTarget(null);
          setReason('');
        }}
        onConfirm={() => target && unpublish.mutate({ id: target.id, why: reason })}
        body={
          <>
            <p>
              <b>{target?.name}</b> goes back to draft. Its registration page stops working;
              existing tickets and scan records are kept.
            </p>
            <div className="field">
              <label htmlFor="unpublish-reason">Reason (recorded in the audit trail)</label>
              <input
                id="unpublish-reason"
                className="input"
                value={reason}
                onChange={(changeEvent) => setReason(changeEvent.target.value)}
                placeholder="Why is this coming down?"
              />
            </div>
          </>
        }
      />
    </div>
  );
}
