/**
 * Shim de `next-auth/react` sur l'API d'authentification d'arkyo-server.
 *
 * - `SessionProvider` lit `GET /api/auth/session` (`{ user, expires }` ou
 *   `null`) au montage, puis à chaque `router.refresh()` (`arkyo:refresh`).
 * - `useSession()` → `{ data, status, update }` comme next-auth.
 * - `signOut({ callbackUrl, redirect })` → `POST /api/auth/logout`, puis
 *   rechargement complet sur `callbackUrl` (page courante par défaut), comme
 *   next-auth.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** Forme de session d'arkyo (`arkyo:types/next-auth.d.ts`). */
export interface Session {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: string;
    collaboratorRole: string | null;
  };
  expires: string;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export type SessionContextValue = {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const REFRESH_EVENT = "arkyo:refresh";

export async function getSession(): Promise<Session | null> {
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Session | null;
    return data && data.user ? data : null;
  } catch {
    return null;
  }
}

export function SessionProvider({
  children,
  session: initialSession,
}: {
  children: ReactNode;
  session?: Session | null;
  /** Accepté pour compatibilité ; pas de polling. */
  refetchInterval?: number;
  /** Accepté pour compatibilité ; pas de re-fetch au focus. */
  refetchOnWindowFocus?: boolean;
  basePath?: string;
}) {
  const [data, setData] = useState<Session | null>(initialSession ?? null);
  const [loading, setLoading] = useState(initialSession === undefined);

  const update = useCallback(async () => {
    const s = await getSession();
    setData(s);
    setLoading(false);
    return s;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (initialSession === undefined) {
      getSession().then((s) => {
        if (cancelled) return;
        setData(s);
        setLoading(false);
      });
    }
    const onRefresh = () => {
      void update();
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
    // `initialSession` ne sert qu'au premier rendu.
  }, [update]);

  const value = useMemo<SessionContextValue>(
    () => ({
      data,
      status: loading ? "loading" : data ? "authenticated" : "unauthenticated",
      update,
    }),
    [data, loading, update],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("[next-auth]: `useSession` must be wrapped in a <SessionProvider />");
  }
  return value;
}

export async function signOut(
  options: { callbackUrl?: string; redirect?: boolean } = {},
): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    // Déconnexion locale malgré tout : le cookie expirera côté serveur.
  }
  if (options.redirect === false) return;
  window.location.assign(options.callbackUrl ?? window.location.href);
}
