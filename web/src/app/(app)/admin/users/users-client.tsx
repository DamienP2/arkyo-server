"use client";

/**
 * /admin/users — orchestrateur client à 3 onglets dans la topbar :
 *   Liste · Rôle · Permissions
 *
 * Pattern aligné sur `/supervisor/collaborators` :
 *  - `useTopbarTabs` pour les onglets en pill dans la topbar.
 *  - Onglet actif persisté en localStorage (`tenant-admin-users-tab`).
 *  - `roles` est piloté ici (state partagé Rôle ⇄ Permissions ⇄ Liste).
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";

import type { TenantRoleSafe, UserSafe } from "../_components/types";

import { PermissionsPanel } from "./_components/permissions-panel";
import { RolesPanel } from "./_components/roles-panel";
import { UsersListPanel } from "./_components/users-list-panel";

type Section = "list" | "role" | "permissions";

const TABS: { key: Section; label: string }[] = [
  { key: "list", label: "Liste" },
  { key: "role", label: "Rôle" },
  { key: "permissions", label: "Permissions" },
];

const STORAGE_KEY = "tenant-admin-users-tab";

function isSection(v: unknown): v is Section {
  return v === "list" || v === "role" || v === "permissions";
}

export function UsersClient({
  initialUsers,
  initialRoles,
}: {
  initialUsers: UserSafe[];
  initialRoles: TenantRoleSafe[];
}) {
  const [section, setSection] = useLocalStorageState<Section>(STORAGE_KEY, "list", {
    isValid: isSection,
  });
  const [users, setUsers] = useState<UserSafe[]>(initialUsers);
  const [roles, setRoles] = useState<TenantRoleSafe[]>(initialRoles);
  const { setTabs } = useTopbarTabs();
  const searchParams = useSearchParams();

  // Re-sync depuis SSR si les props changent (après `router.refresh()`).
  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);
  useEffect(() => {
    setRoles(initialRoles);
  }, [initialRoles]);

  // Si `?tab=` est présent (redirect compat depuis /admin?s=…) on l'applique.
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (!tabParam) return;
    if (isSection(tabParam)) setSection(tabParam);
  }, [tabParam, setSection]);

  useEffect(() => {
    setTabs(
      <div className="flex items-center gap-0.5 rounded-full bg-[var(--background)] p-0.5">
        {TABS.map((t) => {
          const active = section === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>,
    );
    return () => setTabs(null);
  }, [section, setSection, setTabs]);

  return (
    <>
      {section === "list" && (
        <UsersListPanel users={users} setUsers={setUsers} roles={roles} />
      )}
      {section === "role" && <RolesPanel roles={roles} setRoles={setRoles} />}
      {section === "permissions" && (
        <PermissionsPanel roles={roles} setRoles={setRoles} />
      )}
    </>
  );
}
