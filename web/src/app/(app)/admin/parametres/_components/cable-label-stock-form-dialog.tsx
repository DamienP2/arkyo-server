"use client";

/**
 * CableLabelStockFormDialog — création / édition d'une TenantCableLabelStock
 * (planche d'étiquettes câbles personnelle).
 *
 * Pattern aligné sur `PrintTemplateFormDialog` / `CablingFormDialog` :
 *   - FormDialog (RHF + Zod), size "3xl" : on a 15+ champs et un aperçu live.
 *   - Sections groupées : Identité / Papier / Marges / Grille / Étiquette /
 *     Câbles. Le bouton « Supprimer » apparaît en mode édition.
 *
 * Aperçu live : SVG mini généré à partir des valeurs courantes (form.watch()),
 * pour un retour visuel immédiat sans bloquer la modale en attente d'un POST.
 *
 * Pas d'éditeur visuel coté détaillé ici (cf. supervisor `EditableDimensionedPreview`)
 * — version sobre et adaptée aux tenant : focus sur le CRUD pratique.
 */

import { useMemo } from "react";
import { Tag, Trash2 } from "@/components/ui/icons";
import { z } from "zod";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  LabelStockPreview,
  type BrandLookupItem,
  type TenantCableLabelStockItem,
} from "./cable-label-stocks-section";

// ── Constantes ─────────────────────────────────────────────────────────────

const PAPER_FORMATS = ["A4", "A3", "A2", "A1", "A0", "LETTER", "LEGAL"] as const;
const ORIENTATIONS = ["PORTRAIT", "LANDSCAPE"] as const;

// ── Schéma ─────────────────────────────────────────────────────────────────
//
// Strings vides pour les champs nullable (parsées en number|null à la
// soumission). Évite les conflits zod entre `z.coerce.number()` et un input
// vide qui renvoie "" — pattern repris du supervisor stock-schema.

const schema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  reference: z.string().trim().max(100),
  brandId: z.string(),
  description: z.string().trim().max(500),
  datasheetUrl: z.string().trim().max(2000),

  paperFormat: z.enum(PAPER_FORMATS),
  orientation: z.enum(ORIENTATIONS),

  pageMarginTop: z.coerce.number().min(0).max(100),
  pageMarginRight: z.coerce.number().min(0).max(100),
  pageMarginBottom: z.coerce.number().min(0).max(100),
  pageMarginLeft: z.coerce.number().min(0).max(100),

  columns: z.coerce.number().int().min(1).max(50),
  rows: z.coerce.number().int().min(1).max(200),
  gutterX: z.coerce.number().min(0).max(50),
  gutterY: z.coerce.number().min(0).max(50),

  labelWidth: z.coerce.number().min(1).max(500),
  labelHeight: z.coerce.number().min(1).max(500),

  printableHeight: z.string(),
  wrapHeight: z.string(),
  printablePadding: z.string(),
  printableColor: z.string(),

  cableDiameterMin: z.string(),
  cableDiameterMax: z.string(),
});

type FormValues = z.infer<typeof schema>;

// ── Helpers parse ──────────────────────────────────────────────────────────

const optNumber = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TenantCableLabelStockItem | null;
  brands: BrandLookupItem[];
  onSaved: () => void;
  onDeleted?: () => void;
};

