"use client";

/**
 * CustomFieldsBlock — bloc "Divers" de l'onglet Caractéristiques.
 *
 * L'utilisateur peut créer dynamiquement des champs personnalisés sur un
 * équipement. 3 types supportés pour l'instant :
 *  - text     : input libre
 *  - number   : slider + input numérique avec min/max/step + unité optionnelle
 *  - boolean  : pill segmented On/Off (cohérent avec les autres pills de l'app)
 *
 * Pattern :
 *  - Bloc rendu dans `<Section variant="plain">` cohérent avec "Énergie"
 *  - Bouton "+ Ajouter un champ" dashed → ouvre un FormDialog (RHF + Zod)
 *  - Suppression via Trash + useConfirm
 *
 * Stockage : `FormData.customFields: CustomField[]` puis sérialisé tel quel
 * dans le payload save (`customFields: form.customFields`).
 */

import { useMemo, useState } from "react";
import { Plus, Trash2, Sparkles } from "@/components/ui/icons";
import { z } from "zod";

import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";

import { Section, SliderField } from "./shared";
import { CustomField, CustomFieldConfig, CustomFieldType, uid } from "./types";

// ── Defaults ─────────────────────────────────────────────────────────────────

function defaultValueFor(
  type: CustomFieldType,
  config?: CustomFieldConfig,
): string | number | boolean {
  if (type === "text") return "";
  if (type === "boolean") return false;
  // number — start at min if provided, otherwise 0
  return typeof config?.min === "number" ? config.min : 0;
}

// ── CustomFieldRow ───────────────────────────────────────────────────────────

