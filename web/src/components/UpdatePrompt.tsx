import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

/** A new build is live; let the operator finish the queue before reloading. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisterError: (error) => console.error('[gateguard] service worker failed', error)
  });

  if (!needRefresh) return null;

  return (
    <div className="toasts">
      <div className="toast" role="status">
        <RefreshCw size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
        <span className="grow">
          A new version of GateGuard is ready.
          <button
            type="button"
            className="btn btn--sm btn--primary"
            style={{ marginTop: 'var(--s2)', display: 'flex' }}
            onClick={() => updateServiceWorker(true)}
          >
            Reload now
          </button>
        </span>
        <button type="button" onClick={() => setNeedRefresh(false)} aria-label="Dismiss">
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