export function CableLabelStockFormDialog({
  open,
  onOpenChange,
  editing,
  brands,
  onSaved,
  onDeleted,
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();

  const defaultValues = useMemo<FormValues>(() => {
    if (!editing) {
      return {
        name: "",
        reference: "",
        brandId: "",
        description: "",
        datasheetUrl: "",
        paperFormat: "A4",
        orientation: "PORTRAIT",
        pageMarginTop: 8,
        pageMarginRight: 8,
        pageMarginBottom: 8,
        pageMarginLeft: 8,
        columns: 4,
        rows: 6,
        gutterX: 1,
        gutterY: 1,
        labelWidth: 32,
        labelHeight: 12,
        printableHeight: "",
        wrapHeight: "",
        printablePadding: "",
        printableColor: "",
        cableDiameterMin: "",
        cableDiameterMax: "",
      };
    }
    return {
      name: editing.name,
      reference: editing.reference ?? "",
      brandId: editing.brandId ?? "",
      description: editing.description ?? "",
      datasheetUrl: editing.datasheetUrl ?? "",
      paperFormat: editing.paperFormat,
      orientation: editing.orientation,
      pageMarginTop: editing.pageMarginTop,
      pageMarginRight: editing.pageMarginRight,
      pageMarginBottom: editing.pageMarginBottom,
      pageMarginLeft: editing.pageMarginLeft,
      columns: editing.columns,
      rows: editing.rows,
      gutterX: editing.gutterX,
      gutterY: editing.gutterY,
      labelWidth: editing.labelWidth,
      labelHeight: editing.labelHeight,
      printableHeight:
        editing.printableHeight != null ? String(editing.printableHeight) : "",
      wrapHeight: editing.wrapHeight != null ? String(editing.wrapHeight) : "",
      printablePadding:
        editing.printablePadding != null
          ? String(editing.printablePadding)
          : "",
      printableColor: editing.printableColor ?? "",
      cableDiameterMin:
        editing.cableDiameterMin != null
          ? String(editing.cableDiameterMin)
          : "",
      cableDiameterMax:
        editing.cableDiameterMax != null
          ? String(editing.cableDiameterMax)
          : "",
    };
  }, [editing]);

  const handleSubmit = async (values: FormValues) => {
    const payload = {
      name: values.name.trim(),
      reference: values.reference.trim() || null,
      brandId: values.brandId.trim() || null,
      description: values.description.trim() || null,
      datasheetUrl: values.datasheetUrl.trim() || null,
      paperFormat: values.paperFormat,
      orientation: values.orientation,
      pageMarginTop: values.pageMarginTop,
      pageMarginRight: values.pageMarginRight,
      pageMarginBottom: values.pageMarginBottom,
      pageMarginLeft: values.pageMarginLeft,
      columns: values.columns,
      rows: values.rows,
      gutterX: values.gutterX,
      gutterY: values.gutterY,
      labelWidth: values.labelWidth,
      labelHeight: values.labelHeight,
      printableHeight: optNumber(values.printableHeight),
      wrapHeight: optNumber(values.wrapHeight),
      printablePadding: optNumber(values.printablePadding),
      printableColor: values.printableColor.trim() || null,
      cableDiameterMin: optNumber(values.cableDiameterMin),
      cableDiameterMax: optNumber(values.cableDiameterMax),
    };

    try {
      if (editing) {
        await api.patch(
          `/api/tenant/parametres/print/label-stocks/${editing.id}`,
          payload,
        );
        toast.success("Planche modifiée.");
      } else {
        await api.post("/api/tenant/parametres/print/label-stocks", payload);
        toast.success("Planche créée.");
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        throw new Error(
          body?.error ?? "Une planche avec ce nom et cette référence existe déjà.",
        );
      }
      throw new Error(getApiErrorMessage(e, "Échec de l'enregistrement."));
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirm({
      title: "Supprimer cette planche ?",
      description: (
        <>
          <strong>{editing.name}</strong> sera supprimée définitivement.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(
        `/api/tenant/parametres/print/label-stocks/${editing.id}`,
      );
      toast.success("Planche supprimée.");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  const fieldClass =
    "flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

  return (
    <FormDialog<FormValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Tag />}
      eyebrow="PLANCHE D'ÉTIQUETTES"
      title={editing ? "Modifier la planche" : "Nouvelle planche d'étiquettes"}
      schema={schema}
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Enregistrer" : "Créer la planche"}
      size="3xl"
    >
      {(form) => {
        const w = form.watch();
        // Build a preview item from current form values (safe defaults pour
        // ne jamais crasher l'aperçu sur des valeurs vides en cours de
        // saisie).
        const previewItem: TenantCableLabelStockItem = {
          id: "preview",
          name: w.name || "—",
          reference: w.reference || null,
          brandId: w.brandId || null,
          description: w.description || null,
          datasheetUrl: w.datasheetUrl || null,
          paperFormat: w.paperFormat,
          orientation: w.orientation,
          pageMarginTop: Number(w.pageMarginTop) || 0,
          pageMarginRight: Number(w.pageMarginRight) || 0,
          pageMarginBottom: Number(w.pageMarginBottom) || 0,
          pageMarginLeft: Number(w.pageMarginLeft) || 0,
          columns: Math.max(1, Number(w.columns) || 1),
          rows: Math.max(1, Number(w.rows) || 1),
          gutterX: Number(w.gutterX) || 0,
          gutterY: Number(w.gutterY) || 0,
          labelWidth: Math.max(1, Number(w.labelWidth) || 1),
          labelHeight: Math.max(1, Number(w.labelHeight) || 1),
          printableHeight: optNumber(w.printableHeight),
          wrapHeight: optNumber(w.wrapHeight),
          printablePadding: optNumber(w.printablePadding),
          printableColor: w.printableColor || null,
          cableDiameterMin: optNumber(w.cableDiameterMin),
          cableDiameterMax: optNumber(w.cableDiameterMax),
        };

        const paperFormatActive = form.watch("paperFormat");
        const orientationActive = form.watch("orientation");

        return (
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)]">
            <div className="space-y-5">
              {/* ── Identité ───────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-3">
                <FormSection title="Nom *">
                  <input
                    autoFocus
                    {...form.register("name")}
                    placeholder="LCK 40 perso"
                    className={fieldClass}
                  />
                  {form.formState.errors.name && (
                    <p className="mt-1 text-xs text-[var(--destructive)]">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </FormSection>
                <FormSection title="Référence">
                  <input
                    {...form.register("reference")}
                    placeholder="SKU fabricant"
                    className={cn(fieldClass, "font-mono")}
                  />
                </FormSection>
                <FormSection title="Fabricant">
                  <select {...form.register("brandId")} className={fieldClass}>
                    <option value="">— Aucun</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </FormSection>
              </div>

              <FormSection title="Description">
                <textarea
                  {...form.register("description")}
                  rows={2}
                  placeholder="Contexte, usage, contraintes spécifiques…"
                  className="flex w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </FormSection>

              <FormSection title="Datasheet (URL)">
                <input
                  {...form.register("datasheetUrl")}
                  placeholder="https://…"
                  className={cn(fieldClass, "font-mono text-xs")}
                />
              </FormSection>

              {/* ── Format papier + Orientation ───────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <FormSection title="Format papier">
                  <div className="grid grid-cols-4 gap-1.5">
                    {PAPER_FORMATS.map((f) => {
                      const active = paperFormatActive === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() =>
                            form.setValue("paperFormat", f, {
                              shouldDirty: true,
                            })
                          }
                          className={cn(
                            "rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                            active
                              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                              : "border-[var(--border)] hover:bg-[var(--secondary)]/40",
                          )}
                        >
                          {f}
                        </button>
                      );
                    })}
                  </div>
                </FormSection>
                <FormSection title="Orientation">
                  <div className="grid grid-cols-2 gap-1.5">
                    {ORIENTATIONS.map((o) => {
                      const active = orientationActive === o;
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() =>
                            form.setValue("orientation", o, {
                              shouldDirty: true,
                            })
                          }
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                            active
                              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                              : "border-[var(--border)] hover:bg-[var(--secondary)]/40",
                          )}
                        >
                          {o === "LANDSCAPE" ? "Paysage" : "Portrait"}
                        </button>
                      );
                    })}
                  </div>
                </FormSection>
              </div>

              {/* ── Marges page ────────────────────────────────────────── */}
              <FormSection title="Marges page (mm)">
                <div className="grid max-w-md grid-cols-4 gap-2">
                  <SmallNumberInput
                    {...form.register("pageMarginTop")}
                    label="Haut"
                    step={0.5}
                  />
                  <SmallNumberInput
                    {...form.register("pageMarginRight")}
                    label="Droite"
                    step={0.5}
                  />
                  <SmallNumberInput
                    {...form.register("pageMarginBottom")}
                    label="Bas"
                    step={0.5}
                  />
                  <SmallNumberInput
                    {...form.register("pageMarginLeft")}
                    label="Gauche"
                    step={0.5}
                  />
                </div>
              </FormSection>

              {/* ── Grille ─────────────────────────────────────────────── */}
              <FormSection title="Grille d'étiquettes">
                <div className="grid max-w-md grid-cols-4 gap-2">
                  <SmallNumberInput
                    {...form.register("columns")}
                    label="Colonnes"
                    step={1}
                  />
                  <SmallNumberInput
                    {...form.register("rows")}
                    label="Rangées"
                    step={1}
                  />
                  <SmallNumberInput
                    {...form.register("gutterX")}
                    label="Gutter X"
                    step={0.5}
                  />
                  <SmallNumberInput
                    {...form.register("gutterY")}
                    label="Gutter Y"
                    step={0.5}
                  />
                </div>
              </FormSection>

              {/* ── Étiquette ─────────────────────────────────────────── */}
              <FormSection title="Étiquette (mm)">
                <div className="grid max-w-md grid-cols-2 gap-2">
                  <SmallNumberInput
                    {...form.register("labelWidth")}
                    label="Largeur"
                    step={0.5}
                  />
                  <SmallNumberInput
                    {...form.register("labelHeight")}
                    label="Hauteur"
                    step={0.5}
                  />
                </div>
              </FormSection>

              {/* ── Options self-laminating ───────────────────────────── */}
              <FormSection title="Options self-laminating (optionnel)">
                <div className="grid max-w-md grid-cols-2 gap-2">
                  <SmallNumberInput
                    {...form.register("printableHeight")}
                    label="Zone imprimable"
                    step={0.5}
                    placeholder="—"
                  />
                  <SmallNumberInput
                    {...form.register("wrapHeight")}
                    label="Zone wrap"
                    step={0.5}
                    placeholder="—"
                  />
                  <SmallNumberInput
                    {...form.register("printablePadding")}
                    label="Padding"
                    step={0.5}
                    placeholder="—"
                  />
                  <label className="block">
                    <span className="mb-1 block text-[9px] tracking-wider text-[var(--muted-foreground)] uppercase">
                      Couleur zone imprimable
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={w.printableColor || "#fde047"}
                        onChange={(e) =>
                          form.setValue("printableColor", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        className="h-9 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5"
                      />
                      {w.printableColor && (
                        <button
                          type="button"
                          onClick={() =>
                            form.setValue("printableColor", "", {
                              shouldDirty: true,
                            })
                          }
                          className="rounded px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  </label>
                </div>
                <p className="mt-2 text-[10px] text-[var(--muted-foreground)] italic">
                  Laissez vide pour une planche standard (sans zone wrap
                  transparente).
                </p>
              </FormSection>

              {/* ── Câbles compatibles ────────────────────────────────── */}
              <FormSection title="Compatibilité câble (Ø mm)">
                <div className="grid max-w-md grid-cols-2 gap-2">
                  <SmallNumberInput
                    {...form.register("cableDiameterMin")}
                    label="Diamètre min."
                    step={0.5}
                    placeholder="—"
                  />
                  <SmallNumberInput
                    {...form.register("cableDiameterMax")}
                    label="Diamètre max."
                    step={0.5}
                    placeholder="—"
                  />
                </div>
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
                    Supprimer cette planche
                  </button>
                </div>
              )}
            </div>

            {/* ── Aperçu live ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                Aperçu
              </div>
              <div className="flex items-center justify-center rounded-xl border border-[var(--border)]/60 bg-[var(--secondary)]/20 px-2 py-6">
                <LabelStockPreview item={previewItem} size={260} />
              </div>
              <div className="space-y-1 px-1 text-[10px] text-[var(--muted-foreground)]">
                <p>
                  Grille :{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {previewItem.columns}×{previewItem.rows}
                  </span>{" "}
                  ={" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {previewItem.columns * previewItem.rows}
                  </span>{" "}
                  étiquettes par planche.
                </p>
                <p>
                  Étiquette :{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {previewItem.labelWidth}×{previewItem.labelHeight}
                  </span>{" "}
                  mm.
                </p>
                {previewItem.printableHeight != null && (
                  <p>
                    Zone imprimable :{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      {previewItem.printableHeight}
                    </span>{" "}
                    mm (self-laminating).
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </FormDialog>
  );
}

// ── Mini-input numérique (label + input) ───────────────────────────────────

const SmallNumberInput = function SmallNumberInput({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] tracking-wider text-[var(--muted-foreground)] uppercase">
        {label}
      </span>
      <input
        type="number"
        {...rest}
        className="flex h-9 w-full rounded-md border border-[var(--border)] bg-transparent px-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      />
    </label>
  );
};
