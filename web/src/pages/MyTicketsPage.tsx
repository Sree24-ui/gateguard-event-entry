import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, MapPin, Fingerprint, Loader2, AlertCircle, Ticket as TicketIcon, ChevronRight
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Wordmark } from '../components/Brand';
import { PageLoader } from '../components/PageLoader';
import { EmptyState } from '../components/EmptyState';
import { fmtDate, fmtTime } from '../lib/format';
import { enrolPasskey, unlockWithPasskey, hasDeviceAuthenticator } from '../lib/passkey';

interface MyTicket {
  code: string;
  status: 'valid' | 'cancelled';
  state: 'issued' | 'inside' | 'outside';
  event: { id: string; name: string; venue: string; startsAt: string; status: string };
}

const REMEMBERED_EMAIL = 'gg_attendee_email';

export function MyTicketsPage() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader label="Checking your sign-in" />;
  if (!user || user.role !== 'attendee') return <AttendeeSignIn />;
  return <TicketList />;
}

function AttendeeSignIn() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBERED_EMAIL) ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUseDevice, setCanUseDevice] = useState(false);

  useEffect(() => {
    hasDeviceAuthenticator().then(setCanUseDevice);
  }, []);

  const done = () => {
    localStorage.setItem(REMEMBERED_EMAIL, email.trim().toLowerCase());
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const request = useMutation({
    mutationFn: () => api.post<{ devCode?: string }>('/attendee/otp/request', { email }),
    onSuccess: (data) => {
      setSent(true);
      setError(null);
      if (data.devCode) {
        setCode(data.devCode);
        toast.push('info', `Development mode: your code is ${data.devCode}`);
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send a code.')
  });

  const verify = useMutation({
    mutationFn: () => api.post('/attendee/otp/verify', { email, code }),
    onSuccess: done,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That code did not work.')
  });

  const unlock = useMutation({
    mutationFn: () => unlockWithPasskey(email.trim().toLowerCase()),
    onSuccess: done,
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : 'Your device did not confirm it was you. Use a sign-in code instead.'
      )
  });

  const remembered = localStorage.getItem(REMEMBERED_EMAIL);

  return (
    <div className="public-shell">
      <Link to="/" style={{ textDecoration: 'none' }}>
        <Wordmark size={20} />
      </Link>

      <div className="public-head" style={{ marginTop: 'var(--s7)' }}>
        <span className="stamp">Your tickets</span>
        <h1>Sign in to see your passes</h1>
        <p className="muted">
          No password. We send a six-digit code to your email, and after that your device can
          unlock it.
        </p>
      </div>

      <form
        className="stack"
        style={{ gap: 'var(--s4)' }}
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          setError(null);
          if (sent) verify.mutate();
          else request.mutate();
        }}
      >
        {error && (
          <p className="form-alert" role="alert">
            <AlertCircle size={15} aria-hidden /> {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="attendee-email">Email</label>
          <input
            id="attendee-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(changeEvent) => setEmail(changeEvent.target.value)}
            disabled={sent}
            required
          />
          <span className="field-hint">The address you registered with.</span>
        </div>

        {sent && (
          <div className="field">
            <label htmlFor="attendee-code">Six-digit code</label>
            <input
              id="attendee-code"
              className="input num"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(changeEvent) => setCode(changeEvent.target.value.replace(/\D/g, ''))}
              required
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setSent(false);
                setCode('');
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--lg btn--block"
          disabled={request.isPending || verify.isPending}
        >
          {(request.isPending || verify.isPending) && (
            <Loader2 size={16} className="spin" aria-hidden />
          )}
          {sent ? 'Open my tickets' : 'Email me a code'}
        </button>

        {canUseDevice && remembered && !sent && (
          <button
            type="button"
            className="btn btn--lg btn--block"
            onClick={() => {
              setError(null);
              unlock.mutate();
            }}
            disabled={unlock.isPending}
          >
            {unlock.isPending ? (
              <Loader2 size={16} className="spin" aria-hidden />
            ) : (
              <Fingerprint size={16} aria-hidden />
            )}
            Unlock with this device
          </button>
        )}
      </form>
    </div>
  );
}

function TicketList() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [canUseDevice, setCanUseDevice] = useState(false);

  useEffect(() => {
    hasDeviceAuthenticator().then(setCanUseDevice);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['my-tickets'],
    queryFn: () => api.get<{ tickets: MyTicket[] }>('/attendee/tickets')
  });

  const enrol = useMutation({
    mutationFn: enrolPasskey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.push('ok', 'Done. Next time this device will unlock your tickets.');
    },
    onError: () => toast.push('error', 'Your device did not finish setting that up.')
  });

  if (isLoading) return <PageLoader label="Loading your tickets" />;
  const tickets = data?.tickets ?? [];

  return (
    <div className="public-shell">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Wordmark size={20} />
        </Link>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => signOut()}>
          Sign out
        </button>
      </div>

      <div className="public-head" style={{ marginTop: 'var(--s6)' }}>
        <span className="stamp">Your tickets</span>
        <h1>{user?.email}</h1>
      </div>

      {canUseDevice && !user?.hasPasskey && (
        <button
          type="button"
          className="btn btn--block"
          style={{ marginBottom: 'var(--s5)' }}
          onClick={() => enrol.mutate()}
          disabled={enrol.isPending}
        >
          {enrol.isPending ? (
            <Loader2 size={16} className="spin" aria-hidden />
          ) : (
            <Fingerprint size={16} aria-hidden />
          )}
          Use Face ID or fingerprint next time
        </button>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title="No tickets yet"
          body="Tickets issued to this email will appear here. If you registered with a different address, sign in with that one instead."
        />
      ) : (
        <div>
          {tickets.map((ticket) => (
            <Link key={ticket.code} to={`/t/${ticket.code}`} className="pick-row">
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontWeight: 500 }}>{ticket.event.name}</b>
                <span className="meta">
                  <CalendarDays size={12} aria-hidden /> {fmtDate(ticket.event.startsAt)} ·{' '}
                  {fmtTime(ticket.event.startsAt)}
                  {ticket.event.venue && (
                    <>
                      {' · '}
                      <MapPin size={12} aria-hidden /> {ticket.event.venue}
                    </>
                  )}
                </span>
              </span>
              <span className="row" style={{ gap: 'var(--s3)' }}>
                {ticket.status === 'cancelled' ? (
                  <span className="chip chip--reject">Cancelled</span>
                ) : ticket.state === 'inside' ? (
                  <span className="chip chip--ok">Inside</span>
                ) : ticket.state === 'outside' ? (
                  <span className="chip chip--quiet">Attended</span>
                ) : (
                  <span className="chip">Ready</span>
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
