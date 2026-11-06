"use client";

/**
 * Onglet "Rôle" — CRUD des TenantRole du tenant.
 *
 * Pilote `/api/tenant/roles` (gardé members:admin / OWNER) :
 *  - POST   { label, color }                 → créer un rôle custom
 *  - PATCH  [id] { label?, color?, perms? }  → renommer / recolorier / dupliquer
 *  - DELETE [id]                             → supprimer (membres → "technicien")
 *
 * Le rôle Propriétaire (`isOwner`) est verrouillé : aucune action.
 */

import { useMemo, useState } from "react";
import { z } from "zod";
import { Copy, Lock, Pencil, Plus, Shield, ShieldCheck, Trash2 } from "@/components/ui/icons";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import type { TenantDomain, TenantLevel, TenantRoleSafe } from "../../_components/types";

// Palette sobre de pastilles proposées à la création / recoloration.
const COLOR_SWATCHES = [
  "#8b5cf6",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#6b7280",
];

const schema = z.object({
  label: z.string().min(1, "Nom requis").max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide"),
});
type FormValues = z.infer<typeof schema>;

type Props = {
  roles: TenantRoleSafe[];
  setRoles: React.Dispatch<React.SetStateAction<TenantRoleSafe[]>>;
};

export function RolesPanel({ roles, setRoles }: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [defaultValues, setDefaultValues] = useState<FormValues>({
    label: "",
    color: COLOR_SWATCHES[0],
  });

  // Rôles éditables (tout sauf Propriétaire).
  const ownerRole = useMemo(() => roles.find((r) => r.isOwner) ?? null, [roles]);
  const otherRoles = useMemo(() => roles.filter((r) => !r.isOwner), [roles]);

  const openCreate = () => {
    setEditId(null);
    setDefaultValues({ label: "", color: COLOR_SWATCHES[0] });
    setOpen(true);
  };

  const openEdit = (role: TenantRoleSafe) => {
    if (role.isOwner) return;
    setEditId(role.id);
    setDefaultValues({ label: role.label, color: role.color });
    setOpen(true);
  };

  const handleSubmit = async (values: FormValues) => {
    if (editId) {
      const updated = await api.patch<TenantRoleSafe>(`/api/tenant/roles/${editId}`, values);
      setRoles((prev) =>
        prev.map((r) =>
          r.id === editId ? { ...r, label: updated.label, color: updated.color } : r,
        ),
      );
    } else {
      const created = await api.post<TenantRoleSafe>(`/api/tenant/roles`, values);
      setRoles((prev) => [...prev, { ...created, memberCount: 0 }]);
    }
  };

  const handleDuplicate = async (role: TenantRoleSafe) => {
    try {
      const created = await api.post<TenantRoleSafe>(`/api/tenant/roles`, {
        label: `${role.label} (copie)`,
        color: role.color,
      });
      // Recopie les permissions du rôle source sur la copie.
      const withPerms = await api.patch<TenantRoleSafe>(`/api/tenant/roles/${created.id}`, {
        permissions: role.permissions,
      });
      setRoles((prev) => [
        ...prev,
        {
          ...created,
          permissions: parsePerms(withPerms.permissions, role.permissions),
          memberCount: 0,
        },
      ]);
      toast.success("Rôle dupliqué");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const handleDelete = async (role: TenantRoleSafe) => {
    if (role.isOwner || role.isBuiltin) return;
    const ok = await confirm({
      title: "Supprimer ce rôle ?",
      description: (
        <>
          <strong>{role.label}</strong> sera supprimé.
          {role.memberCount > 0
            ? ` Les ${role.memberCount} membre(s) concerné(s) repasseront au rôle « Technicien ».`
            : " Aucun membre n'utilise ce rôle."}
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/roles/${role.id}`);
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      toast.success("Rôle supprimé");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const isEmpty = roles.length === 0;

  return (
    <AdminTabLayout>
      {isEmpty ? (
        <EmptyState
          icon={<Shield strokeWidth={1.5} />}
          title="Aucun rôle"
          description="Créez un rôle pour définir des niveaux d'accès par domaine."
          action={
            <EmptyStateAction onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter un rôle
            </EmptyStateAction>
          }
        />
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={openCreate}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <Plus className="h-4 w-4" />
            Ajouter un rôle
          </button>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {ownerRole && <RoleCard role={ownerRole} />}
            {otherRoles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                onEdit={() => openEdit(role)}
                onDuplicate={() => void handleDuplicate(role)}
                onDelete={() => void handleDelete(role)}
              />
            ))}
          </div>
        </div>
      )}

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={editId ? "Modifier le rôle" : "Nouveau rôle"}
        icon={<ShieldCheck className="h-4 w-4 text-[var(--accent)]" />}
        schema={schema}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        submitLabel={editId ? "Enregistrer" : "Créer"}
      >
        {(form) => {
          const color = form.watch("color");
          return (
            <FormSection>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">Nom *</label>
                <input
                  {...form.register("label")}
                  placeholder="Cadreur, Ingénieur du son…"
                  className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
                {form.formState.errors.label && (
                  // arkyo-server: habillage Strata
                  <p className="text-[11px] text-[var(--danger-text)]">
                    {form.formState.errors.label.message as string}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">
                  Couleur
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => form.setValue("color", c, { shouldDirty: true })}
                      className={cn(
                        "h-7 w-7 rounded-full border-2 transition-transform",
                        color?.toLowerCase() === c.toLowerCase()
                          ? "scale-110 border-[var(--foreground)]"
                          : "border-transparent hover:scale-105",
                      )}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={color ?? "#6b7280"}
                    onChange={(e) => form.setValue("color", e.target.value, { shouldDirty: true })}
                    className="h-7 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
                    aria-label="Couleur personnalisée"
                  />
                </div>
              </div>
            </FormSection>
          );
        }}
      </FormDialog>
    </AdminTabLayout>
  );
}

// ── Card d'un rôle ──────────────────────────────────────────────────────────────

function RoleCard({
  role,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  role: TenantRoleSafe;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="group relative flex flex-col gap-2 rounded-xl border bg-[var(--card)] p-3 shadow-sm transition-all hover:shadow-md"
      style={{
        borderTopColor: `${role.color}20`,
        borderRightColor: `${role.color}20`,
        borderBottomColor: `${role.color}20`,
        borderLeftColor: role.color,
        borderLeftWidth: 3,
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: role.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold leading-tight">{role.label}</p>
            {role.isOwner && (
              <Lock className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {role.memberCount} membre{role.memberCount > 1 ? "s" : ""}
            {role.isBuiltin && !role.isOwner ? " · par défaut" : ""}
          </p>
        </div>
        {!role.isOwner && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={onEdit}
              title="Modifier"
              className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              title="Dupliquer"
              className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {!role.isBuiltin && (
              <button
                type="button"
                onClick={onDelete}
                title="Supprimer"
                // arkyo-server: habillage Strata
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const ALL_DOMAINS: TenantDomain[] = ["projects", "design", "catalog", "members", "settings"];

/** Normalise les permissions renvoyées par l'API en Record complet. */
function parsePerms(
  raw: unknown,
  fallback: Record<TenantDomain, TenantLevel>,
): Record<TenantDomain, TenantLevel> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fallback;
  const obj = raw as Record<string, unknown>;
  const result = { ...fallback };
  for (const d of ALL_DOMAINS) {
    const v = obj[d];
    if (v === "none" || v === "read" || v === "write" || v === "admin") result[d] = v;
  }
  return result;
}
