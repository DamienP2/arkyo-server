"use client";

/**
 * DimensionFormDialog — création / édition d'un TenantDimensionPreset.
 *
 * Modèle tenant-only :
 *  - Champs : Valeur + Unité (tous deux éditables en création comme en édition) +
 *    Touret (conditionnel : CABLE_LENGTH uniquement).
 *  - Le label affiché ailleurs est dérivé via `formatDimensionLabel(value, unit,
 *    isReel)` côté lecture.
 *  - Erreur 409 (P2002 côté API) → message "Une dimension avec cette valeur
 *    existe déjà dans cette catégorie." rendu inline par FormDialog.
 *
 * Suppression : pas de bouton dans le modal. La suppression se fait depuis la
 * card du panel (bouton Trash inline en hover).
 */

import { useMemo } from "react";
import { Controller } from "react-hook-form";
import { Ruler } from "@/components/ui/icons";
import { z } from "zod";

import { api, ApiError } from "@/lib/api-client";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import type { TenantDimensionItem } from "./dimensions-panel";

export const DIMENSION_CATEGORIES = [
  "RACK_U",
  "RACK_WIDTH",
  "RACK_DEPTH",
  "CABLE_SAFETY_DEPTH",
  "CABLE_LENGTH",
  "BEND_RADIUS",
] as const;

export const DIMENSION_UNITS = ["U", "INCH", "MM", "M", "DEG"] as const;

export const CATEGORY_LABELS: Record<(typeof DIMENSION_CATEGORIES)[number], string> = {
  RACK_U: "Hauteurs U",
  RACK_WIDTH: "Largeurs rack",
  RACK_DEPTH: "Profondeurs rack",
  CABLE_SAFETY_DEPTH: "Sécurité câblage",
  CABLE_LENGTH: "Longueurs câbles",
  BEND_RADIUS: "Rayons de courbure",
};

const schema = z.object({
  value: z
    .string()
    .trim()
    .refine((v) => v !== "" && Number(v) > 0, {
      message: "Valeur numérique positive requise.",
    }),
  unit: z.enum(DIMENSION_UNITS),
  isReel: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantDimensionItem | null;
  /** Catégorie pré-sélectionnée (depuis le sub-tab actif). */
  defaultCategory: (typeof DIMENSION_CATEGORIES)[number];
  /** Unité par défaut pour la catégorie (suggérée en création). */
  defaultUnit: (typeof DIMENSION_UNITS)[number];
  onSaved: () => void;
};

export function DimensionFormDialog({
  open,
  onOpenChange,
  editing,
  defaultCategory,
  defaultUnit,
  onSaved,
}: Props) {
  const toast = useToast();

  const defaultValues = useMemo<FormValues>(
    () => ({
      value: editing?.value != null ? String(editing.value) : "",
      unit: (editing?.unit as (typeof DIMENSION_UNITS)[number]) ?? defaultUnit,
      isReel: editing?.isReel ?? false,
    }),
    [editing, defaultUnit],
  );

  const effectiveCategory = editing
    ? (editing.category as (typeof DIMENSION_CATEGORIES)[number])
    : defaultCategory;

  const eyebrow = CATEGORY_LABELS[effectiveCategory].toUpperCase();
  const isCableLength = effectiveCategory === "CABLE_LENGTH";

  const handleSubmit = async (values: FormValues) => {
    const isReel = isCableLength ? values.isReel : false;
    try {
      if (editing) {
        await api.patch(`/api/tenant/parametres/dimensions/${editing.id}`, {
          value: Number(values.value),
          unit: values.unit,
          isReel,
        });
        toast.success("Dimension modifiée.");
      } else {
        await api.post("/api/tenant/parametres/dimensions", {
          category: defaultCategory,
          value: Number(values.value),
          unit: values.unit,
          isReel,
        });
        toast.success("Dimension créée.");
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error(
          "Une dimension avec cette valeur existe déjà dans cette catégorie.",
        );
      }
      throw e;
    }
  };

  return (
    <FormDialog<FormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Ruler />}
      eyebrow={eyebrow}
      title={editing ? "Modifier le preset" : "Nouveau preset"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Enregistrer" : "Créer"}
      size="md"
    >
      {(form) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormSection title="Valeur *">
              <input
                {...form.register("value")}
                type="number"
                step="0.01"
                min="0"
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
              {form.formState.errors.value && (
                // arkyo-server: habillage Strata
                <p className="mt-1 text-xs text-[var(--danger-text)]">
                  {form.formState.errors.value.message}
                </p>
              )}
            </FormSection>
            <FormSection title="Unité *">
              <select
                {...form.register("unit")}
                className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                {DIMENSION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </FormSection>
          </div>

          {isCableLength && (
            <FormSection title="Touret">
              <Controller
                control={form.control}
                name="isReel"
                render={({ field }) => (
                  <label className="flex cursor-pointer items-center gap-3">
                    <ToggleSwitch
                      checked={!!field.value}
                      onChange={field.onChange}
                    />
                    <span className="text-sm text-[var(--foreground)]">
                      Longueur vendue en touret
                    </span>
                  </label>
                )}
              />
            </FormSection>
          )}
        </>
      )}
    </FormDialog>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[var(--muted-foreground)]/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
