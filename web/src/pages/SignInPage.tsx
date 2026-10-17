import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { Wordmark } from '../components/Brand';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password')
});

type Values = z.infer<typeof schema>;

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <Link to="/" className="auth__brand">
          <Wordmark size={22} />
        </Link>

        <span className="stamp" style={{ marginTop: 'var(--s7)', display: 'block' }}>
          Sign in
        </span>
        <h1 style={{ marginBlock: 'var(--s2) var(--s6)' }}>Open your gate</h1>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="stack" style={{ gap: 'var(--s4)' }}>
          {formError && (
            <p className="form-alert" role="alert">
              <AlertCircle size={15} aria-hidden />
              {formError}
            </p>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <span className="field-error" id="email-error">
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
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
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
            {errors.password && (
              <span className="field-error" id="password-error">
                <AlertCircle size={13} aria-hidden /> {errors.password.message}
              </span>
            )}
          </div>

          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={isSubmitting}>
            {isSubmitting && <Loader2 size={16} className="spin" aria-hidden />}
            Sign in
          </button>
        </form>

        <p className="meta" style={{ marginTop: 'var(--s5)' }}>
          No account yet? <Link to="/signup">Create an organizer account</Link>
        </p>

        <div className="auth__demo">
          <span className="stamp">Demo accounts</span>
          <p className="meta">
            Organizer <code>demo@gateguard.app</code> · Operator <code>gate@gateguard.app</code>
            <br />
            Password <code>gateguard-demo</code> — sample data is labelled DEMO throughout.
          </p>
        </div>
      </div>

      <aside className="auth__aside" aria-hidden>
        <div className="auth__aside-inner">
          <span className="stamp stamp--on-carbon">Gate 01 · live</span>
          <div className="auth__stat">
            <b>51</b>
            <span>of 84 checked in</span>
          </div>
          <div className="auth__ticks">
            {Array.from({ length: 84 }, (_, i) => (
              <i key={i} data-on={i < 51 || undefined} />
            ))}
          </div>
          <p>
            Every ticket is signed, every scan is resolved by the server, and every rejection says
            why.
          </p>
        </div>
      </aside>
    </div>
  );
}
