"use client";

/**
 * TenantPermissionsProvider — expose aux descendants les permissions RBAC du
 * membre courant.
 *
 * Anti-flash : le layout tenant (server component) calcule les permissions via
 * `getTenantPermissions()` et les passe en `initialPermissions`. Le provider
 * démarre alors directement avec la vraie valeur (`loading=false`) — plus de
 * flash « tout caché » pendant un fetch. Le fetch client `GET
 * /api/tenant/me/permissions` devient une simple resync optionnelle (sans
 * remettre `loading=true`).
 *
 * Sans `initialPermissions` (fallback), on retombe sur l'ancien comportement :
 * `loading=true` jusqu'à la réponse du fetch, `has(...)` renvoie `false`.
 *
 * Invalidation : aucun polling. Rechargé au refresh de page (`router.refresh()`
 * ou navigation hard).
 *
 * OWNER : `isOwner=true` ⇒ `has(domain, level)` retourne toujours `true`.
 */

import * as React from "react";
import type { TenantDomain, TenantLevel, TenantPermissions } from "@/lib/tenant-permissions";

const LEVEL_ORDER: Record<TenantLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };

const SAFE_PERMS: Record<TenantDomain, TenantLevel> = {
  projects: "none",
  design: "none",
  catalog: "none",
  members: "none",
  settings: "none",
};

type PermissionsState = {
  isOwner: boolean;
  roleKey: string | null;
  permissions: Record<TenantDomain, TenantLevel>;
  loading: boolean;
  error: boolean;
};

type PermissionsContextValue = PermissionsState & {
  /** True si le membre dispose d'au moins `level` sur `domain`. OWNER ⇒ toujours vrai. */
  has: (domain: TenantDomain, level: TenantLevel) => boolean;
};

const Ctx = React.createContext<PermissionsContextValue | null>(null);

const INITIAL_STATE: PermissionsState = {
  isOwner: false,
  roleKey: null,
  permissions: { ...SAFE_PERMS },
  loading: true,
  error: false,
};

function parsePermissions(raw: unknown): Record<TenantDomain, TenantLevel> {
  const result = { ...SAFE_PERMS };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  for (const d of Object.keys(SAFE_PERMS) as TenantDomain[]) {
    const v = obj[d];
    if (v === "none" || v === "read" || v === "write" || v === "admin") result[d] = v;
  }
  return result;
}

export function TenantPermissionsProvider({
  children,
  initialPermissions,
}: {
  children: React.ReactNode;
  /**
   * Permissions résolues côté serveur (layout tenant). Fournies ⇒ pas de flash :
   * le provider démarre avec la vraie valeur, `loading=false`.
   */
  initialPermissions?: TenantPermissions;
}) {
  const [state, setState] = React.useState<PermissionsState>(() =>
    initialPermissions
      ? {
          isOwner: initialPermissions.isOwner,
          roleKey: initialPermissions.roleKey,
          permissions: { ...initialPermissions.permissions },
          loading: false,
          error: false,
        }
      : INITIAL_STATE,
  );

  React.useEffect(() => {
    let cancelled = false;
    // Resync optionnelle : on ne repasse jamais `loading=true` (déjà résolu par
    // les données initiales serveur). En cas d'échec, on garde l'état courant.
    fetch("/api/tenant/me/permissions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setState({
          isOwner: !!data.isOwner,
          roleKey: typeof data.roleKey === "string" ? data.roleKey : null,
          permissions: parsePermissions(data.permissions),
          loading: false,
          error: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Pas de données initiales et fetch KO → marque l'erreur (sinon on
        // conserve les permissions serveur déjà en place).
        setState((prev) =>
          prev.loading ? { ...INITIAL_STATE, loading: false, error: true } : prev,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo<PermissionsContextValue>(() => {
    const has = (domain: TenantDomain, level: TenantLevel): boolean => {
      if (state.loading) return false;
      if (state.isOwner) return true;
      return (LEVEL_ORDER[state.permissions[domain]] ?? 0) >= LEVEL_ORDER[level];
    };
    return { ...state, has };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Hook principal : `const allowed = useTenantPermission("members", "admin")`.
 * Doit être appelé sous `<TenantPermissionsProvider>` (monté dans le layout tenant).
 */
export function useTenantPermission(domain: TenantDomain, level: TenantLevel): boolean {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useTenantPermission must be used within a <TenantPermissionsProvider>");
  }
  return ctx.has(domain, level);
}

/** Accès brut au contexte (isOwner, loading, permissions…). */
export function useTenantPermissions(): PermissionsContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useTenantPermissions must be used within a <TenantPermissionsProvider>");
  }
  return ctx;
}

/**
 * Variante tolérante : retourne `null` si le provider n'est pas monté (ex.
 * layout `(app)` sans contexte tenant). Utilisée par la sidebar qui doit rester
 * fonctionnelle hors contexte tenant (aucun masquage appliqué dans ce cas).
 */
export function useTenantPermissionsOptional(): PermissionsContextValue | null {
  return React.useContext(Ctx);
}
