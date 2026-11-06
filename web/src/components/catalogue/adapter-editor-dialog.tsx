"use client";

/**
 * AdapterEditorDialog — dialog d'édition / création d'un adaptateur (tenant).
 *
 * Variante allégée du FormDialog supervisor `adapters-tab.tsx` :
 *  - Pas de proposals, pas de pendingUpdates, pas de prefillData.
 *  - 1 connecteur source → N connecteurs cibles (modèle "câble pieuvre").
 *  - Sauvegarde manuelle uniquement.
 *
 * Le composant attend les référentiels en props (connectors / functions) et
 * délègue la sauvegarde via callback.
 */

import { useMemo, useState } from "react";
import { z } from "zod";
import { Cable as CableIcon, Plus, X } from "@/components/ui/icons";

import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { cn } from "@/lib/utils";

// ── Types publics ──────────────────────────────────────────────────────────

export type AdapterEditorGender = "MALE" | "FEMALE";

export type AdapterEditorPort = {
  connectorTypeId: string;
  gender: AdapterEditorGender;
  quantity: number;
  label: string;
};

export type AdapterEditorConnectorRef = {
  id: string;
  name: string;
  color?: string | null;
  iconId?: string | null;
};

export type AdapterEditorFunctionRef = {
  id: string;
  label: string;
  color: string;
};

export type AdapterEditorInitial = {
  id?: string;
  name?: string | null;
  reference?: string | null;
  inputs?: AdapterEditorPort[] | null;
  outputs?: AdapterEditorPort[] | null;
  functionId?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
};

export type AdapterEditorPayload = {
  name: string;
  reference: string | null;
  inputs: AdapterEditorPort[];
  outputs: AdapterEditorPort[];
  functionId: string | null;
  notes: string | null;
  isActive: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: AdapterEditorInitial;
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
  onSubmit: (payload: AdapterEditorPayload) => Promise<void>;
  submitLabel?: string;
};

// ── Schéma ─────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, "Nom requis"),
  reference: z.string(),
  notes: z.string(),
});
type FormValues = z.infer<typeof schema>;

function emptyPort(): AdapterEditorPort {
  return { connectorTypeId: "", gender: "FEMALE", quantity: 1, label: "" };
}

// ── Composant ──────────────────────────────────────────────────────────────

