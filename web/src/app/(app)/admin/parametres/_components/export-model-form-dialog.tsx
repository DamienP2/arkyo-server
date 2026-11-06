"use client";

/**
 * ExportModelFormDialog — création / édition basique d'un TenantPrintExportModel
 * (modèle d'export PDF).
 *
 * Calqué sur `PrintTemplateFormDialog` mais SANS les champs paperFormat /
 * orientation : tous les modèles d'export sont figés en A4 portrait.
 *
 * Saisie minimale : nom, clé (auto-générée depuis le nom), description. La
 * création bascule directement le parent dans l'éditeur fullscreen
 * (cf. `onSaved(created)`).
 *
 * Validation temps réel :
 *   - Nom : unique (case-insensitive) parmi les modèles existants
 *   - Clé : unique (exacte) parmi les modèles existants
 */

import { useMemo, useRef } from "react";
import { FileStack, Trash2 } from "@/components/ui/icons";
import { z } from "zod";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import type { ExportModel } from "./export-pdf-section";

// ── Helpers ────────────────────────────────────────────────────────────────

function nameToKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ── Schéma ─────────────────────────────────────────────────────────────────

const schema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "La clé est requise.")
    .max(50, "Clé trop longue (50 max).")
    .regex(/^[A-Z0-9_]+$/, "Lettres majuscules, chiffres ou underscore."),
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  description: z.string().trim().max(500),
});

type FormValues = z.infer<typeof schema>;

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ExportModel | null;
  /** Modèles existants pour la validation temps réel (nom + clé uniques). */
  existingModels: ExportModel[];
  /** Base API : ex "/api/tenant/parametres/print/export-models". */
  apiBase: string;
  /**
   * Appelé après save réussi. Le parent reçoit le modèle créé (création
   * uniquement) pour pouvoir l'ouvrir directement dans l'éditeur fullscreen.
   * En édition, le paramètre est `undefined`.
   */
  onSaved: (created?: ExportModel) => void;
  onDeleted?: () => void;
};

export function ExportModelFormDialog({
  open,
  onOpenChange,
  editing,
  existingModels,
  apiBase,
  onSaved,
  onDeleted,
}: Props) {
  const confirm = useConfirm();
  const toast = useToast();

  // True dès que l'utilisateur a édité la clé manuellement → on arrête
  // l'auto-génération depuis le nom. Reset à chaque ouverture du dialog.
  const keyTouchedRef = useRef(false);

  const defaultValues = useMemo<FormValues>(
    () => ({
      key: editing?.key ?? "",
      name: editing?.name ?? "",
      description: editing?.description ?? "",
    }),
    [editing],
  );

  const handleSubmit = async (values: FormValues) => {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || null,
    };

    try {
      if (editing) {
        await api.patch(`${apiBase}/${editing.id}`, payload);
        toast.success("Modèle d'export modifié.");
        onSaved();
      } else {
        const created = await api.post<ExportModel>(apiBase, {
          key: values.key.trim(),
          ...payload,
        });
        toast.success("Modèle d'export créé.");
        onSaved(created);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        throw new Error(
          body?.error ?? "Un modèle avec cette clé existe déjà.",
        );
      }
      throw new Error(getApiErrorMessage(e, "Échec de l'enregistrement."));
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer ce modèle d'export ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimé définitivement avec
          ses trois pages (couverture, intérieur, fin).
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`${apiBase}/${editing.id}`);
      toast.success("Modèle d'export supprimé.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  return (
    <FormDialog<FormValues>
      open={open}
      onOpenChange={(o) => {
        if (o) keyTouchedRef.current = !!editing; // édition = clé touchée d'office
        onOpenChange(o);
      }}
      icon={<FileStack />}
      eyebrow="MODÈLE D'EXPORT"
      title={editing ? "Modifier le modèle d'export" : "Nouveau modèle d'export"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Enregistrer" : "Créer et éditer"}
      size="md"
    >
      {(form) => {
        const nameValue = form.watch("name");
        const keyValue = form.watch("key");

        const others = editing
          ? existingModels.filter((t) => t.id !== editing.id)
          : existingModels;
        const nameTaken =
          nameValue.trim().length > 0 &&
          others.some(
            (t) => t.name.trim().toLowerCase() === nameValue.trim().toLowerCase(),
          );
        const keyTaken =
          keyValue.trim().length > 0 &&
          others.some((t) => t.key === keyValue.trim());

        return (
          <div className="space-y-4">
            <FormSection title="Nom *">
              <input
                autoFocus
                {...form.register("name", {
                  onChange: (e) => {
                    const v: string = e.target.value;
                    form.setValue("name", v, { shouldValidate: true });
                    if (!keyTouchedRef.current && !editing) {
                      form.setValue("key", nameToKey(v), {
                        shouldValidate: true,
                      });
                    }
                  },
                })}
                placeholder="Synoptique client, Inventaire technique, PV de recette…"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
              {form.formState.errors.name && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-xs text-[var(--danger-text)]">
                  {form.formState.errors.name.message}
                </p>
              )}
              {!form.formState.errors.name && nameTaken && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-xs text-[var(--danger-text)]">
                  Un modèle porte déjà ce nom.
                </p>
              )}
            </FormSection>

            <FormSection title={editing ? "Clé" : "Clé *"}>
              <input
                {...form.register("key", {
                  onChange: (e) => {
                    keyTouchedRef.current = true;
                    const v = e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_]/g, "");
                    form.setValue("key", v, { shouldValidate: true });
                  },
                })}
                placeholder="SYNOPTIQUE_CLIENT"
                readOnly={!!editing}
                className={cn(
                  "flex h-10 w-full rounded-lg border border-[var(--border)]/60 bg-transparent px-3 font-mono text-sm uppercase",
                  !editing &&
                    "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  editing && "opacity-60",
                )}
              />
              {form.formState.errors.key && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-xs text-[var(--danger-text)]">
                  {form.formState.errors.key.message}
                </p>
              )}
              {!form.formState.errors.key && !editing && keyTaken && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-xs text-[var(--danger-text)]">
                  Cette clé est déjà utilisée.
                </p>
              )}
              {editing && (
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)] italic">
                  La clé n'est pas modifiable.
                </p>
              )}
            </FormSection>

            <FormSection title="Description">
              <textarea
                {...form.register("description")}
                rows={3}
                placeholder="À quoi sert ce modèle d'export, dans quel contexte est-il utilisé…"
                className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            {editing && (
              <div className="border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  onClick={handleDelete}
                  // arkyo-server: habillage Strata
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer ce modèle
                </button>
              </div>
            )}
          </div>
        );
      }}
    </FormDialog>
  );
}
