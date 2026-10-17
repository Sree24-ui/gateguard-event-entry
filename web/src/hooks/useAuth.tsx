import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

const CACHE_KEY = 'gg_last_user';

/**
 * The session cookie lives in the browser, so a signed-in operator stays
 * signed in when the network drops — we simply cannot confirm it right then.
 * Caching the identity lets the app shell render offline instead of bouncing
 * the operator to a sign-in page they cannot reach. It grants nothing: every
 * real operation is still authorised by the server against the cookie.
 */
function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Private mode or blocked storage: the app still works online.
  }
}

interface AuthValue {
  user: User | null;
  /** True when we are running on a cached identity we could not re-verify. */
  unverified: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ user: User | null; unverified: boolean }> => {
      try {
        const { user } = await api.get<{ user: User }>('/auth/me');
        cacheUser(user);
        return { user, unverified: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // A missing session is the normal state for a visitor.
          cacheUser(null);
          return { user: null, unverified: false };
        }
        // Could not reach the server. Fall back to the last known identity so
        // a gate that loses wifi keeps working.
        const cached = readCachedUser();
        if (cached) return { user: cached, unverified: true };
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
      cacheUser(user);
      queryClient.setQueryData(['me'], { user, unverified: false });
      return user;
    },
    [queryClient]
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const { user } = await api.post<{ user: User }>('/auth/register', { name, email, password });
      cacheUser(user);
      queryClient.setQueryData(['me'], { user, unverified: false });
      return user;
    },
    [queryClient]
  );

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    cacheUser(null);
    queryClient.setQueryData(['me'], { user: null, unverified: false });
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      user: data?.user ?? null,
      unverified: data?.unverified ?? false,
      loading: isLoading,
      signIn,
      signUp,
      signOut
    }),
    [data, isLoading, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
