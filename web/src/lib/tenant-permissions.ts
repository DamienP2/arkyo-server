/**
 * lib/tenant-permissions.ts
 *
 * Résolveur RBAC tenant — Phase A.
 *
 * - `getTenantPermissions(userId, slug)` : charge membership + TenantRole depuis main.
 * - `hasTenantPermission(perms, domain, minLevel)` : compare niveau.
 * - `requireTenantPermissionPage(domain, level)` : guard Server Component (redirect si refus).
 * - `requireTenantPermissionApi(domain, level)` : guard Route Handler ({ok, response} 403).
 *
 * OWNER bypass : isOwner ⇒ true sur tout domaine/niveau.
 */

// arkyo-server: imports serveur retirés (next/navigation, next/server, db-main,
// tenant-context, auth, next-auth) — le front ne reprend que les types, constantes
// et helpers purs ; le résolveur et les guards sont portés côté Rust.

// ─── Types ───────────────────────────────────────────────────────────────────

export type TenantDomain =
  | "projects"
  | "design"
  | "catalog"
  | "members"
  | "settings";

export type TenantLevel = "none" | "read" | "write" | "admin";

export const LEVEL_ORDER: Record<TenantLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

export const ALL_DOMAINS: TenantDomain[] = [
  "projects",
  "design",
  "catalog",
  "members",
  "settings",
];

export const ALL_LEVELS: TenantLevel[] = ["none", "read", "write", "admin"];

export type TenantPermissions = {
  isOwner: boolean;
  roleKey: string | null;
  permissions: Record<TenantDomain, TenantLevel>;
};

// ─── Permissions par défaut (fallback sécurisé) ───────────────────────────────

const SAFE_PERMISSIONS: Record<TenantDomain, TenantLevel> = {
  projects: "none",
  design: "none",
  catalog: "none",
  members: "none",
  settings: "none",
};

const OWNER_PERMISSIONS: Record<TenantDomain, TenantLevel> = {
  projects: "admin",
  design: "admin",
  catalog: "admin",
  members: "admin",
  settings: "admin",
};

// ─── Résolveur principal ─────────────────────────────────────────────────────

// arkyo-server: `getTenantPermissions(userId, slug)` retiré (lecture Membership +
// TenantRole en base main) — côté serveur Rust, exposé par
// `GET /api/tenant/me/permissions`.

/**
 * Parse les permissions JSON brutes en Record<TenantDomain, TenantLevel>.
 * Valeurs inconnues ou absentes → "none" (défense en profondeur).
 */
function parsePermissions(raw: unknown): Record<TenantDomain, TenantLevel> {
  const result: Record<TenantDomain, TenantLevel> = { ...SAFE_PERMISSIONS };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  for (const d of ALL_DOMAINS) {
    const v = obj[d];
    if (typeof v === "string" && (ALL_LEVELS as string[]).includes(v)) {
      result[d] = v as TenantLevel;
    }
  }
  return result;
}

// ─── Helper de comparaison ───────────────────────────────────────────────────

/**
 * Vérifie si les permissions satisfont au moins `minLevel` sur `domain`.
 * OWNER bypass : isOwner ⇒ toujours vrai.
 */
export function hasTenantPermission(
  perms: TenantPermissions,
  domain: TenantDomain,
  minLevel: TenantLevel,
): boolean {
  if (perms.isOwner) return true;
  return (LEVEL_ORDER[perms.permissions[domain]] ?? 0) >= LEVEL_ORDER[minLevel];
}

// ─── Guards ──────────────────────────────────────────────────────────────────

// arkyo-server: `requireTenantPermissionPage`, `TenantPermissionApiResult` et
// `requireTenantPermissionApi` retirés (guards Server Component / Route Handler
// Next.js) — les contrôles d'accès sont faits par le serveur Rust.
