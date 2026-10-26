"use client";

/**
 * PermissionsProvider — charge UNE FOIS au mount les permissions du collaborateur
 * courant via `/api/supervisor/me/permissions` et les expose à tous les
 * descendants via le context React.
 *
 * Comportement de chargement : tant que `loading=true`, `has(...)` retourne
 * `false` (= boutons cachés/désactivés). Cohérent avec le choix "tout caché
 * par défaut" du brainstorm — pas de flash inverse.
 *
 * Invalidation : aucun polling. Les permissions sont rechargées **uniquement**
 * au refresh de page (`router.refresh()` ou navigation hard). Si l'admin modifie
 * la matrice et que le user est connecté, il verra les changements à la
 * prochaine reload.
 *
 * SUPERADMIN : la sentinelle `["*"]` retournée par l'API est interprétée
 * comme "toutes permissions" → `has(anyKey)` retourne toujours `true`.
 */

import * as React from "react";

type PermissionsState = {
  /** Liste des clés de permissions actives, ou `["*"]` pour SUPERADMIN. */
  permissions: string[];
  /** Rôle plateforme courant (SUPERADMIN, ADMIN, SUPPORT, TECH, custom...). */
  role: string | null;
  /** Bypass implicite — équivaut à `permissions = ["*"]`. */
  isSuperAdmin: boolean;
  /** True pendant le 1er fetch après mount. */
  loading: boolean;
  /** True si le fetch a échoué (auth perdue, etc.). */
  error: boolean;
};

type PermissionsContextValue = PermissionsState & {
  /**
   * Retourne true si l'utilisateur courant a la permission `key`.
   * Pendant le chargement initial, retourne `false` (caché par défaut).
   * SUPERADMIN retourne toujours `true`.
   */
  has: (key: string) => boolean;
  /** True si au moins une des clés est accordée. */
  hasAny: (keys: ReadonlyArray<string>) => boolean;
  /** True si toutes les clés sont accordées. */
  hasAll: (keys: ReadonlyArray<string>) => boolean;
};

const Ctx = React.createContext<PermissionsContextValue | null>(null);

const INITIAL_STATE: PermissionsState = {
  permissions: [],
  role: null,
  isSuperAdmin: false,
  loading: true,
  error: false,
};

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PermissionsState>(INITIAL_STATE);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/supervisor/me/permissions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setState({ ...INITIAL_STATE, loading: false, error: true });
          return;
        }
        setState({
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
          role: typeof data.role === "string" ? data.role : null,
          isSuperAdmin: !!data.isSuperAdmin,
          loading: false,
          error: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ ...INITIAL_STATE, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo<PermissionsContextValue>(() => {
    const has = (key: string): boolean => {
      if (state.loading) return false;
      if (state.isSuperAdmin) return true;
      return state.permissions.includes(key);
    };
    return {
      ...state,
      has,
      hasAny: (keys) => keys.some(has),
      hasAll: (keys) => keys.every(has),
    };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Hook principal : `const { has, loading, isSuperAdmin } = useCurrentPermissions()`.
 * Doit être appelé sous `<PermissionsProvider>` (présent dans le layout supervisor).
 */
export function useCurrentPermissions(): PermissionsContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useCurrentPermissions must be used within a <PermissionsProvider>");
  }
  return ctx;
}
