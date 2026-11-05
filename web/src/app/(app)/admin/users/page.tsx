import { Suspense } from "react";

// arkyo-server: `mainDb` / `requireTenantPermissionPage` (serveur) remplacés
// par `ClientPage` (contexte de permissions) et l'API.
import { ClientPage } from "@/components/client-page";
import { Users } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { ALL_DOMAINS, ALL_LEVELS } from "@/lib/tenant-permissions";
import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";

import type { TenantRoleSafe, UserSafe } from "../_components/types";
import { UsersClient } from "./users-client";

/**
 * /admin/users — page Utilisateurs du tenant.
 *
 * Server component mince qui :
 *  1. Vérifie le niveau `members:admin` (OWNER bypass via le résolveur RBAC).
 *  2. Charge les memberships + les TenantRole du tenant (main DB).
 *  3. Délègue à `UsersClient` qui pousse 3 onglets dans la topbar
 *     (Liste · Rôle · Permissions).
 *
 * arkyo-server: SPA sans SSR — le Server Component devient un composant client.
 * La garde `members:admin` lit le contexte de permissions (redirection vers
 * `/dashboard` comme `requireTenantPermissionPage`) ; membres et rôles viennent
 * de `GET /api/tenant/members` et `GET /api/tenant/roles` (mêmes formes que les
 * requêtes Prisma d'arkyo), avec `<LoadingState>` pendant le chargement et une
 * erreur avec « Réessayer » si la lecture échoue (`ClientPage`).
 * `router.refresh()` (après une invitation, ou un évènement temps réel) relit
 * les deux listes sans démonter la page.
 */

const SAFE_PERMS: Record<TenantDomain, TenantLevel> = {
  projects: "none",
  design: "none",
  catalog: "none",
  members: "none",
  settings: "none",
};

/** Parse les permissions JSON brutes en Record typé (défense en profondeur). */
function parsePermissions(raw: unknown): Record<TenantDomain, TenantLevel> {
  const result = { ...SAFE_PERMS };
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

// arkyo-server: formes de `GET /api/tenant/members` et `GET /api/tenant/roles`.
type MemberRow = {
  id: string;
  membershipId: string;
  email: string;
  name: string | null;
  role: UserSafe["role"];
  roleKey: string | null;
  isActive: boolean;
  isPending: boolean;
  createdAt: string;
  user: { id: string; email: string; name: string | null; isActive: boolean; createdAt: string } | null;
};
type RoleRow = Omit<TenantRoleSafe, "permissions"> & { permissions: unknown };

type Loaded = { users: UserSafe[]; roles: TenantRoleSafe[] };

const MEMBERS_ADMIN = ["members", "admin"] as const;

async function load(): Promise<Loaded> {
  const [memberships, rolesRaw] = await Promise.all([
    api.get<MemberRow[]>("/api/tenant/members"),
    api.get<RoleRow[]>("/api/tenant/roles"),
  ]);

  const roles: TenantRoleSafe[] = rolesRaw.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    color: r.color,
    isOwner: r.isOwner,
    isBuiltin: r.isBuiltin,
    permissions: parsePermissions(r.permissions),
    memberCount: r.memberCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  // Tous les membres, y compris les invitations en attente (pas encore de user).
  // arkyo-server: comptes locaux, jamais en attente (`isPending: false`).
  const users: UserSafe[] = memberships.map((m) => ({
    id: m.user?.id ?? m.id,
    membershipId: m.membershipId,
    email: m.user?.email ?? m.email ?? "—",
    name: m.user?.name ?? null,
    role: m.role,
    roleKey: m.roleKey,
    isActive: m.isActive && (m.user?.isActive ?? true),
    isPending: m.isPending,
    createdAt: new Date(m.user?.createdAt ?? m.createdAt),
  }));

  return { users, roles };
}

export default function AdminUsersPage() {
  // Réservé aux membres avec le niveau `members:admin` (OWNER bypass).
  // arkyo-server: garde, chargement et rechargement par `ClientPage`.
  return (
    <ClientPage
      permission={MEMBERS_ADMIN}
      icon={<Users strokeWidth={1.5} />}
      fallbackError="Impossible de charger les membres."
      load={load}
    >
      {({ users, roles }) => (
        <Suspense>
          <UsersClient initialUsers={users} initialRoles={roles} />
        </Suspense>
      )}
    </ClientPage>
  );
}