function CustomFieldRow({
  field,
  onChange,
  onRemove,
  catColor,
}: {
  field: CustomField;
  onChange: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
  catColor: string;
}) {
  if (field.type === "text") {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1.5">
          <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            {field.label}
          </label>
          <input
            type="text"
            value={typeof field.value === "string" ? field.value : ""}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex h-8 w-full rounded-lg border border-[var(--border)]/60 bg-transparent px-3 text-sm focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Supprimer ${field.label}`}
          // arkyo-server: habillage Strata
          className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 text-[var(--muted-foreground)] transition-colors hover:border-[var(--danger)]/40 hover:bg-[var(--danger)]/5 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (field.type === "number") {
    const cfg = field.config ?? {};
    const min = typeof cfg.min === "number" ? cfg.min : 0;
    const max = typeof cfg.max === "number" ? cfg.max : 100;
    const step = typeof cfg.step === "number" && cfg.step > 0 ? cfg.step : 1;
    const unit = cfg.unit ?? "";
    const value = typeof field.value === "number" ? field.value : null;
    return (
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <SliderField
            label={field.label}
            unit={unit}
            value={value}
            onChange={(v) => onChange({ value: v ?? min })}
            min={min}
            max={max}
            step={step}
            color={catColor}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Supprimer ${field.label}`}
          // arkyo-server: habillage Strata
          className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 text-[var(--muted-foreground)] transition-colors hover:border-[var(--danger)]/40 hover:bg-[var(--danger)]/5 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // boolean — pill segmented On/Off cohérent avec les pills de l'app
  const checked = field.value === true;
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 items-center justify-between gap-3">
        <label className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {field.label}
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ value: false })}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[10px] font-semibold transition-all",
              !checked
                ? "border-transparent bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            Off
          </button>
          <button
            type="button"
            onClick={() => onChange({ value: true })}
            className={cn("rounded-md border px-2.5 py-1 text-[10px] font-semibold transition-all")}
            style={
              checked
                ? {
                    background: catColor,
                    // arkyo-server: habillage Strata (texte lisible sur l'accent, clair et sombre)
                    color: "var(--accent-foreground)",
                    borderColor: "transparent",
                  }
                : {
                    borderColor: "var(--border)",
                    color: "var(--muted-foreground)",
                  }
            }
          >
            On
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Supprimer ${field.label}`}
        // arkyo-server: habillage Strata
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)]/60 text-[var(--muted-foreground)] transition-colors hover:border-[var(--danger)]/40 hover:bg-[var(--danger)]/5 hover:text-[var(--danger-text)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── AddCustomFieldDialog ─────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Texte" },
  { value: "number", label: "Nombre" },
  { value: "boolean", label: "Booléen" },
];

const addCustomFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Le label est requis."),
    type: z.enum(["text", "number", "boolean"]),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "number") {
      if (typeof val.min === "number" && typeof val.max === "number" && val.min >= val.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "Max doit être supérieur au min.",
        });
      }
    }
  });

type AddCustomFieldValues = z.infer<typeof addCustomFieldSchema>;

const ADD_CUSTOM_FIELD_DEFAULTS: AddCustomFieldValues = {
  label: "",
  type: "text",
  min: 0,
  max: 100,
  step: 1,
  unit: "",
};

function AddCustomFieldDialog({
  open,
  onOpenChange,
  onAdd,
  catColor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (field: CustomField) => void;
  catColor: string;
}) {
  const handleSubmit = (values: AddCustomFieldValues) => {
    const label = values.label.trim();
    if (values.type === "number") {
      const config: CustomFieldConfig = {};
      if (typeof values.min === "number") config.min = values.min;
      if (typeof values.max === "number") config.max = values.max;
      if (typeof values.step === "number") config.step = values.step;
      const unit = values.unit?.trim();
      if (unit) config.unit = unit;
      onAdd({
        id: uid(),
        label,
        type: "number",
        value: defaultValueFor("number", config),
        config,
      });
      return;
    }
    onAdd({
      id: uid(),
      label,
      type: values.type,
      value: defaultValueFor(values.type),
    });
  };

  return (
    <FormDialog<AddCustomFieldValues>
      open={open}
      onOpenChange={onOpenChange}
      icon={<Sparkles />}
      eyebrow="DIVERS"
      title="Nouveau champ personnalisé"
      schema={addCustomFieldSchema}
      defaultValues={ADD_CUSTOM_FIELD_DEFAULTS}
      onSubmit={handleSubmit}
      submitLabel="Ajouter"
      size="md"
    >
      {(form) => {
        const type = form.watch("type");
        return (
          <>
            <FormSection title="Label *">
              <input
                {...form.register("label")}
                placeholder="ex. Latence, RAID activé, Code d'inventaire…"
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                autoFocus
              />
              {form.formState.errors.label && (
                <p className="text-xs text-[var(--destructive)]">
                  {form.formState.errors.label.message}
                </p>
              )}
            </FormSection>

            <FormSection title="Type *">
              <div className="flex flex-wrap gap-2">
                {TYPE_OPTIONS.map((opt) => {
                  const isSelected = type === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => form.setValue("type", opt.value, { shouldDirty: true })}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                        !isSelected &&
                          "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                      style={
                        isSelected
                          ? {
                              borderColor: catColor,
                              // arkyo-server: habillage Strata — teinte par color-mix ; texte
                              // --accent-strong (l'accent clair sur sa teinte fait 4,4:1)
                              backgroundColor: `color-mix(in srgb, ${catColor} 8%, transparent)`,
                              color: "var(--accent-strong)",
                            }
                          : undefined
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </FormSection>

            {type === "number" && (
              <div className="space-y-3 rounded-lg border border-[var(--border)]/60 p-3">
                <p className="text-[10px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                  Configuration
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <FormSection title="Min">
                    <input
                      type="number"
                      {...form.register("min", { valueAsNumber: true })}
                      className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    />
                  </FormSection>
                  <FormSection title="Max">
                    <input
                      type="number"
                      {...form.register("max", { valueAsNumber: true })}
                      className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    />
                    {form.formState.errors.max && (
                      <p className="text-xs text-[var(--destructive)]">
                        {form.formState.errors.max.message}
                      </p>
                    )}
                  </FormSection>
                  <FormSection title="Step">
                    <input
                      type="number"
                      step="any"
                      {...form.register("step", { valueAsNumber: true })}
                      className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    />
                  </FormSection>
                </div>
                <FormSection title="Unité (optionnel)">
                  <input
                    type="text"
                    {...form.register("unit")}
                    placeholder="ex. ms, kg, °C…"
                    className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </FormSection>
              </div>
            )}
          </>
        );
      }}
    </FormDialog>
  );
}

// ── CustomFieldsBlock ────────────────────────────────────────────────────────

export function CustomFieldsBlock({
  fields,
  onChange,
  catColor,
}: {
  fields: CustomField[];
  onChange: (next: CustomField[]) => void;
  catColor: string;
}) {
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const addField = (field: CustomField) => {
    onChange([...fields, field]);
  };

  const updateField = (id: string, patch: Partial<CustomField>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = async (field: CustomField) => {
    const ok = await confirm({
      title: "Supprimer ce champ ?",
      description: (
        <>
          <strong>{field.label || "Ce champ"}</strong> sera retiré de cet équipement.
        </>
      ),
      variant: "destructive",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    onChange(fields.filter((f) => f.id !== field.id));
  };

  const sectionIcon = useMemo(
    () => <Sparkles className="h-3.5 w-3.5" style={{ color: catColor }} strokeWidth={1.5} />,
    [catColor],
  );

  return (
    <>
      <div className="space-y-3">
        {fields.length > 0 && (
          <div className="space-y-3">
            {fields.map((field) => (
              <CustomFieldRow
                key={field.id}
                field={field}
                onChange={(patch) => updateField(field.id, patch)}
                onRemove={() => removeField(field)}
                catColor={catColor}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] text-[11px] font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--foreground)]/40 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un champ
        </button>
      </div>

      <AddCustomFieldDialog
        open={adding}
        onOpenChange={setAdding}
        onAdd={addField}
        catColor={catColor}
      />
    </>
  );
}
