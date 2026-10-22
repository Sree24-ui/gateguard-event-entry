import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, MapPin, Loader2, AlertCircle, Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { PublicEvent, Ticket } from '../lib/types';
import { Wordmark } from '../components/Brand';
import { PageLoader } from '../components/PageLoader';
import { QrTicket } from '../components/QrTicket';
import { PhotoField } from '../components/PhotoField';
import { fmtDate, fmtTime } from '../lib/format';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  phone: z.string().trim().max(32),
  collegeId: z.string().trim().max(64)
});

type Values = z.infer<typeof schema>;

export function PublicRegisterPage() {
  const { eventId = '' } = useParams();
  const [issued, setIssued] = useState<Ticket | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-event', eventId],
    queryFn: () => api.get<{ event: PublicEvent }>(`/public/events/${eventId}`),
    retry: false
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', phone: '', collegeId: '' }
  });

  const submit = useMutation({
    mutationFn: (values: Values) =>
      api.post<{ ticket: Ticket }>(`/public/events/${eventId}/register`, {
        ...values,
        ...(photo ? { photo } : {})
      }),
    onSuccess: ({ ticket }) => setIssued(ticket),
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.message : 'Could not complete your registration.')
  });

  if (isLoading) return <PageLoader label="Loading the event" />;

  if (error || !data) {
    return (
      <div className="public-shell">
        <Wordmark size={22} />
        <h1 style={{ marginBlock: 'var(--s7) var(--s3)' }}>Event not found</h1>
        <p className="muted">
          This registration link is not active. Check with the organizing team for the current link.
        </p>
      </div>
    );
  }

  const event = data.event;

  if (issued) {
    return (
      <div className="ticket-page">
        <div className="pass">
          <div className="pass__head">
            <Wordmark size={18} />
            <span className="stamp stamp--on-carbon">You are in</span>
          </div>
          <div className="pass__event">
            <h1>{event.name}</h1>
            <p className="meta" style={{ marginTop: 'var(--s2)' }}>
              Registered as {issued.attendee.name}. Save this page — the link is your ticket.
            </p>
          </div>
          <QrTicket
            payload={issued.qrPayload ?? ''}
            code={issued.code}
            fileName={`gateguard-${event.name.replace(/\s+/g, '-').toLowerCase()}`}
          />
          <div className="pass__perf" aria-hidden />
          <div className="pass__stub">
            <div className="pass__row">
              <dt>Permanent link</dt>
              <dd className="pass__code">
                <Link to={`/t/${issued.code}`}>/t/{issued.code.slice(0, 10)}…</Link>
              </dd>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const closed = event.status === 'closed' || !event.publicRegistration;
  const full = event.spotsLeft === 0;

  return (
    <div className="public-shell">
      <Link to="/" style={{ textDecoration: 'none' }}>
        <Wordmark size={20} />
      </Link>

      <div className="public-head" style={{ marginTop: 'var(--s7)' }}>
        <span className="stamp">Register to attend</span>
        <h1>{event.name}</h1>
        {event.description && <p className="muted">{event.description}</p>}
        <div className="public-facts">
          <div>
            <CalendarDays size={14} aria-hidden /> {fmtDate(event.startsAt)} ·{' '}
            {fmtTime(event.startsAt)}–{fmtTime(event.endsAt)}
          </div>
          {event.venue && (
            <div>
              <MapPin size={14} aria-hidden /> {event.venue}
            </div>
          )}
          <div>
            <Users size={14} aria-hidden />
            {event.spotsLeft === null
              ? `${event.issued} registered`
              : `${event.spotsLeft} of ${event.capacity} spots left`}
          </div>
        </div>
      </div>

      {closed || full ? (
        <p className="form-alert" role="status">
          <AlertCircle size={15} aria-hidden />
          {full ? 'This event is full.' : 'Registration is closed for this event.'}
        </p>
      ) : (
        <form
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            submit.mutate(values);
          })}
          noValidate
          className="stack"
          style={{ gap: 'var(--s4)' }}
        >
          {formError && (
            <p className="form-alert" role="alert">
              <AlertCircle size={15} aria-hidden /> {formError}
            </p>
          )}

          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" autoComplete="name" aria-invalid={!!errors.name} {...register('name')} />
            {errors.name && (
              <span className="field-error">
                <AlertCircle size={13} aria-hidden /> {errors.name.message}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            <span className="field-hint">One ticket per email. Used only to find your ticket again.</span>
            {errors.email && (
              <span className="field-error">
                <AlertCircle size={13} aria-hidden /> {errors.email.message}
              </span>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="collegeId">College ID</label>
              <input id="collegeId" className="input" {...register('collegeId')} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" className="input" type="tel" autoComplete="tel" {...register('phone')} />
            </div>
          </div>

          {event.faceCheck && <PhotoField value={photo} onChange={setPhoto} />}

          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={isSubmitting || submit.isPending}
          >
            {(isSubmitting || submit.isPending) && <Loader2 size={16} className="spin" aria-hidden />}
            Get my QR ticket
          </button>
        </form>
      )}
    </div>
  );
}
