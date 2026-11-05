"use client";

/**
 * Onglet "Utilisateurs / Liste" — gestion des MEMBRES du tenant par invitation.
 * Pilote `/api/tenant/members` (scopé tenant, gardé members:admin / OWNER) :
 *  - POST   { email, roleKey }        → inviter un membre
 *  - PATCH  [membershipId]{ roleKey } → changer le rôle
 *  - DELETE [membershipId]            → révoquer
 * Les ids manipulés sont des `membershipId` (pas des user id globaux).
 *
 * Le picker de rôle liste les `TenantRole` du tenant (source de vérité `roleKey`),
 * plus l'enum figé. Le rôle Propriétaire (owner) n'est ni assignable ni éditable.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Plus, Trash2, Pencil, Search, Users as UsersIcon, ShieldCheck } from "@/components/ui/icons";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { AdminListToolbar, type ChipFilter } from "./admin-list-toolbar";
import type { AdminView, TenantRoleSafe, UserSafe } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Mapping enum (compat) → clé de TenantRole built-in.

const ENUM_TO_KEY: Record<UserSafe["role"], string> = {
  OWNER: "owner",
  ADMIN: "technicien",
  CHEF_PROJET: "chef-projet",
  TECHNICIEN: "technicien",
  CONSULTATION: "consultation",
};

/** Résout la clé de rôle effective d'un membre (source de vérité `roleKey`). */
function effectiveKey(u: UserSafe): string {
  return u.roleKey ?? ENUM_TO_KEY[u.role];
}

function isOwnerMember(u: UserSafe): boolean {
  return u.role === "OWNER" || effectiveKey(u) === "owner";
}

// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  email: z.string().email("Email invalide"),
  roleKey: z.string().min(1, "Rôle requis"),
});
type FormValues = z.infer<typeof schema>;

type Props = {
  view: AdminView;
  users: UserSafe[];
  setUsers: React.Dispatch<React.SetStateAction<UserSafe[]>>;
  roles: TenantRoleSafe[];
};

type FilterPending = "all" | "active" | "pending";

// ─────────────────────────────────────────────────────────────────────────────
// Avatar initiales

