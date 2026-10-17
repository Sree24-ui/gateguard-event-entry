import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Keeps one broken view from taking down the whole gate. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[gateguard] view crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="shell" style={{ paddingBlock: 'var(--s9)', maxWidth: 560 }}>
        <TriangleAlert size={28} strokeWidth={1.5} aria-hidden />
        <h1 style={{ marginBlock: 'var(--s4) var(--s2)' }}>This screen stopped responding</h1>
        <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
          Nothing was lost — queued scans stay on this device. Reload to carry on.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Reload GateGuard
        </button>
      </div>
    );
  }
}
