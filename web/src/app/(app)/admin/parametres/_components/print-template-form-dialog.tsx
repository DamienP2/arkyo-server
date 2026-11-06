"use client";

/**
 * PrintTemplateFormDialog — création / édition basique d'un TenantPrintTemplate
 * (cartouche d'impression personnel).
 *
 * Saisie minimale : nom, clé (auto-générée depuis le nom), description, format,
 * orientation. Pas de slots variables (le layout WYSIWYG dans PrintLayoutEditor
 * suffit). La création bascule directement le parent dans l'éditeur fullscreen
 * (cf. `onSaved(created)`).
 *
 * Validation temps réel :
 *   - Nom : unique (case-insensitive) parmi les cartouches existants
 *   - Clé : unique (exacte) parmi les cartouches existants
 *
 * Conventions DA Arkyo :
 *   - bordures `border/60`, pas de gradients
 *   - mono pour la clé, sobriété pour le reste
 */

import { useMemo, useRef } from "react";
import { FileText, Trash2 } from "@/components/ui/icons";
import { z } from "zod";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import type { TenantPrintTemplateItem } from "./print-panel";

// ── Constantes ─────────────────────────────────────────────────────────────

export const PAPER_FORMATS = [
  "A4",
  "A3",
  "A2",
  "A1",
  "A0",
  "LETTER",
  "LEGAL",
] as const;

export const ORIENTATIONS = ["PORTRAIT", "LANDSCAPE"] as const;

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
  paperFormat: z.enum(PAPER_FORMATS),
  orientation: z.enum(ORIENTATIONS),
});

type FormValues = z.infer<typeof schema>;

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantPrintTemplateItem | null;
  /** Cartouches existants pour la validation temps réel (nom + clé uniques). */
  existingTemplates: TenantPrintTemplateItem[];
  /**
   * Appelé après save réussi. Le parent reçoit le template créé (création
   * uniquement) pour pouvoir l'ouvrir directement dans l'éditeur fullscreen.
   * En édition, le paramètre est `undefined`.
   */
  onSaved: (created?: TenantPrintTemplateItem) => void;
  onDeleted?: () => void;
};

export function PrintTemplateFormDialog({
  open,
  onOpenChange,
  editing,
  existingTemplates,
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
      paperFormat:
        (editing?.paperFormat as (typeof PAPER_FORMATS)[number]) ?? "A3",
      orientation:
        (editing?.orientation as (typeof ORIENTATIONS)[number]) ?? "LANDSCAPE",
    }),
    [editing],
  );

  const handleSubmit = async (values: FormValues) => {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      paperFormat: values.paperFormat,
      orientation: values.orientation,
      slots: [],
    };

    try {
      if (editing) {
        await api.patch(
          `/api/tenant/parametres/print/templates/${editing.id}`,
          payload,
        );
        toast.success("Cartouche modifié.");
        onSaved();
      } else {
        const created = await api.post<TenantPrintTemplateItem>(
          "/api/tenant/parametres/print",
          {
            key: values.key.trim(),
            ...payload,
          },
        );
        toast.success("Cartouche créé.");
        onSaved(created);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        throw new Error(
          body?.error ?? "Un cartouche avec cette clé existe déjà.",
        );
      }
      throw new Error(getApiErrorMessage(e, "Échec de l'enregistrement."));
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer ce cartouche ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimé définitivement.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/print/templates/${editing.id}`);
      toast.success("Cartouche supprimé.");
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
      icon={<FileText />}
      eyebrow="CARTOUCHE"
      title={editing ? "Modifier le cartouche" : "Nouveau cartouche"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Enregistrer" : "Créer et éditer"}
      size="md"
    >
      {(form) => {
        const nameValue = form.watch("name");
        const keyValue = form.watch("key");

        // Vérif d'unicité temps réel (case-insensitive sur le nom, exact sur la clé).
        const others = editing
          ? existingTemplates.filter((t) => t.id !== editing.id)
          : existingTemplates;
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
                placeholder="Standard, Compact, Cartouche client…"
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
                  Un cartouche porte déjà ce nom.
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
                placeholder="STANDARD"
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
                placeholder="À quoi sert ce cartouche, dans quel contexte est-il imprimé…"
                className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>

            <div className="grid grid-cols-2 gap-3">
              <FormSection title="Format d'export par défaut">
                <select
                  {...form.register("paperFormat")}
                  className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                >
                  {PAPER_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </FormSection>
              <FormSection title="Orientation">
                <select
                  {...form.register("orientation")}
                  className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                >
                  <option value="LANDSCAPE">Paysage</option>
                  <option value="PORTRAIT">Portrait</option>
                </select>
              </FormSection>
            </div>

            {editing && (
              <div className="border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  onClick={handleDelete}
                  // arkyo-server: habillage Strata
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer ce cartouche
                </button>
              </div>
            )}
          </div>
        );
      }}
    </FormDialog>
  );
}
