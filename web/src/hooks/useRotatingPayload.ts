import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Token {
  payload: string;
  expiresAt: string;
  stepMs: number;
}

/**
 * Keeps a live rotating code on screen. Refreshes a little before the step
 * ends so the gate never sees a code that has just died, and falls back to the
 * static payload when the server is unreachable — a pass that cannot refresh
 * is still better than no pass at all.
 */
export function useRotatingPayload(code: string, fallback: string, enabled = true) {
  const [payload, setPayload] = useState(fallback);
  const [live, setLive] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !code) return;
    let cancelled = false;
    let timer: number;

    async function refresh() {
      try {
        const token = await api.get<Token>(`/public/tickets/${code}/token`);
        if (cancelled) return;
        setPayload(token.payload);
        setExpiresAt(new Date(token.expiresAt).getTime());
        setLive(true);
        // Come back 3s early so a slow network cannot strand an expired code.
        const wait = Math.max(new Date(token.expiresAt).getTime() - Date.now() - 3000, 2000);
        timer = window.setTimeout(refresh, wait);
      } catch {
        if (cancelled) return;
        setPayload(fallback);
        setLive(false);
        setExpiresAt(null);
        timer = window.setTimeout(refresh, 10_000);
      }
    }

    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, fallback, enabled]);

  return { payload, live, expiresAt };
}
