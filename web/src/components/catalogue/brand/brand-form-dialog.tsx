"use client";

/**
 * BrandFormDialog — modale create/edit partagée pour CatalogBrand
 * (supervisor) et TenantBrand (tenant).
 *
 * Le parent fournit `onSubmit(values)` qui se charge de l'appel API approprié.
 *
 * Un bouton « Supprimer » optionnel est exposé en mode édition via la prop
 * `onDelete` (callback fourni par le parent — il gère la confirmation et
 * l'appel API).
 *
 * Vérification anti-doublon temps réel :
 *  - le parent passe `existingNames` (liste case-insensitive de noms déjà
 *    pris ailleurs — typiquement catalogue Arkyo côté tenant). Dès la saisie,
 *    un message d'erreur s'affiche sous le champ et le bouton de soumission
 *    est désactivé.
 */

import { useEffect, useMemo, useState } from "react";
import { Building2, Trash2 } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";

// Schéma Zod : `website` / `logoUrl` sont des strings (RHF ne gère pas
// naturellement les `null` côté input). On les transforme en null pour l'API
// si laissés vides. `logoUrl` peut être soit une URL distante http(s)://
// classique, soit un chemin uploadé (ex. `/uploads/brands/logos/...`).
const schema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  website: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/.+/.test(v), {
      message: "URL invalide (http:// ou https://).",
    }),
  logoUrl: z.string().trim(),
});

export type BrandFormValues = z.infer<typeof schema>;

export type BrandFormInitial = {
  id?: string;
  name?: string;
  website?: string | null;
  logoUrl?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: BrandFormInitial | null;
  /** Noms déjà pris (case-insensitive). Affiche une erreur inline temps réel. */
  existingNames?: string[];
  /** Soumission appelée par FormDialog — peut throw pour afficher l'erreur. */
  onSubmit: (values: BrandFormValues) => Promise<void>;
  /** Bouton supprimer en mode edit (parent gère confirm + API). */
  onDelete?: () => void;
  deleteLabel?: string;
};

export function BrandFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  existingNames,
  onSubmit,
  onDelete,
  deleteLabel = "Supprimer ce fabricant",
}: Props) {
  const defaultValues = useMemo<BrandFormValues>(
    () => ({
      name: initial?.name ?? "",
      website: initial?.website ?? "",
      logoUrl: initial?.logoUrl ?? "",
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
    <FormDialog<BrandFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Building2 />}
      eyebrow="FABRICANT"
      title={isEdit ? "Modifier le fabricant" : "Nouveau fabricant"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer le fabricant"}
      submitDisabled={hasConflict}
      size="lg"
    >
      {(form) => (
        <BrandFormBody
          form={form}
          isEdit={isEdit}
          existingNames={existingNames}
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
  form: UseFormReturn<BrandFormValues>;
  isEdit: boolean;
  existingNames: string[] | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  onDelete: (() => void) | undefined;
  deleteLabel: string;
};

function BrandFormBody({
  form,
  isEdit,
  existingNames,
  onConflictChange,
  onDelete,
  deleteLabel,
}: BodyProps) {
  // Set normalisé pour lookup O(1) en temps réel.
  const nameConflictSet = useMemo(
    () => new Set((existingNames ?? []).map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const nameValue = form.watch("name");

  const nameHasConflict = useMemo(() => {
    const t = (nameValue ?? "").trim().toLowerCase();
    return t.length > 0 && nameConflictSet.has(t);
  }, [nameValue, nameConflictSet]);

  // Remontée du flag au parent (pour désactiver le submit).
  useEffect(() => {
    onConflictChange(nameHasConflict);
  }, [nameHasConflict, onConflictChange]);

  // Erreur affichée sous le champ : prioritaire = erreur zod, sinon doublon.
  const nameErrorMessage =
    form.formState.errors.name?.message ??
    (nameHasConflict
      ? "Ce fabricant existe déjà dans le catalogue Arkyo."
      : null);

  return (
    <>
      <div className="flex items-start gap-6">
        {/* Logo — bloc fixe à gauche, ratio 1:1 contraint à 150×150. */}
        <div className="w-[150px] shrink-0 space-y-2">
          <h3 className="text-[0.7rem] font-semibold tracking-wider text-[var(--foreground)]/80 uppercase">
            Logo
          </h3>
          <ImageCropUpload
            label=""
            folder="brands/logos"
            value={form.watch("logoUrl")}
            onChange={(url) =>
              form.setValue("logoUrl", url, { shouldDirty: true })
            }
            forceAspectRatio={1}
            minSourceWidth={150}
            minSourceHeight={150}
            className="w-[150px]"
          />
        </div>

        {/* Champs Nom + Site web empilés à droite, flex-1. */}
        <div className="flex-1 space-y-4">
          <FormSection title="Nom *">
            <input
              autoFocus
              {...form.register("name")}
              placeholder="Sony, Blackmagic, Riedel…"
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
            {nameErrorMessage && (
              <p className="text-xs text-[var(--destructive)]">{nameErrorMessage}</p>
            )}
          </FormSection>

          <FormSection title="Site web">
            <input
              {...form.register("website")}
              placeholder="https://sony.com"
              className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
            {form.formState.errors.website && (
              <p className="text-xs text-[var(--destructive)]">
                {form.formState.errors.website.message}
              </p>
            )}
          </FormSection>
        </div>
      </div>

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
