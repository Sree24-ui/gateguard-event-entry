import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { GateEvent } from '../lib/types';
import { useToast } from '../hooks/useToast';
import { PageLoader } from '../components/PageLoader';
import { toLocalInput } from '../lib/format';

const schema = z
  .object({
    name: z.string().trim().min(3, 'Give the event a name').max(140),
    description: z.string().trim().max(2000),
    venue: z.string().trim().max(200),
    startsAt: z.string().min(1, 'Pick a start date and time'),
    endsAt: z.string().min(1, 'Pick an end date and time'),
    capacity: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Use a whole number, or 0 for unlimited'),
    status: z.enum(['draft', 'published', 'live', 'closed']),
    gates: z.string().trim().min(1, 'Name at least one gate'),
    publicRegistration: z.boolean()
  })
  .refine((values) => new Date(values.endsAt) > new Date(values.startsAt), {
    message: 'The event must end after it starts',
    path: ['endsAt']
  });

type Values = z.infer<typeof schema>;

export function EventFormPage() {
  const { eventId } = useParams();
  const editing = Boolean(eventId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.get<{ event: GateEvent }>(`/events/${eventId}`),
    enabled: editing
  });

  const existing = data?.event;
  const start = new Date(Date.now() + 86400000);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: existing?.name ?? '',
      description: existing?.description ?? '',
      venue: existing?.venue ?? '',
      startsAt: toLocalInput(existing?.startsAt ?? start),
      endsAt: toLocalInput(existing?.endsAt ?? new Date(start.getTime() + 4 * 3600000)),
      capacity: String(existing?.capacity ?? 0),
      status: existing?.status ?? 'published',
      gates: (existing?.gates ?? ['Main Gate']).join(', '),
      publicRegistration: existing?.publicRegistration ?? true
    }
  });

  const save = useMutation({
    mutationFn: async (values: Values) => {
      const body = {
        ...values,
        capacity: Number(values.capacity),
        startsAt: new Date(values.startsAt).toISOString(),
        endsAt: new Date(values.endsAt).toISOString(),
        gates: values.gates.split(',').map((gate) => gate.trim()).filter(Boolean)
      };
      return editing
        ? api.patch<{ event: GateEvent }>(`/events/${eventId}`, body)
        : api.post<{ event: GateEvent }>('/events', body);
    },
    onSuccess: ({ event }) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['event', event.id] });
      toast.push('ok', editing ? 'Event updated.' : `"${event.name}" is ready for registrations.`);
      navigate(`/app/events/${event.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details?.length) {
        err.details.forEach((detail) => {
          setError(detail.field as keyof Values, { message: detail.message });
        });
        return;
      }
      toast.push('error', err instanceof ApiError ? err.message : 'Could not save the event.');
    }
  });

  if (editing && isLoading) return <PageLoader label="Loading the event" />;

  return (
    <div className="shell page" style={{ maxWidth: 680 }}>
      <span className="stamp page__eyebrow">{editing ? 'Edit event' : 'New event'}</span>
      <h1 style={{ marginBottom: 'var(--s6)' }}>
        {editing ? existing?.name : 'Set up the event'}
      </h1>

      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        noValidate
        className="stack"
        style={{ gap: 'var(--s5)' }}
      >
        <Field label="Event name" error={errors.name?.message} htmlFor="name">
          <input id="name" className="input" aria-invalid={!!errors.name} {...register('name')} />
        </Field>

        <Field label="Description" error={errors.description?.message} htmlFor="description">
          <textarea
            id="description"
            className="textarea"
            placeholder="What is happening, and who is it for?"
            {...register('description')}
          />
        </Field>

        <Field label="Venue" error={errors.venue?.message} htmlFor="venue">
          <input id="venue" className="input" placeholder="Main Auditorium, Block C" {...register('venue')} />
        </Field>

        <div className="field-row">
          <Field label="Starts" error={errors.startsAt?.message} htmlFor="startsAt">
            <input id="startsAt" className="input" type="datetime-local" {...register('startsAt')} />
          </Field>
          <Field label="Ends" error={errors.endsAt?.message} htmlFor="endsAt">
            <input id="endsAt" className="input" type="datetime-local" aria-invalid={!!errors.endsAt} {...register('endsAt')} />
          </Field>
        </div>

        <div className="field-row">
          <Field
            label="Capacity"
            hint="0 means no limit. Registrations stop once the limit is reached."
            error={errors.capacity?.message}
            htmlFor="capacity"
          >
            <input id="capacity" className="input num" type="number" min={0} {...register('capacity')} />
          </Field>
          <Field label="Status" error={errors.status?.message} htmlFor="status">
            <select id="status" className="select" {...register('status')}>
              <option value="draft">Draft — hidden, no check-ins</option>
              <option value="published">Published — open for registration</option>
              <option value="live">Live — doors open</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
        </div>

        <Field
          label="Gates"
          hint="Comma separated. Operators pick one when they start scanning."
          error={errors.gates?.message}
          htmlFor="gates"
        >
          <input id="gates" className="input" placeholder="Main Gate, Side Gate" {...register('gates')} />
        </Field>

        <label className="row" style={{ gap: 'var(--s3)', cursor: 'pointer' }}>
          <input type="checkbox" {...register('publicRegistration')} />
          <span>
            Allow anyone with the link to register
            <span className="field-hint" style={{ display: 'block' }}>
              Turn this off for invite-only events; you can still add attendees yourself.
            </span>
          </span>
        </label>

        <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
          <button type="submit" className="btn btn--primary" disabled={isSubmitting || save.isPending}>
            {(isSubmitting || save.isPending) && <Loader2 size={15} className="spin" aria-hidden />}
            {editing ? 'Save changes' : 'Create event'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error">
          <AlertCircle size={13} aria-hidden /> {error}
        </span>
      )}
    </div>
  );
}
