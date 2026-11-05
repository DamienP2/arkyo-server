"use client";

/**
 * Onglet "Permissions" — matrice éditable des droits par rôle.
 *
 * Lignes = 5 domaines, colonnes = rôles du tenant (Propriétaire d'abord).
 * Chaque cellule = niveau (none → read → write → admin) ; clic = cycle suivant.
 * Mutation optimiste + rollback via `PATCH /api/tenant/roles/[id] { permissions }`.
 * La colonne Propriétaire est verrouillée (admin partout, non cliquable).
 */

import { useState } from "react";
import { Lock, Shield } from "@/components/ui/icons";

import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import type { TenantDomain, TenantLevel, TenantRoleSafe } from "../../_components/types";

type Props = {
  roles: TenantRoleSafe[];
  setRoles: React.Dispatch<React.SetStateAction<TenantRoleSafe[]>>;
};

const DOMAINS: { key: TenantDomain; label: string; hint?: string }[] = [
  { key: "projects", label: "Projets" },
  { key: "design", label: "Conception", hint: "régies, racks, synoptique" },
  { key: "catalog", label: "Catalogue" },
  { key: "members", label: "Membres & rôles" },
  { key: "settings", label: "Paramètres & espace" },
];

const LEVEL_ORDER: TenantLevel[] = ["none", "read", "write", "admin"];

const LEVEL_STYLES: Record<TenantLevel, { bg: string; color: string; label: string }> = {
  none: { bg: "transparent", color: "var(--muted-foreground)", label: "Aucun" },
  read: { bg: "#94a3b820", color: "#64748b", label: "Lecture" },
  write: { bg: "#22c55e20", color: "#16a34a", label: "Écriture" },
  admin: { bg: "#ef444420", color: "#dc2626", label: "Admin" },
};

function nextLevel(level: TenantLevel): TenantLevel {
  const i = LEVEL_ORDER.indexOf(level);
  return LEVEL_ORDER[(i + 1) % LEVEL_ORDER.length];
}

export function PermissionsPanel({ roles, setRoles }: Props) {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const cycle = async (role: TenantRoleSafe, domain: TenantDomain) => {
    if (role.isOwner) return;
    const cellId = `${role.id}:${domain}`;
    if (pending) return;

    const current = role.permissions[domain] ?? "none";
    const next = nextLevel(current);

    // Optimiste
    setRoleLevel(setRoles, role.id, domain, next);
    setPending(cellId);

    try {
      await api.patch(`/api/tenant/roles/${role.id}`, {
        permissions: { [domain]: next },
      });
    } catch (e) {
      // Rollback
      setRoleLevel(setRoles, role.id, domain, current);
      toast.error(getApiErrorMessage(e));
    } finally {
      setPending(null);
    }
  };

  if (roles.length === 0) {
    return (
      <AdminTabLayout>
        <EmptyState
          icon={<Shield strokeWidth={1.5} />}
          title="Aucun rôle"
          description="Créez d'abord des rôles dans l'onglet Rôle pour définir leurs permissions."
        />
      </AdminTabLayout>
    );
  }

  const gridCols = `minmax(180px, 1.4fr) repeat(${roles.length}, minmax(112px, 1fr))`;

  return (
    <AdminTabLayout>
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <div className="min-w-max">
            {/* Header — rôles */}
            <div
              className="grid items-center bg-[var(--secondary)] px-4 py-3 text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span>Domaine</span>
              {roles.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center justify-center gap-1.5 px-1 text-center"
                  style={{ color: r.color }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="truncate normal-case">{r.label}</span>
                  {r.isOwner && <Lock className="h-3 w-3 shrink-0" />}
                </span>
              ))}
            </div>

            {/* Body — domaines */}
            {DOMAINS.map((d) => (
              <div
                key={d.key}
                className="grid items-center border-t border-[var(--border)] px-4 py-1.5 transition-colors hover:bg-[var(--secondary)]/30"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="min-w-0 pr-2">
                  <p className="truncate text-xs font-medium">{d.label}</p>
                  {d.hint && (
                    <p className="truncate text-[10px] text-[var(--muted-foreground)]">{d.hint}</p>
                  )}
                </div>
                {roles.map((r) => {
                  const level = r.isOwner ? "admin" : r.permissions[d.key] ?? "none";
                  const style = LEVEL_STYLES[level];
                  const cellId = `${r.id}:${d.key}`;
                  const isPending = pending === cellId;
                  return (
                    <div key={r.id} className="flex items-center justify-center px-1 py-0.5">
                      <button
                        type="button"
                        disabled={r.isOwner || isPending}
                        onClick={() => void cycle(r, d.key)}
                        title={
                          r.isOwner
                            ? "Propriétaire — accès total verrouillé"
                            : `${style.label} — cliquer pour changer`
                        }
                        className={cn(
                          "inline-flex h-7 min-w-[72px] items-center justify-center gap-1 rounded-md px-2 text-[10px] font-bold transition-opacity",
                          r.isOwner ? "cursor-default" : "cursor-pointer hover:opacity-80",
                          isPending && "opacity-50",
                        )}
                        style={{
                          background: style.bg,
                          color: style.color,
                          border: level === "none" ? "1px dashed var(--border)" : "none",
                        }}
                      >
                        {r.isOwner && <Lock className="h-2.5 w-2.5" />}
                        {style.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Légende */}
        <div className="flex flex-wrap items-center gap-3 px-1">
          <span className="text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
            Légende
          </span>
          <div className="h-3 w-px bg-[var(--border)]" />
          {LEVEL_ORDER.map((lvl) => {
            const s = LEVEL_STYLES[lvl];
            return (
              <span
                key={lvl}
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold"
                style={{
                  background: s.bg,
                  color: s.color,
                  border: lvl === "none" ? "1px dashed var(--border)" : "none",
                }}
              >
                {s.label}
              </span>
            );
          })}
        </div>
      </div>
    </AdminTabLayout>
  );
}

// ── Helper — applique un niveau sur un rôle dans le state ─────────────────────────

function setRoleLevel(
  setRoles: React.Dispatch<React.SetStateAction<TenantRoleSafe[]>>,
  roleId: string,
  domain: TenantDomain,
  level: TenantLevel,
) {
  setRoles((prev) =>
    prev.map((r) =>
      r.id === roleId ? { ...r, permissions: { ...r.permissions, [domain]: level } } : r,
    ),
  );
}
