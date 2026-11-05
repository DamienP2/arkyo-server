"use client";

/**
 * UsersListPanel — onglet "Liste" du `/admin/users`.
 *
 * Wrapper léger autour de `UsersListTab` (logique CRUD des membres). On lui
 * passe le state local + setters + les rôles du tenant (pour le picker et le
 * groupement), et l'enveloppe `AdminTabLayout` pour le padding standard.
 *
 * Pattern grid/list persisté localement via `useLocalStorageState`.
 */

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import { UsersListTab } from "../../_components/users-list-tab";
import type { AdminView, TenantRoleSafe, UserSafe } from "../../_components/types";

type Props = {
  users: UserSafe[];
  setUsers: React.Dispatch<React.SetStateAction<UserSafe[]>>;
  roles: TenantRoleSafe[];
};

const VIEW_KEY = "tenant-admin-users-list-view";

function isView(v: unknown): v is AdminView {
  return v === "grid" || v === "list";
}

export function UsersListPanel({ users, setUsers, roles }: Props) {
  const [view] = useLocalStorageState<AdminView>(VIEW_KEY, "grid", { isValid: isView });

  return (
    <AdminTabLayout>
      <UsersListTab view={view} users={users} setUsers={setUsers} roles={roles} />
    </AdminTabLayout>
  );
}
