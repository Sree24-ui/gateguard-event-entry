import { useEffect, useState } from 'react';

/** Tracks browser connectivity. navigator.onLine only means "has a link", so
 *  a failed request elsewhere can also flip this via `reportOffline`. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
