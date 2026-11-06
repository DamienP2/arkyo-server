"use client";

/**
 * PhaseFormDialog — modale create/edit partagée pour CatalogPhase
 * (supervisor) et TenantPhase (tenant).
 *
 * Vérification anti-doublon temps réel :
 *  - le parent passe `existingLabels` / `existingKeys` (liste case-insensitive
 *    de libellés/clés déjà pris ailleurs — typiquement catalogue Arkyo côté
 *    tenant). Dès la saisie, un message d'erreur s'affiche sous le champ et
 *    le bouton de soumission est désactivé.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, Trash2 } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";

import { toScreamingSnake } from "./function-form-dialog";

const schema = z.object({
  label: z.string().trim().min(1, "Le libellé est requis.").max(100),
  key: z
    .string()
    .trim()
    .min(1, "La clé est requise.")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Lettres majuscules, chiffres ou underscore."),
});

export type PhaseFormValues = z.infer<typeof schema>;

export type PhaseFormInitial = {
  id?: string;
  label?: string;
  key?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: PhaseFormInitial | null;
  /** Libellés déjà pris (case-insensitive). Affiche une erreur inline en temps réel. */
  existingLabels?: string[];
  /** Clés déjà prises (case-insensitive). Affiche une erreur inline en temps réel. */
  existingKeys?: string[];
  onSubmit: (values: PhaseFormValues) => Promise<void>;
  onDelete?: () => void;
  deleteLabel?: string;
};

export function PhaseFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  existingLabels,
  existingKeys,
  onSubmit,
  onDelete,
  deleteLabel = "Supprimer cette phase",
}: Props) {
  const defaultValues = useMemo<PhaseFormValues>(
    () => ({
      label: initial?.label ?? "",
      key: initial?.key ?? "",
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  const [hasConflict, setHasConflict] = useState(false);
  useEffect(() => {
    if (!open) setHasConflict(false);
  }, [open]);

  return (
    <FormDialog<PhaseFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Layers />}
      eyebrow="PHASE"
      title={isEdit ? "Modifier la phase" : "Nouvelle phase"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer la phase"}
      submitDisabled={hasConflict}
      size="md"
    >
      {(form) => (
        <PhaseFormBody
          form={form}
          open={open}
          isEdit={isEdit}
          initialId={initial?.id}
          existingLabels={existingLabels}
          existingKeys={existingKeys}
          onConflictChange={setHasConflict}
          onDelete={onDelete}
          deleteLabel={deleteLabel}
        />
      )}
    </FormDialog>
  );
}

// ── Body extrait pour permettre l'utilisation propre de hooks ────────────────

type BodyProps = {
  form: UseFormReturn<PhaseFormValues>;
  open: boolean;
  isEdit: boolean;
  initialId: string | undefined;
  existingLabels: string[] | undefined;
  existingKeys: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  onDelete: (() => void) | undefined;
  deleteLabel: string;
};

function PhaseFormBody({
  form,
  open,
  isEdit,
  initialId,
  existingLabels,
  existingKeys,
  onConflictChange,
  onDelete,
  deleteLabel,
}: BodyProps) {
  const labelConflictSet = useMemo(
    () => new Set((existingLabels ?? []).map((l) => l.trim().toLowerCase())),
    [existingLabels],
  );
  const keyConflictSet = useMemo(
    () => new Set((existingKeys ?? []).map((k) => k.trim().toLowerCase())),
    [existingKeys],
  );

  // Drapeau d'auto-fill de la clé (cf. FunctionFormDialog).
  const userTouchedKeyRef = useRef<boolean>(isEdit);
  useEffect(() => {
    if (open) {
      userTouchedKeyRef.current = isEdit;
    }
  }, [open, isEdit, initialId]);

  const labelValue = form.watch("label");
  const keyValue = form.watch("key");

  const labelHasConflict = useMemo(() => {
    const t = (labelValue ?? "").trim().toLowerCase();
    return t.length > 0 && labelConflictSet.has(t);
  }, [labelValue, labelConflictSet]);

  const keyHasConflict = useMemo(() => {
    const t = (keyValue ?? "").trim().toLowerCase();
    return t.length > 0 && keyConflictSet.has(t);
  }, [keyValue, keyConflictSet]);

  useEffect(() => {
    onConflictChange(labelHasConflict || keyHasConflict);
  }, [labelHasConflict, keyHasConflict, onConflictChange]);

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    form.setValue("label", next, { shouldDirty: true });
    if (!userTouchedKeyRef.current) {
      form.setValue("key", toScreamingSnake(next), { shouldDirty: true });
    }
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userTouchedKeyRef.current = true;
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    form.setValue("key", v, { shouldDirty: true });
  };

  const labelErrorMessage =
    form.formState.errors.label?.message ??
    (labelHasConflict ? "Ce libellé existe déjà dans le catalogue Arkyo." : null);
  const keyErrorMessage =
    form.formState.errors.key?.message ??
    (keyHasConflict ? "Cette clé existe déjà dans le catalogue Arkyo." : null);

  return (
    <>
      <FormSection title="Libellé *">
        <input
          autoFocus
          {...form.register("label", { onChange: handleLabelChange })}
          placeholder="ex: Acquisition"
          className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        {labelErrorMessage && (
          // arkyo-server: habillage Strata
          <p className="text-xs text-[var(--danger-text)]">{labelErrorMessage}</p>
        )}
      </FormSection>

      <FormSection title="Clé *">
        <input
          {...form.register("key", { onChange: handleKeyChange })}
          placeholder={toScreamingSnake(labelValue || "ACQUISITION")}
          className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm uppercase focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        {keyErrorMessage && (
          // arkyo-server: habillage Strata
          <p className="text-xs text-[var(--danger-text)]">{keyErrorMessage}</p>
        )}
      </FormSection>

      {isEdit && onDelete && (
        <div className="border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onDelete}
            // arkyo-server: habillage Strata
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleteLabel}
          </button>
        </div>
      )}
    </>
  );
}
