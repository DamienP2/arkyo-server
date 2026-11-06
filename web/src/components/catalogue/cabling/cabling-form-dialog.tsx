"use client";

/**
 * CablingFormDialog — modale create/edit partagée pour CableModel
 * (supervisor) et TenantCableModel (tenant).
 *
 * Layout (modale `xl` = max-w-4xl, 2 colonnes responsive) :
 *   - Header eyebrow "MODÈLE DE CÂBLE" + titre dynamique (« Modifier "Nom" »
 *     / « Nouveau modèle de câble »).
 *   - Body : grid `lg:grid-cols-2 gap-x-6 gap-y-4`.
 *       Colonne gauche (identité) :
 *         - Nom + Référence (sous-grid 2 col).
 *         - Fabricant (BrandPickerTrigger → BrandPickerModal).
 *         - Catégorie (FunctionPickerTrigger → FunctionPickerModal).
 *         - Image (ImageUpload).
 *         - Datasheet PDF (FileUpload).
 *         - Notes (textarea).
 *       Colonne droite (caractéristiques techniques) :
 *         - Impédance / Bande passante / Diamètre (sous-grid 3 col).
 *         - Type d'âme (BadgePicker — énumération).
 *         - Blindage (BadgePicker — énumération).
 *         - Matériau de la gaine (BadgePicker — énumération).
 *         - Classification feu (input mono).
 *   - Footer Annuler / Enregistrer géré par FormDialog.
 *
 * Vérification anti-doublon temps réel :
 *   Le parent passe `existingNames` et/ou `existingReferences` (les deux
 *   sont case-insensitive). La contrainte côté schema main DB est
 *   `@@unique([name, brandId])` ; côté tenant `@@unique([name, reference])`.
 *   Pour rester aligné avec les autres dialogs, on bloque dès que le `name`
 *   matche un nom déjà pris dans le catalogue Arkyo (cas standard).
 *
 * Champs requis (bouton submit bloqué tant que non remplis) :
 *   - `name` non vide et non en doublon.
 *   - `brandId` non vide.
 */

import { useEffect, useMemo, useState } from "react";
import { Cable } from "@/components/ui/icons";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ImageUpload } from "@/components/ui/image-upload";
import {
  BrandPickerModal,
  BrandPickerTrigger,
  type BrandPickerBrand,
} from "@/components/catalogue/brand-picker-modal";
import {
  FunctionPickerModal,
  FunctionPickerTrigger,
  type FunctionPickerFunction,
} from "@/components/catalogue/function-picker-modal";
import { cn } from "@/lib/utils";

import {
  CONDUCTOR_LABEL,
  SHIELDING_LABEL,
  JACKET_LABEL,
} from "./cabling-card";

// ── Schema ──────────────────────────────────────────────────────────────────
//
// Tous les champs numériques sont des strings côté form (inputs HTML), puis
// convertis en `number | null` au moment du submit dans l'appelant.

const schema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  reference: z.string().trim().max(100),
  functionId: z.string(),
  brandId: z.string().min(1, "Fabricant requis."),
  impedance: z.string().trim(),
  bandwidthMHz: z.string().trim(),
  diameterMm: z.string().trim(),
  conductor: z.string(),
  shielding: z.string(),
  jacketMaterial: z.string(),
  fireRating: z.string().trim().max(100),
  imageUrl: z.string().trim(),
  datasheetUrl: z.string().trim(),
  notes: z.string().trim(),
});

export type CablingFormValues = z.infer<typeof schema>;

export type CablingFormInitial = {
  id?: string;
  name?: string;
  reference?: string | null;
  functionId?: string | null;
  brandId?: string | null;
  impedance?: number | null;
  bandwidthMHz?: number | null;
  diameterMm?: number | null;
  conductor?: string | null;
  shielding?: string | null;
  jacketMaterial?: string | null;
  fireRating?: string | null;
  imageUrl?: string | null;
  datasheetUrl?: string | null;
  notes?: string | null;
};

export type CablingFormFunctionOption = {
  id: string;
  label: string;
  color: string;
  key?: string;
};