function Avatar({ user, color, size = 36 }: { user: UserSafe; color: string; size?: number }) {
  const base = user.name ?? user.email;
  const initials = base
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        background: `${color}20`,
        color,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function UsersListTab({ view, users, setUsers, roles }: Props) {
  const confirm = useConfirm();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all"); // "all" ou une roleKey
  const [filterPending, setFilterPending] = useState<FilterPending>("all");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState<string>("");
  const [defaultValues, setDefaultValues] = useState<FormValues>({ email: "", roleKey: "" });

  // Lookup rôle par clé + rôles assignables (tout sauf owner).
  const roleByKey = useMemo(() => {
    const m: Record<string, TenantRoleSafe> = {};
    for (const r of roles) m[r.key] = r;
    return m;
  }, [roles]);

  const assignableRoles = useMemo(() => roles.filter((r) => !r.isOwner), [roles]);
  const defaultRoleKey = useMemo(
    () => assignableRoles.find((r) => r.key === "technicien")?.key ?? assignableRoles[0]?.key ?? "",
    [assignableRoles],
  );

  const roleMeta = (key: string): { label: string; color: string } => {
    const r = roleByKey[key];
    return { label: r?.label ?? key, color: r?.color ?? "#94a3b8" };
  };

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (
        search &&
        !u.email.toLowerCase().includes(search.toLowerCase()) &&
        !(u.name ?? "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (filterRole !== "all" && effectiveKey(u) !== filterRole) return false;
      if (filterPending === "active" && u.isPending) return false;
      if (filterPending === "pending" && !u.isPending) return false;
      return true;
    });
  }, [users, search, filterRole, filterPending]);

  // Group by clé de rôle, ordonné selon `roles` (owner → builtin → custom).
  const grouped = useMemo(() => {
    const m: Record<string, UserSafe[]> = {};
    for (const u of filtered) (m[effectiveKey(u)] ??= []).push(u);
    return m;
  }, [filtered]);

  const orderedKeys = useMemo(() => {
    const known = roles.map((r) => r.key).filter((k) => grouped[k]?.length);
    const extras = Object.keys(grouped).filter((k) => !roles.some((r) => r.key === k));
    return [...known, ...extras];
  }, [roles, grouped]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const openInvite = () => {
    setEditId(null);
    setEditEmail("");
    setDefaultValues({ email: "", roleKey: defaultRoleKey });
    setOpen(true);
  };

  const openEdit = (user: UserSafe) => {
    if (isOwnerMember(user)) return; // OWNER non éditable ici.
    setEditId(user.membershipId);
    setEditEmail(user.email);
    setDefaultValues({ email: user.email, roleKey: effectiveKey(user) });
    setOpen(true);
  };

  const handleSubmit = async (values: FormValues) => {
    if (editId) {
      await api.patch(`/api/tenant/members/${editId}`, { roleKey: values.roleKey });
      setUsers((prev) =>
        prev.map((u) =>
          u.membershipId === editId ? { ...u, roleKey: values.roleKey } : u,
        ),
      );
    } else {
      await api.post(`/api/tenant/members`, { email: values.email, roleKey: values.roleKey });
      // Le membre invité peut être un nouvel user (pending) → on recharge le SSR.
      router.refresh();
    }
  };

  const handleDelete = async (user: UserSafe) => {
    if (isOwnerMember(user)) return;
    const ok = await confirm({
      title: user.isPending ? "Annuler cette invitation ?" : "Révoquer ce membre ?",
      description: (
        <>
          <strong>{user.name ?? user.email}</strong>
          {user.isPending
            ? " ne pourra plus rejoindre cet espace avec cette invitation."
            : " perdra l'accès à cet espace. Cette action est réversible (ré-invitation)."}
        </>
      ),
      confirmLabel: user.isPending ? "Annuler l'invitation" : "Révoquer",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/api/tenant/members/${user.membershipId}`);
    setUsers((prev) => prev.filter((u) => u.membershipId !== user.membershipId));
  };

  const activeFilters =
    (search ? 1 : 0) + (filterRole !== "all" ? 1 : 0) + (filterPending !== "all" ? 1 : 0);

  const resetFilters = () => {
    setSearch("");
    setFilterRole("all");
    setFilterPending("all");
  };

  // ─── Rendu ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-5">
        {/* Empty state — aucun membre */}
        {users.length === 0 && (
          <EmptyState
            icon={<UsersIcon strokeWidth={1.5} />}
            title="Aucun membre"
            description="Invitez votre équipe à rejoindre cet espace."
            action={
              <EmptyStateAction onClick={openInvite}>
                <Plus className="h-3.5 w-3.5" />
                Inviter un membre
              </EmptyStateAction>
            }
          />
        )}

        {/* Toolbar filtres */}
        {users.length > 0 &&
          (() => {
            const chips: ChipFilter[] = [
              {
                id: "role-all",
                label: "Tous",
                active: filterRole === "all",
                onClick: () => setFilterRole("all"),
              },
              ...roles.map((r) => ({
                id: `role-${r.key}`,
                label: r.label,
                active: filterRole === r.key,
                onClick: () => setFilterRole(filterRole === r.key ? "all" : r.key),
              })),
              {
                id: "pending-pending",
                label: "En attente",
                active: filterPending === "pending",
                onClick: () => setFilterPending(filterPending === "pending" ? "all" : "pending"),
              },
            ];
            return (
              <AdminListToolbar
                search={search}
                onSearchChange={setSearch}
                placeholder="Nom, email…"
                count={filtered.length}
                total={users.length}
                chips={chips}
                filterCount={activeFilters}
                onClearFilters={resetFilters}
              />
            );
          })()}

        {/* Résultat vide après filtres */}
        {users.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun membre pour ces filtres"
            description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
            action={
              <button onClick={resetFilters} className="text-xs text-[var(--accent)] hover:underline">
                Réinitialiser les filtres
              </button>
            }
            className="py-16"
          />
        )}

        {users.length > 0 && filtered.length > 0 && (
          <div className="space-y-7">
            {/* Inline invite */}
            {view === "grid" ? (
              <button
                onClick={openInvite}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                style={{ minHeight: 72 }}
              >
                <Plus className="h-5 w-5" />
                <span className="text-xs font-medium">Inviter un membre</span>
              </button>
            ) : (
              <button
                onClick={openInvite}
                className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Inviter un membre</span>
              </button>
            )}

            {orderedKeys.map((key) => {
              const items = grouped[key] ?? [];
              const meta = roleMeta(key);
              const color = meta.color;
              const groupIsOwner = key === "owner";
              return (
                <div key={key}>
                  {/* Header groupe rôle */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <h3 className="text-xs font-bold tracking-widest uppercase" style={{ color }}>
                      {meta.label}
                    </h3>
                    <div className="h-px flex-1" style={{ backgroundColor: `${color}30` }} />
                    <span className="text-xs text-[var(--muted-foreground)]">{items.length}</span>
                  </div>

                  {view === "grid" ? (
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
                    >
                      {items.map((u) => (
                        <div
                          key={u.membershipId}
                          onClick={() => openEdit(u)}
                          className={cn(
                            "group relative flex items-center gap-3 rounded-xl border bg-[var(--card)] p-3 transition-colors",
                            groupIsOwner ? "cursor-default" : "cursor-pointer hover:bg-[var(--secondary)]",
                            u.isPending && "opacity-70",
                          )}
                          style={{
                            borderTopColor: `${color}15`,
                            borderRightColor: `${color}15`,
                            borderBottomColor: `${color}15`,
                            borderLeftColor: color,
                            borderLeftWidth: 3,
                          }}
                        >
                          <Avatar user={u} color={color} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold">{u.name ?? "—"}</p>
                              {u.isPending && (
                                <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                                  EN ATTENTE
                                </span>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                              {u.email}
                            </p>
                          </div>
                          {!groupIsOwner && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(u);
                                }}
                                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                                title="Changer le rôle"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(u);
                                }}
                                // arkyo-server: habillage Strata
                                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                                title={u.isPending ? "Annuler l'invitation" : "Révoquer"}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {items.map((u) => (
                        <div
                          key={u.membershipId}
                          onClick={() => openEdit(u)}
                          className={cn(
                            "group flex items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors",
                            groupIsOwner ? "cursor-default" : "cursor-pointer hover:bg-[var(--secondary)]",
                            u.isPending && "opacity-70",
                          )}
                          style={{
                            borderTopColor: `${color}20`,
                            borderRightColor: `${color}20`,
                            borderBottomColor: `${color}20`,
                            borderLeftColor: color,
                            borderLeftWidth: 3,
                          }}
                        >
                          <Avatar user={u} color={color} size={26} />
                          <p className="flex-1 truncate text-xs font-semibold">{u.name ?? "—"}</p>
                          <span className="hidden max-w-[220px] shrink-0 truncate text-[10px] text-[var(--muted-foreground)] sm:block">
                            {u.email}
                          </span>
                          {u.isPending && (
                            <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              EN ATTENTE
                            </span>
                          )}
                          {!groupIsOwner && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(u);
                                }}
                                className="rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                                title="Changer le rôle"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(u);
                                }}
                                // arkyo-server: habillage Strata
                                className="rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                                title={u.isPending ? "Annuler l'invitation" : "Révoquer"}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={editId ? "Changer le rôle" : "Inviter un membre"}
        description={
          editId
            ? "Modifiez le rôle de ce membre dans l'espace."
            : "Envoyez une invitation par email à rejoindre cet espace."
        }
        icon={<ShieldCheck className="h-4 w-4 text-[var(--accent)]" />}
        schema={schema}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        submitLabel={editId ? "Enregistrer" : "Inviter"}
      >
        {({ register, formState: { errors } }) => (
          <FormSection>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Email *</label>
              <input
                {...register("email")}
                type="email"
                disabled={!!editId}
                placeholder="membre@exemple.com"
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
              />
              {editId && <p className="text-[11px] text-[var(--muted-foreground)]">{editEmail}</p>}
              {errors.email && (
                <p className="text-[11px] text-[var(--destructive)]">
                  {errors.email.message as string}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Rôle *</label>
              <select
                {...register("roleKey")}
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                {assignableRoles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              {errors.roleKey && (
                <p className="text-[11px] text-[var(--destructive)]">
                  {errors.roleKey.message as string}
                </p>
              )}
            </div>
          </FormSection>
        )}
      </FormDialog>
    </>
  );
}
