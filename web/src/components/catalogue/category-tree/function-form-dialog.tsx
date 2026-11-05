"use client";

/**
 * FunctionFormDialog — modale create/edit partagée pour CatalogFunction
 * (supervisor) et TenantFunction (tenant).
 *
 * Le parent fournit `onSubmit(values)` qui se charge de l'appel API approprié.
 * Le parent contrôle aussi `showCableFields` pour activer/désactiver les
 * champs `cablePrefix` / `cableSuffix` (présents côté supervisor uniquement).
 *
 * Un bouton « Supprimer » optionnel est exposé en mode édition via la prop
 * `onDelete` (callback fourni par le parent — il gère la confirmation et
 * l'appel API).
 *
 * Vérification anti-doublon temps réel :
 *  - le parent passe `existingLabels` / `existingKeys` (liste case-insensitive
 *    de libellés/clés déjà pris ailleurs — typiquement catalogue Arkyo côté
 *    tenant). Dès la saisie, un message d'erreur s'affiche sous le champ et
 *    le bouton de soumission est désactivé.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Tag, Trash2 } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";

/**
 * Normalise un libellé en SCREAMING_SNAKE_CASE : supprime les accents,
 * passe en majuscules, remplace tous les non-alphanum par `_`, collapse les
 * `_` consécutifs et trim les `_` aux extrémités.
 *
 * Utilisé par FunctionFormDialog et PhaseFormDialog pour auto-suggérer la
 * clé depuis le libellé.
 */
export function toScreamingSnake(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const baseSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est requis.").max(100),
  key: z
    .string()
    .trim()
    .min(1, "La clé est requise.")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Lettres majuscules, chiffres ou underscore."),
  color: z.string().trim().min(1, "Couleur requise."),
  cablePrefix: z.string().optional(),
  cableSuffix: z.string().optional(),
});

export type FunctionFormValues = z.infer<typeof baseSchema>;

export type FunctionFormInitial = {
  id?: string;
  label?: string;
  key?: string;
  color?: string | null;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: FunctionFormInitial | null;
  /** Si true, les champs préfixe/suffixe câble sont affichés (supervisor). */
  showCableFields?: boolean;
  /** Libellés déjà pris (case-insensitive). Affiche une erreur inline en temps réel. */
  existingLabels?: string[];
  /** Clés déjà prises (case-insensitive). Affiche une erreur inline en temps réel. */
  existingKeys?: string[];
  /** Soumission appelée par FormDialog — peut throw pour afficher l'erreur. */
  onSubmit: (values: FunctionFormValues) => Promise<void>;
  /** Bouton supprimer en mode edit (parent gère confirm + API). */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Surcharges de vocabulaire — défaut « Catégorie » (tenant). Le supervisor
   *  passe « Fonction » depuis functions-panel. */
  eyebrow?: string;
  titleCreate?: string;
  titleEdit?: string;
  submitCreateLabel?: string;
};