export type CablingFormBrandOption = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: CablingFormInitial | null;
  /** Catégories (fonctions) disponibles pour le picker. */
  functionOptions?: CablingFormFunctionOption[];
  /** Fabricants disponibles pour le picker. */
  brandOptions?: CablingFormBrandOption[];
  /** Noms déjà pris (case-insensitive). Affiche une erreur inline temps réel. */
  existingNames?: string[];
  /** Références déjà prises (case-insensitive). Optionnel. */
  existingReferences?: string[];
  /** Soumission appelée par FormDialog — peut throw pour afficher l'erreur. */
  onSubmit: (values: CablingFormValues) => Promise<void>;
};

export function CablingFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  functionOptions,
  brandOptions,
  existingNames,
  existingReferences,
  onSubmit,
}: Props) {
  const defaultValues = useMemo<CablingFormValues>(
    () => ({
      name: initial?.name ?? "",
      reference: initial?.reference ?? "",
      functionId: initial?.functionId ?? "",
      brandId: initial?.brandId ?? "",
      impedance: initial?.impedance != null ? String(initial.impedance) : "",
      bandwidthMHz:
        initial?.bandwidthMHz != null ? String(initial.bandwidthMHz) : "",
      diameterMm:
        initial?.diameterMm != null ? String(initial.diameterMm) : "",
      conductor: initial?.conductor ?? "",
      shielding: initial?.shielding ?? "",
      jacketMaterial: initial?.jacketMaterial ?? "",
      fireRating: initial?.fireRating ?? "",
      imageUrl: initial?.imageUrl ?? "",
      datasheetUrl: initial?.datasheetUrl ?? "",
      notes: initial?.notes ?? "",
    }),
    [initial],
  );

  const isEdit = mode === "edit";

  // États de validation remontés depuis le body via callbacks pour permettre
  // de désactiver le bouton submit.
  const [hasConflict, setHasConflict] = useState(false);
  const [selectionInvalid, setSelectionInvalid] = useState(true);

  useEffect(() => {
    if (!open) {
      setHasConflict(false);
      setSelectionInvalid(true);
    }
  }, [open]);

  const title = isEdit
    ? `Modifier « ${initial?.name?.trim() || "Modèle de câble"} »`
    : "Nouveau modèle de câble";

  return (
    <FormDialog<CablingFormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Cable />}
      eyebrow="MODÈLE DE CÂBLE"
      title={title}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      submitLabel={isEdit ? "Enregistrer" : "Créer le modèle"}
      submitDisabled={hasConflict || selectionInvalid}
      size="xl"
    >
      {(form) => (
        <CablingFormBody
          form={form}
          functionOptions={functionOptions ?? []}
          brandOptions={brandOptions ?? []}
          existingNames={existingNames}
          existingReferences={existingReferences}
          editingId={initial?.id}
          editingName={initial?.name}
          editingReference={initial?.reference}
          onConflictChange={setHasConflict}
          onSelectionInvalidChange={setSelectionInvalid}
        />
      )}
    </FormDialog>
  );
}

// ── Body extrait pour permettre l'utilisation propre de hooks ────────────────

type BodyProps = {
  form: UseFormReturn<CablingFormValues>;
  functionOptions: CablingFormFunctionOption[];
  brandOptions: CablingFormBrandOption[];
  existingNames: string[] | undefined;
  existingReferences: string[] | undefined;
  editingId: string | undefined;
  editingName: string | undefined;
  editingReference: string | null | undefined;
  onConflictChange: (hasConflict: boolean) => void;
  onSelectionInvalidChange: (invalid: boolean) => void;
};

