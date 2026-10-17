import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { GateEvent, User } from '../lib/types';
import { EmptyState } from '../components/EmptyState';
import { PageLoader } from '../components/PageLoader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';
import { fmtDate, pluralize } from '../lib/format';

export function TeamPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);

  const operators = useQuery({
    queryKey: ['operators'],
    queryFn: () => api.get<{ operators: User[] }>('/operators')
  });
  const events = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<{ events: GateEvent[] }>('/events')
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/operators/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.push('ok', 'Operator removed.');
      setRemoving(null);
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Could not remove the operator.')
  });

  if (operators.isLoading) return <PageLoader label="Loading your team" />;

  const list = operators.data?.operators ?? [];
  const eventsById = new Map((events.data?.events ?? []).map((event) => [event.id, event]));

  return (
    <div className="shell page" style={{ maxWidth: 900 }}>
      <div className="spread" style={{ alignItems: 'flex-end', marginBottom: 'var(--s6)' }}>
        <div>
          <span className="stamp page__eyebrow">Gate operators</span>
          <h1>Who can scan</h1>
          <p className="muted" style={{ marginTop: 'var(--s2)', maxWidth: '62ch' }}>
            Operators can only open the scanner for events you assign them. They cannot create
            events, issue tickets, export attendee data or read the audit log.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          <UserPlus size={15} aria-hidden /> Add operator
        </button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No operators yet"
          body="Create an account for each person working a gate. They sign in on their own phone and only see the events you assign."
          action={
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              <UserPlus size={15} aria-hidden /> Add your first operator
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Operator</th>
                <th scope="col">Assigned events</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((operator) => (
                <tr key={operator.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{operator.name}</div>
                    <div className="meta">{operator.email}</div>
                  </td>
                  <td>
                    {operator.assignedEvents.length === 0 ? (
                      <span className="chip chip--quiet">None yet</span>
                    ) : (
                      <div className="row row--wrap" style={{ gap: 4 }}>
                        {operator.assignedEvents.map((id) => (
                          <span className="chip" key={id}>
                            {eventsById.get(id)?.name ?? 'Event'}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="meta">{fmtDate(operator.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm btn--icon btn--danger"
                      aria-label={`Remove ${operator.name}`}
                      onClick={() => setRemoving(operator)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddOperator events={events.data?.events ?? []} onClose={() => setAdding(false)} />
      )}

      <ConfirmDialog
        open={!!removing}
        title="Remove this operator?"
        danger
        confirmLabel="Remove"
        busy={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
        body={
          <p>
            {removing?.name} will be signed out and can no longer scan at any gate. Scans they
            already recorded are kept.
          </p>
        }
      />
    </div>
  );
}

function AddOperator({ events, onClose }: { events: GateEvent[]; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [eventIds, setEventIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () => api.post<{ operator: User }>('/operators', { ...values, eventIds }),
    onSuccess: ({ operator }) => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.push('ok', `${operator.name} can now sign in and scan. Share the password securely.`);
      onClose();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Could not create the operator.')
  });

  const toggle = (id: string) =>
    setEventIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  return (
    <ConfirmDialog
      open
      title="Add a gate operator"
      confirmLabel="Create operator"
      busy={create.isPending}
      onCancel={onClose}
      onConfirm={() => create.mutate()}
      body={
        <>
          <div className="field">
            <label htmlFor="op-name">Name</label>
            <input
              id="op-name"
              className="input"
              value={values.name}
              onChange={(e) => setValues((c) => ({ ...c, name: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="op-email">Email</label>
            <input
              id="op-email"
              className="input"
              type="email"
              value={values.email}
              onChange={(e) => setValues((c) => ({ ...c, email: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="op-password">Temporary password</label>
            <input
              id="op-password"
              className="input"
              type="text"
              value={values.password}
              onChange={(e) => setValues((c) => ({ ...c, password: e.target.value }))}
            />
            <span className="field-hint">
              At least 8 characters. Send it to them over a private channel, not a group chat.
            </span>
          </div>
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="field-label" style={{ marginBottom: 'var(--s2)' }}>
              Events they can scan
            </legend>
            {events.length === 0 ? (
              <p className="meta">Create an event first, then assign it here.</p>
            ) : (
              <div className="stack" style={{ gap: 'var(--s2)' }}>
                {events.map((event) => (
                  <label className="row" key={event.id} style={{ gap: 'var(--s3)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={eventIds.includes(event.id)}
                      onChange={() => toggle(event.id)}
                    />
                    <span>
                      {event.name}
                      <span className="meta"> · {pluralize(event.gates.length, 'gate')}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </>
      }
    />
  );
}
