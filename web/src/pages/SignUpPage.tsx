import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { Wordmark } from '../components/Brand';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(8, 'Use at least 8 characters').max(200)
});

type Values = z.infer<typeof schema>;

export function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' });

  const password = watch('password') || '';

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await signUp(values.name, values.email, values.password);
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the account.');
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <Link to="/" className="auth__brand">
          <Wordmark size={22} />
        </Link>

        <span className="stamp" style={{ marginTop: 'var(--s7)', display: 'block' }}>
          Create account
        </span>
        <h1 style={{ marginBlock: 'var(--s2) var(--s3)' }}>Run your first event</h1>
        <p className="muted" style={{ marginBottom: 'var(--s6)' }}>
          You get an organizer account for your own club. Gate operators are issued from inside
          your account — nobody can sign themselves up as one.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="stack" style={{ gap: 'var(--s4)' }}>
          {formError && (
            <p className="form-alert" role="alert">
              <AlertCircle size={15} aria-hidden />
              {formError}
            </p>
          )}

          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              className="input"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...register('name')}
            />
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
            {errors.email && (
              <span className="field-error">
                <AlertCircle size={13} aria-hidden /> {errors.email.message}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-affix">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                aria-describedby="password-rule"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
              </button>
            </div>
            <span
              className="field-hint"
              id="password-rule"
              style={password.length >= 8 ? { color: 'var(--ink-2)' } : undefined}
            >
              {password.length >= 8 && <Check size={12} aria-hidden style={{ display: 'inline' }} />} At
              least 8 characters
            </span>
            {errors.password && (
              <span className="field-error">
                <AlertCircle size={13} aria-hidden /> {errors.password.message}
              </span>
            )}
          </div>

          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={isSubmitting}>
            {isSubmitting && <Loader2 size={16} className="spin" aria-hidden />}
            Create organizer account
          </button>
        </form>

        <p className="meta" style={{ marginTop: 'var(--s5)' }}>
          Already set up? <Link to="/signin">Sign in</Link>
        </p>
      </div>

      <aside className="auth__aside" aria-hidden>
        <div className="auth__aside-inner">
          <span className="stamp stamp--on-carbon">What you get</span>
          <ul className="auth__list">
            <li>Signed QR tickets, one per attendee</li>
            <li>A phone scanner that works at the gate</li>
            <li>Live headcount the whole committee can watch</li>
            <li>Offline queue with honest reconciliation</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