function CablingFormBody({
  form,
  functionOptions,
  brandOptions,
  existingNames,
  existingReferences,
  editingId,
  editingName,
  editingReference,
  onConflictChange,
  onSelectionInvalidChange,
}: BodyProps) {
  // Sets normalisés pour lookup O(1) en temps réel.
  // En édition, on exclut le nom/référence courant pour ne pas se signaler
  // soi-même comme doublon.
  const nameConflictSet = useMemo(() => {
    const editingNameLower = editingId
      ? (editingName ?? "").trim().toLowerCase()
      : null;
    const set = new Set(
      (existingNames ?? [])
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n && (!editingNameLower || n !== editingNameLower)),
    );
    return set;
  }, [existingNames, editingId, editingName]);

  const referenceConflictSet = useMemo(() => {
    const editingRefLower = editingId
      ? (editingReference ?? "").trim().toLowerCase()
      : null;
    const set = new Set(
      (existingReferences ?? [])
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r && (!editingRefLower || r !== editingRefLower)),
    );
    return set;
  }, [existingReferences, editingId, editingReference]);

  const nameValue = form.watch("name");
  const referenceValue = form.watch("reference");
  const brandId = form.watch("brandId");
  const functionId = form.watch("functionId");
  const imageUrl = form.watch("imageUrl");
  const datasheetUrl = form.watch("datasheetUrl");
  const cond = form.watch("conductor") ?? "";
  const shield = form.watch("shielding") ?? "";
  const jacket = form.watch("jacketMaterial") ?? "";

  // Affiche l'erreur picker fabricant seulement après une 1ʳᵉ tentative
  // de submit (évite le bruit visuel à l'ouverture).
  const submitCount = form.formState.submitCount;
  const saveAttempted = submitCount > 0;

  // Conflit anti-doublon (case-insensitive)
  const nameHasConflict = useMemo(() => {
    const t = (nameValue ?? "").trim().toLowerCase();
    return t.length > 0 && nameConflictSet.has(t);
  }, [nameValue, nameConflictSet]);

  const referenceHasConflict = useMemo(() => {
    const t = (referenceValue ?? "").trim().toLowerCase();
    return t.length > 0 && referenceConflictSet.has(t);
  }, [referenceValue, referenceConflictSet]);

  useEffect(() => {
    onConflictChange(nameHasConflict || referenceHasConflict);
  }, [nameHasConflict, referenceHasConflict, onConflictChange]);

  // Selection validity (fabricant obligatoire).
  const selectionInvalid = !brandId;
  useEffect(() => {
    onSelectionInvalidChange(selectionInvalid);
  }, [selectionInvalid, onSelectionInvalidChange]);

  // Pickers modaux
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);

  const selectedBrand = useMemo<BrandPickerBrand | null>(() => {
    if (!brandId) return null;
    const b = brandOptions.find((b) => b.id === brandId);
    return b
      ? { id: b.id, name: b.name, logoUrl: b.logoUrl ?? null }
      : null;
  }, [brandOptions, brandId]);

  const selectedFn = useMemo<FunctionPickerFunction | null>(() => {
    if (!functionId) return null;
    const f = functionOptions.find((f) => f.id === functionId);
    return f
      ? { id: f.id, label: f.label, color: f.color, key: f.key }
      : null;
  }, [functionOptions, functionId]);

  const nameErrorMessage =
    form.formState.errors.name?.message ??
    (nameHasConflict
      ? "Un modèle avec ce nom existe déjà dans le catalogue Arkyo."
      : null);

  const referenceErrorMessage = referenceHasConflict
    ? "Cette référence est déjà utilisée dans le catalogue Arkyo."
    : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
        {/* ── Colonne gauche : Identité ── */}
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <FormSection title="Nom *">
              <input
                autoFocus
                {...form.register("name")}
                placeholder="1694A"
                className={cn(
                  "flex h-10 w-full rounded-lg border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  nameErrorMessage
                    ? "border-[var(--destructive)]"
                    : "border-[var(--border)]",
                )}
              />
              {nameErrorMessage && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-[11px] text-[var(--danger-text)]">
                  {nameErrorMessage}
                </p>
              )}
            </FormSection>
            <FormSection title="Référence">
              <input
                {...form.register("reference")}
                placeholder="SKU fabricant"
                className={cn(
                  "flex h-10 w-full rounded-lg border bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  referenceErrorMessage
                    ? "border-[var(--destructive)]"
                    : "border-[var(--border)]",
                )}
              />
              {referenceErrorMessage && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-[11px] text-[var(--danger-text)]">
                  {referenceErrorMessage}
                </p>
              )}
            </FormSection>
          </div>

          <FormSection title="Fabricant *">
            {brandOptions.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] italic">
                Aucun fabricant disponible.
              </p>
            ) : (
              <BrandPickerTrigger
                brand={selectedBrand}
                placeholder="Sélectionner un fabricant"
                onClick={() => setBrandPickerOpen(true)}
                error={
                  saveAttempted && !brandId
                    ? "Le fabricant est obligatoire."
                    : undefined
                }
              />
            )}
          </FormSection>

          <FormSection title="Fonction">
            {functionOptions.length === 0 ? (
              <p className="text-xs italic text-[var(--muted-foreground)]">
                Aucune fonction disponible.
              </p>
            ) : (
              <FunctionPickerTrigger
                fn={selectedFn}
                placeholder="Sélectionner une fonction"
                onClick={() => setFunctionPickerOpen(true)}
              />
            )}
          </FormSection>

          <FormSection title="Image">
            <ImageUpload
              value={imageUrl}
              onChange={(url) =>
                form.setValue("imageUrl", url ?? "", { shouldDirty: true })
              }
              folder="cable-models"
              previewSize="md"
              label="Image"
            />
          </FormSection>

          <FormSection title="Datasheet (PDF)">
            <FileUpload
              value={datasheetUrl}
              onChange={(url) =>
                form.setValue("datasheetUrl", url ?? "", { shouldDirty: true })
              }
              folder="cable-datasheets"
              label="datasheet"
            />
          </FormSection>

          <FormSection title="Notes">
            <textarea
              {...form.register("notes")}
              rows={3}
              className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
          </FormSection>
        </div>

        {/* ── Colonne droite : Caractéristiques techniques ── */}
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <FormSection title="Impédance (Ω)">
              <input
                {...form.register("impedance")}
                type="number"
                step="0.1"
                placeholder="75"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>
            <FormSection title="Bande passante (MHz)">
              <input
                {...form.register("bandwidthMHz")}
                type="number"
                step="any"
                placeholder="3000"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>
            <FormSection title="Diamètre (mm)">
              <input
                {...form.register("diameterMm")}
                type="number"
                step="0.1"
                placeholder="7.0"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>
          </div>

          <FormSection title="Type d'âme">
            <BadgePicker
              options={Object.entries(CONDUCTOR_LABEL).map(([k, l]) => ({
                value: k,
                label: l,
              }))}
              selected={cond}
              onSelect={(v) =>
                form.setValue("conductor", v, { shouldDirty: true })
              }
            />
          </FormSection>

          <FormSection title="Blindage">
            <BadgePicker
              options={Object.entries(SHIELDING_LABEL).map(([k, l]) => ({
                value: k,
                label: l,
              }))}
              selected={shield}
              onSelect={(v) =>
                form.setValue("shielding", v, { shouldDirty: true })
              }
            />
          </FormSection>

          <FormSection title="Matériau de la gaine">
            <BadgePicker
              options={Object.entries(JACKET_LABEL).map(([k, l]) => ({
                value: k,
                label: l,
              }))}
              selected={jacket}
              onSelect={(v) =>
                form.setValue("jacketMaterial", v, { shouldDirty: true })
              }
            />
          </FormSection>

          <FormSection title="Classification feu">
            <input
              {...form.register("fireRating")}
              placeholder="Cca-s1d1a1, CMR, CMP…"
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
          </FormSection>
        </div>
      </div>

      {/* ── Picker fabricant (modal) ─────────────────────────────────── */}
      <BrandPickerModal
        open={brandPickerOpen}
        onOpenChange={setBrandPickerOpen}
        brands={brandOptions.map((b) => ({
          id: b.id,
          name: b.name,
          logoUrl: b.logoUrl ?? null,
        }))}
        selectedId={brandId || null}
        onSelect={(id) =>
          form.setValue("brandId", id ?? "", {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />

      {/* ── Picker catégorie (modal) ─────────────────────────────────── */}
      <FunctionPickerModal
        open={functionPickerOpen}
        onOpenChange={setFunctionPickerOpen}
        functions={functionOptions.map((f) => ({
          id: f.id,
          label: f.label,
          color: f.color,
          key: f.key,
        }))}
        selectedId={functionId || null}
        onSelect={(id) =>
          form.setValue("functionId", id ?? "", { shouldDirty: true })
        }
      />
    </>
  );
}

// ── Badge picker générique (énumérations courtes 3-6 valeurs) ──────────────

function BadgePicker({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onSelect("")}
        className={cn(
          "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
          !selected
            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
        )}
      >
        — Non spécifié —
      </button>
      {options.map((opt) => {
        const active = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
              active
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] hover:bg-[var(--secondary)]/40",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