export function FunctionFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  showCableFields = false,
  existingLabels,
  existingKeys,
  onSubmit,
  onDelete,
  deleteLabel = "Supprimer cette catégorie",
  eyebrow = "CATÉGORIE",
  titleCreate = "Nouvelle catégorie",
  titleEdit = "Modifier la catégorie",
  submitCreateLabel = "Créer la catégorie",
}: Props) {
  const defaultValues = useMemo<FunctionFormValues>(
    () => ({
      label: initial?.label ?? "",
      key: initial?.key ?? "",
      color: initial?.color ?? "#3b82f6",
      cablePrefix: initial?.cablePrefix ?? "",
      cableSuffix: initial?.cableSuffix ?? "",
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  // État de conflit anti-doublon — remonté depuis le body via callback pour
  // pouvoir désactiver le bouton submit du FormDialog.
  const [hasConflict, setHasConflict] = useState(false);

  // Reset à chaque ouverture.
  useEffect(() => {
    if (!open) setHasConflict(false);
  }, [open]);

  return (
    <FormDialog<FunctionFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Tag />}
      eyebrow={eyebrow}
      title={isEdit ? titleEdit : titleCreate}
      schema={baseSchema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : submitCreateLabel}
      submitDisabled={hasConflict}
      size="md"
    >
      {(form) => (
        <FunctionFormBody
          form={form}
          open={open}
          isEdit={isEdit}
          initialId={initial?.id}
          showCableFields={showCableFields}
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
  form: UseFormReturn<FunctionFormValues>;
  open: boolean;
  isEdit: boolean;
  initialId: string | undefined;
  showCableFields: boolean;
  existingLabels: string[] | undefined;
  existingKeys: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  onDelete: (() => void) | undefined;
  deleteLabel: string;
};

function FunctionFormBody({
  form,
  open,
  isEdit,
  initialId,
  showCableFields,
  existingLabels,
  existingKeys,
  onConflictChange,
  onDelete,
  deleteLabel,
}: BodyProps) {
  // Sets normalisés pour lookup O(1) en temps réel.
  const labelConflictSet = useMemo(
    () => new Set((existingLabels ?? []).map((l) => l.trim().toLowerCase())),
    [existingLabels],
  );
  const keyConflictSet = useMemo(
    () => new Set((existingKeys ?? []).map((k) => k.trim().toLowerCase())),
    [existingKeys],
  );

  // Drapeau d'auto-fill de la clé : tant que l'utilisateur n'a pas tapé
  // manuellement dans `key`, on synchronise key ← toScreamingSnake(label).
  //  - création : false au mount → auto-fill actif
  //  - édition  : true au mount → on respecte ce qui est en base
  const userTouchedKeyRef = useRef<boolean>(isEdit);

  // Reset du drapeau à chaque ouverture / changement de cible.
  useEffect(() => {
    if (open) {
      userTouchedKeyRef.current = isEdit;
    }
  }, [open, isEdit, initialId]);

  const labelValue = form.watch("label");
  const keyValue = form.watch("key");
  const colorValue = form.watch("color");

  // Détection de conflit anti-doublon (case-insensitive).
  const labelHasConflict = useMemo(() => {
    const t = (labelValue ?? "").trim().toLowerCase();
    return t.length > 0 && labelConflictSet.has(t);
  }, [labelValue, labelConflictSet]);

  const keyHasConflict = useMemo(() => {
    const t = (keyValue ?? "").trim().toLowerCase();
    return t.length > 0 && keyConflictSet.has(t);
  }, [keyValue, keyConflictSet]);

  // Remontée du flag au parent (pour désactiver le submit).
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
    form.setValue("key", e.target.value.toUpperCase(), { shouldDirty: true });
  };

  // Erreur affichée sous le champ : prioritaire = erreur zod, sinon doublon.
  const labelErrorMessage =
    form.formState.errors.label?.message ??
    (labelHasConflict ? "Ce libellé existe déjà dans le catalogue Arkyo." : null);
  const keyErrorMessage =
    form.formState.errors.key?.message ??
    (keyHasConflict ? "Cette clé existe déjà dans le catalogue Arkyo." : null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormSection title="Libellé *">
          <input
            autoFocus
            {...form.register("label", { onChange: handleLabelChange })}
            placeholder="Vidéo"
            className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          {labelErrorMessage && (
            <p className="text-xs text-[var(--destructive)]">{labelErrorMessage}</p>
          )}
        </FormSection>

        <FormSection title="Clé *">
          <input
            {...form.register("key", { onChange: handleKeyChange })}
            placeholder="VIDEO"
            className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          {keyErrorMessage && (
            <p className="text-xs text-[var(--destructive)]">{keyErrorMessage}</p>
          )}
        </FormSection>
      </div>

      <FormSection title="Couleur *">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={colorValue}
            onChange={(e) => form.setValue("color", e.target.value, { shouldDirty: true })}
            className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent"
          />
          <input
            {...form.register("color")}
            placeholder="#3b82f6"
            className="flex h-9 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </div>
        {form.formState.errors.color && (
          <p className="text-xs text-[var(--destructive)]">
            {form.formState.errors.color.message}
          </p>
        )}
      </FormSection>

      {showCableFields && (
        <div className="grid grid-cols-2 gap-3">
          <FormSection title="Préfixe câble">
            <input
              {...form.register("cablePrefix", {
                onChange: (e) =>
                  form.setValue("cablePrefix", e.target.value.toUpperCase(), {
                    shouldDirty: true,
                  }),
              })}
              placeholder="V"
              maxLength={5}
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Préfixe ajouté aux numéros de câble dans les synoptiques
              (ex&nbsp;: <span className="font-mono">VID</span> →{" "}
              <span className="font-mono">VID-001</span>).
            </p>
          </FormSection>
          <FormSection title="Suffixe câble">
            <input
              {...form.register("cableSuffix")}
              placeholder="-RX"
              maxLength={5}
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Suffixe ajouté aux numéros de câble dans les synoptiques
              (ex&nbsp;: <span className="font-mono">IN</span> →{" "}
              <span className="font-mono">001-IN</span>).
            </p>
          </FormSection>
        </div>
      )}

      {labelValue && (
        <p className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorValue }} />
          Aperçu :{" "}
          <span className="font-semibold" style={{ color: colorValue }}>
            {labelValue}
          </span>
        </p>
      )}

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