export function AdapterEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
  connectors,
  functions,
  onSubmit,
  submitLabel,
}: Props) {
  // États hors-RHF (cohérent avec supervisor).
  const initialInput = useMemo<AdapterEditorPort>(
    () => initial?.inputs?.[0] ?? emptyPort(),
    [initial],
  );
  const initialOutputs = useMemo<AdapterEditorPort[]>(
    () =>
      Array.isArray(initial?.outputs) && initial.outputs.length > 0
        ? initial.outputs
        : [emptyPort()],
    [initial],
  );
  const [formInput, setFormInput] = useState<AdapterEditorPort>(initialInput);
  const [formOutputs, setFormOutputs] = useState<AdapterEditorPort[]>(initialOutputs);
  const [formFunctionId, setFormFunctionId] = useState<string | null>(
    initial?.functionId ?? null,
  );

  const defaultValues = useMemo<FormValues>(
    () => ({
      name: initial?.name ?? "",
      reference: initial?.reference ?? "",
      notes: initial?.notes ?? "",
    }),
    [initial],
  );

  return (
    <FormDialog<FormValues>
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          // Reset hors-RHF.
          setFormInput(initialInput);
          setFormOutputs(initialOutputs);
          setFormFunctionId(initial?.functionId ?? null);
        }
      }}
      icon={<CableIcon />}
      eyebrow="ADAPTATEUR"
      title={mode === "edit" ? "Modifier l'adaptateur" : "Nouvel adaptateur"}
      schema={schema}
      defaultValues={defaultValues}
      size="xl"
      submitLabel={submitLabel ?? (mode === "edit" ? "Enregistrer" : "Créer")}
      onSubmit={async (values) => {
        const payload: AdapterEditorPayload = {
          name: values.name.trim(),
          reference: values.reference.trim() || null,
          inputs: formInput.connectorTypeId ? [formInput] : [],
          outputs: formOutputs.filter((p) => p.connectorTypeId),
          functionId: formFunctionId || null,
          notes: values.notes.trim() || null,
          isActive: true,
        };
        await onSubmit(payload);
      }}
    >
      {(form) => (
        <>
          <div className="grid grid-cols-2 items-end gap-3">
            <FormSection title="Nom *">
              <input
                autoFocus
                {...form.register("name")}
                placeholder="XLR5 → 2× XLR3"
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
              {form.formState.errors.name && (
                // arkyo-server: habillage Strata
                <p className="text-xs text-[var(--danger-text)]">
                  {form.formState.errors.name.message}
                </p>
              )}
            </FormSection>
            <FormSection title="Référence">
              <input
                {...form.register("reference")}
                placeholder="REF-001"
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </FormSection>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-4">
            <FormSection title="Connecteur source">
              <PortRow
                port={formInput}
                connectors={connectors}
                onChange={setFormInput}
                removable={false}
                showQuantity={false}
              />
            </FormSection>

            <div className="w-px self-stretch bg-[var(--border)]" />

            <FormSection title="Connecteurs cibles">
              <div className="space-y-2">
                {formOutputs.map((p, i) => (
                  <PortRow
                    key={i}
                    port={p}
                    connectors={connectors}
                    onChange={(v) =>
                      setFormOutputs((prev) => prev.map((x, j) => (j === i ? v : x)))
                    }
                    onRemove={() =>
                      setFormOutputs((prev) => prev.filter((_, j) => j !== i))
                    }
                    removable={formOutputs.length > 1}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setFormOutputs((prev) => [...prev, emptyPort()])}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter un connecteur cible
                </button>
              </div>
            </FormSection>
          </div>

          {functions.length > 0 && (
            <FormSection title="Fonction">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFormFunctionId(null)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                    !formFunctionId
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Aucune
                </button>
                {functions.map((fn) => {
                  const isSelected = formFunctionId === fn.id;
                  return (
                    <button
                      key={fn.id}
                      type="button"
                      onClick={() => setFormFunctionId(fn.id)}
                      className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                      style={
                        isSelected
                          ? {
                              borderColor: fn.color,
                              backgroundColor: `${fn.color}15`,
                              color: fn.color,
                            }
                          : { borderColor: "var(--border)" }
                      }
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: fn.color }}
                      />
                      {fn.label}
                    </button>
                  );
                })}
              </div>
            </FormSection>
          )}

          <FormSection title="Notes">
            <textarea
              {...form.register("notes")}
              placeholder="Notes techniques…"
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

// ── PortRow (édition d'un connecteur) ──────────────────────────────────────

function PortRow({
  port,
  connectors,
  onChange,
  onRemove,
  removable = true,
  showQuantity = true,
}: {
  port: AdapterEditorPort;
  connectors: AdapterEditorConnectorRef[];
  onChange: (p: AdapterEditorPort) => void;
  onRemove?: () => void;
  removable?: boolean;
  showQuantity?: boolean;
}) {
  const ct = connectors.find((c) => c.id === port.connectorTypeId);
  return (
    <div className="group flex items-center gap-2">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: ct?.color ? `${ct.color}20` : "var(--secondary)" }}
      >
        {ct && ct.iconId ? (
          <ConnectorIcon iconId={ct.iconId} color={ct.color ?? "#3b82f6"} size={16} />
        ) : (
          <div className="h-3 w-3 rounded-full bg-[var(--muted-foreground)]/30" />
        )}
      </div>
      <select
        value={port.connectorTypeId}
        onChange={(e) => onChange({ ...port, connectorTypeId: e.target.value })}
        className="flex h-9 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <option value="">Choisir…</option>
        {connectors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--secondary)]/40 p-0.5">
        {(["MALE", "FEMALE"] as const).map((g) => {
          const active = port.gender === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange({ ...port, gender: g })}
              className={cn(
                "rounded px-2 py-1 text-[10px] font-bold transition-all",
                active
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {g === "MALE" ? "M" : "F"}
            </button>
          );
        })}
      </div>
      {showQuantity && (
        <input
          type="number"
          min={1}
          max={99}
          value={port.quantity}
          onChange={(e) => {
            const n = Math.max(1, Math.min(99, Number(e.target.value) || 1));
            onChange({ ...port, quantity: n });
          }}
          className="h-9 w-14 rounded-lg border border-[var(--border)] bg-transparent px-2 text-center font-mono text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          title="Quantité"
        />
      )}
      {removable && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
          title="Retirer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
