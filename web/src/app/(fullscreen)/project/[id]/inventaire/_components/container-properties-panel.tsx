"use client";

/**
 * ContainerPropertiesPanel — propriétés du contenant sélectionné, rendu dans
 * le rightPanel quand `expandedRackId !== null`.
 *
 * Design strictement aligné sur `SynopticGeneralPanel` (panneau "Grille /
 * Snap / Repères" du synoptique) :
 *  - Header : sous-titre catégorie + NameInput uppercase + 2 InfoCards
 *  - Liste d'OptionRow (card avec icône + label + badge mono + chevron) :
 *    expandable révèle un éditeur inline en accordéon
 *  - Toggles inline pour les booléens (expandable: false)
 *  - Section "Actions" avec ActionButton
 *
 * Pas de modal — édition 100% inline, identique au panneau synoptique.
 */

import {
  Box,
  Check,
  CornerDownLeft,
  Layers,
  MapPin,
  Move3d,
  Save,
  Server,
  Trash2,
  Truck,
  Weight,
  Zap,
} from "@/components/ui/icons";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";

import {
  ActionButton,
  InfoCard,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { OptionRow } from "@/components/synoptique/components/synoptic-general-panel";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { RangeInput } from "@/components/wizard/range-input";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  useInventaireScope,
  useInventaireScopeOptional,
} from "./inventaire-scope";
import type { InventaireRack } from "../inventaire-client";
import type { SaveStatus } from "../../_editor/project-contextual-topbar";

const RACK_TYPES = [
  { id: "STANDARD", label: 'Baie 19"' },
  { id: "FLIGHT_CASE_CLASSIC", label: "Flight case" },
  { id: "FLIGHT_CASE_SKB", label: "SKB" },
  { id: "PELICAN", label: "Pelicase" },
  { id: "CAP", label: "Mobilier" },
] as const;

type RackTypeId = (typeof RACK_TYPES)[number]["id"];

const RACK_TYPE_LABEL: Record<RackTypeId, string> = {
  STANDARD: 'Baie 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const FLIGHT_TYPES = new Set<RackTypeId>([
  "FLIGHT_CASE_CLASSIC",
  "FLIGHT_CASE_SKB",
  "PELICAN",
]);

const U_PRESETS: number[] = [6, 9, 12, 18, 24, 30, 36, 42, 45, 48];
const DEPTH_PRESETS: number[] = [400, 450, 500, 600, 700, 800, 1000];
// Presets dimensions extérieures (non-rackable : flight, pelicase, mobilier).
const WIDTH_PRESETS: number[] = [400, 500, 600, 800, 1000, 1200];
const HEIGHT_PRESETS: number[] = [300, 400, 500, 600, 800, 1000];

export function ContainerPropertiesPanel({
  rackId,
  onClose,
  onDeleted,
  // Mode "props-driven" — utilisé hors `InventaireScope` (ex. onglet Rack).
  rack: rackProp,
  projectId: projectIdProp,
  onPatch: onPatchProp,
  notifySave: notifySaveProp,
}: {
  rackId: string;
  onClose: () => void;
  onDeleted?: (rackId: string) => void;
  rack?: InventaireRack;
  projectId?: string;
  onPatch?: (data: Record<string, unknown>) => Promise<void> | void;
  notifySave?: (status: SaveStatus) => void;
}) {
  const scope = useInventaireScopeOptional();
  const projectId = projectIdProp ?? scope?.projectId ?? "";
  const racks = scope?.racks ?? [];
  const setRacks = scope?.setRacks;
  const notifySave: (s: SaveStatus) => void =
    notifySaveProp ?? scope?.notifySave ?? (() => {});
  const confirm = useConfirm();
  const toast = useToast();
  const rack = rackProp ?? racks.find((r) => r.id === rackId);
  const [deleting, setDeleting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  if (!rack) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-center">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Contenant introuvable.
        </p>
      </div>
    );
  }

  const isFlight = FLIGHT_TYPES.has(rack.rackType as RackTypeId);
  const typeLabel = RACK_TYPE_LABEL[rack.rackType as RackTypeId] ?? rack.rackType;

  const patch = async (data: Record<string, unknown>) => {
    if (onPatchProp) {
      await onPatchProp(data);
      return;
    }
    notifySave("saving");
    setRacks?.((prev) =>
      prev.map((r) => (r.id === rackId ? { ...r, ...data } : r)),
    );
    try {
      await api.patch(`/api/tenant/projects/${projectId}/racks/${rackId}`, data);
      notifySave("saved");
    } catch (e) {
      notifySave("error");
      window.alert(getApiErrorMessage(e));
    }
  };

  const handleSaveAsTemplate = async () => {
    if (savingTemplate) return;
    setSavingTemplate(true);
    notifySave("saving");
    try {
      const created = await api.post<{ rack: { id: string; name: string } }>(
        `/api/tenant/projects/${projectId}/racks/${rackId}/save-as-template`,
        {},
      );
      notifySave("saved");
      toast.success(`Modèle « ${created.rack.name} » enregistré.`);
    } catch (e) {
      notifySave("error");
      toast.error(getApiErrorMessage(e));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Supprimer « ${rack.name} » ?`,
      description:
        "Le contenant et toutes ses données associées (BOM, équipements placés, câblage) seront supprimés définitivement.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    notifySave("saving");
    try {
      await api.delete(`/api/tenant/projects/${projectId}/racks/${rackId}`);
      setRacks?.((prev) => prev.filter((r) => r.id !== rackId));
      onDeleted?.(rackId);
      onClose();
      notifySave("saved");
    } catch (e) {
      notifySave("error");
      window.alert(getApiErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  // ── Agrégats temps réel (BOM × quantité) ───────────────────────────────
  let bomWeight = 0;
  let usedU = 0;
  let powerW = 0;
  for (const it of rack.bom ?? []) {
    if (typeof it.weightKg === "number") bomWeight += it.weightKg * it.quantity;
    // Les composants sont DANS un châssis hôte — ils n'occupent pas de U propres
    // mais comptent dans le poids et la conso (cf. TotalsBar de la card).
    if (it.hostItemId == null && it.isRackable && typeof it.heightU === "number") {
      usedU += it.heightU * it.quantity;
    }
    if (typeof it.powerW === "number") powerW += it.powerW * it.quantity;
  }
  const emptyWeight =
    typeof rack.emptyWeightKg === "number" ? rack.emptyWeightKg : 0;
  const totalWeight = emptyWeight + bomWeight;
  // Distinction stricte : `totalWeightDisplay` pour l'InfoCard "Poids"
  // (rack + BOM) vs `emptyWeightDisplay` pour le badge "Poids à vide" de
  // l'OptionRow d'édition (rack seul — le label le promet).
  // Pas d'arrondi à l'entier : on garde la précision réelle (max 2 décimales).
  const formatFr = (n: number) =>
    n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const totalWeightDisplay =
    totalWeight > 0 ? `${formatFr(totalWeight)} kg` : "—";
  const emptyWeightDisplay =
    emptyWeight > 0 ? `${formatFr(emptyWeight)} kg` : "—";
  const usedRoundedU = Math.round(usedU * 10) / 10;
  // Badge contextuel : rack 19" → utilisation U ; sinon → dimensions L×l×P
  // (mm). Le label de la InfoCard suit (Hauteur vs Dimensions).
  const heightDisplay = rack.isRackable
    ? `${usedRoundedU}/${rack.totalU} U`
    : rack.widthMm && rack.heightMm && rack.depthMm
      ? `${rack.widthMm}×${rack.heightMm}×${rack.depthMm}`
      : "—";
  const heightLabel = rack.isRackable ? "Hauteur" : "Dimensions";
  const powerDisplay = powerW > 0 ? `${formatFr(powerW)} W` : "—";

  // ── Volume estimé (m³) ─────────────────────────────────────────────────
  // Rackable : 600mm × (totalU × 44.45mm) × depthMm (dimensions standard 19″)
  // Non-rackable : widthMm × heightMm × depthMm si renseignés
  const U_HEIGHT_MM = 44.45;
  const RACK_WIDTH_19_MM = 600;
  let volumeMm3 = 0;
  if (rack.isRackable && rack.totalU > 0 && rack.depthMm > 0) {
    volumeMm3 = RACK_WIDTH_19_MM * (rack.totalU * U_HEIGHT_MM) * rack.depthMm;
  } else if (rack.widthMm && rack.heightMm && rack.depthMm > 0) {
    volumeMm3 = rack.widthMm * rack.heightMm * rack.depthMm;
  }
  const volumeM3 = volumeMm3 / 1e9;
  const volumeDisplay = volumeM3 > 0 ? `${volumeM3.toFixed(2)} m³` : "—";

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex flex-col gap-3 text-xs">
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <div>
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            {typeLabel}
            {rack.isRackable ? ` (${rack.totalU}U)` : ""}
          </div>
          <NameInput
            value={rack.name}
            onSave={(next) => void patch({ name: next })}
          />
          {/* Grille 2x2 : conso · hauteur · poids · volume — vue d'ensemble
              du contenant sélectionné. Reprend le pattern InfoCard du
              synoptique pour la cohérence visuelle. */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <InfoCard
              icon={<Zap className="h-4 w-4" />}
              label="Conso"
              value={powerDisplay}
            />
            <InfoCard
              icon={<Server className="h-4 w-4" />}
              label={heightLabel}
              value={heightDisplay}
            />
            <InfoCard
              icon={<Weight className="h-4 w-4" />}
              label="Poids"
              value={totalWeightDisplay}
            />
            <InfoCard
              icon={<Box className="h-4 w-4" />}
              label="Volume"
              value={volumeDisplay}
            />
          </div>
        </div>

        {/* ── Liste d'options éditables (OptionRow style synoptique) ─── */}
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Options
          </div>
          {/* Type — expandable révèle les segments */}
          <OptionRow icon={Layers} label="Type" badge={typeLabel}>
            <div className="grid grid-cols-2 gap-1.5">
              {RACK_TYPES.map((t) => {
                const active = rack.rackType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void patch({ rackType: t.id })}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-[11px] transition-all active:scale-95",
                      active
                        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </OptionRow>

          {/* Rackable — toggle simple inline */}
          <OptionRow
            icon={Server}
            label="Rackable"
            checked={rack.isRackable}
            onToggle={(v) => void patch({ isRackable: v })}
            expandable={false}
          />

          {/* Roulettes — toggle simple inline (flight uniquement) */}
          {isFlight && (
            <OptionRow
              icon={Truck}
              label="Roulettes"
              checked={rack.hasWheels}
              onToggle={(v) => void patch({ hasWheels: v })}
              expandable={false}
            />
          )}

          {/* Dimensions selon mode rackable / non-rackable */}
          {rack.isRackable ? (
            <>
              {/* Hauteur U — chips presets + curseur perso */}
              <OptionRow icon={Server} label="Hauteur" badge={`${rack.totalU}U`}>
                <PresetChips
                  value={rack.totalU}
                  options={U_PRESETS}
                  format={(u) => `${u}U`}
                  onChange={(u) => void patch({ totalU: u })}
                />
                <RangeInput
                  unit="U"
                  min={1}
                  max={60}
                  step={1}
                  value={rack.totalU}
                  onChange={(v) => void patch({ totalU: Math.round(v) })}
                  showBounds
                  editable
                />
              </OptionRow>

              {/* Profondeur mm */}
              <OptionRow
                icon={Move3d}
                label="Profondeur"
                badge={`${rack.depthMm}mm`}
              >
                <PresetChips
                  value={rack.depthMm}
                  options={DEPTH_PRESETS}
                  format={(d) => `${d}mm`}
                  onChange={(d) => void patch({ depthMm: d })}
                />
                <RangeInput
                  unit="mm"
                  min={50}
                  max={2000}
                  step={10}
                  value={rack.depthMm}
                  onChange={(v) => void patch({ depthMm: Math.round(v) })}
                  showBounds
                  editable
                />
              </OptionRow>
            </>
          ) : (
            <>
              {/* Largeur mm (non-rackable) */}
              <OptionRow
                icon={Move3d}
                label="Largeur"
                badge={rack.widthMm ? `${rack.widthMm}mm` : "—"}
              >
                <PresetChips
                  value={rack.widthMm ?? 0}
                  options={WIDTH_PRESETS}
                  format={(w) => `${w}mm`}
                  onChange={(w) => void patch({ widthMm: w })}
                />
                <RangeInput
                  unit="mm"
                  min={50}
                  max={3000}
                  step={10}
                  value={rack.widthMm ?? 600}
                  onChange={(v) => void patch({ widthMm: Math.round(v) })}
                  showBounds
                  editable
                />
              </OptionRow>

              {/* Hauteur mm (non-rackable) */}
              <OptionRow
                icon={Server}
                label="Hauteur"
                badge={rack.heightMm ? `${rack.heightMm}mm` : "—"}
              >
                <PresetChips
                  value={rack.heightMm ?? 0}
                  options={HEIGHT_PRESETS}
                  format={(h) => `${h}mm`}
                  onChange={(h) => void patch({ heightMm: h })}
                />
                <RangeInput
                  unit="mm"
                  min={50}
                  max={3000}
                  step={10}
                  value={rack.heightMm ?? 400}
                  onChange={(v) => void patch({ heightMm: Math.round(v) })}
                  showBounds
                  editable
                />
              </OptionRow>

              {/* Profondeur mm (toujours présente) */}
              <OptionRow
                icon={Move3d}
                label="Profondeur"
                badge={`${rack.depthMm}mm`}
              >
                <PresetChips
                  value={rack.depthMm}
                  options={DEPTH_PRESETS}
                  format={(d) => `${d}mm`}
                  onChange={(d) => void patch({ depthMm: d })}
                />
                <RangeInput
                  unit="mm"
                  min={50}
                  max={2000}
                  step={10}
                  value={rack.depthMm}
                  onChange={(v) => void patch({ depthMm: Math.round(v) })}
                  showBounds
                  editable
                />
              </OptionRow>
            </>
          )}

          {/* Poids à vide — slider seul (input éditable + bornes), pas de
              presets : trop de variantes possibles, le slider + input direct
              suffit. */}
          <OptionRow icon={Weight} label="Poids à vide" badge={emptyWeightDisplay}>
            <RangeInput
              unit="kg"
              min={0}
              max={200}
              step={0.5}
              value={rack.emptyWeightKg ?? 0}
              onChange={(v) =>
                void patch({ emptyWeightKg: v === 0 ? null : v })
              }
              showBounds
              editable
            />
          </OptionRow>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="mt-1 flex flex-col gap-1">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Actions
          </div>
          <ActionButton
            icon={<Save className="h-3.5 w-3.5" />}
            label={
              savingTemplate ? "Enregistrement…" : "Enregistrer en tant que modèle"
            }
            onClick={() => {
              if (!savingTemplate) void handleSaveAsTemplate();
            }}
          />
          {/* Déplacer vers un autre emplacement — uniquement dans le scope
              inventaire (l'onglet Rack en mode props n'a pas les lieux). */}
          {scope &&
            (() => {
              const targets = scope.locations.filter(
                (l) => l.id !== rack.locationId,
              );
              if (targets.length === 0) return null;
              return (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="text-foreground hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors"
                    >
                      <span className="text-muted-foreground shrink-0">
                        <MapPin className="h-3.5 w-3.5" />
                      </span>
                      Déplacer vers un emplacement…
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="start"
                      sideOffset={4}
                      className="border-border bg-card z-50 max-h-[50vh] min-w-[220px] overflow-auto rounded-lg border p-1 shadow-md"
                    >
                      {targets.map((loc) => (
                        <DropdownMenu.Item
                          key={loc.id}
                          onSelect={() =>
                            void scope.assignRackToLocation(rackId, loc.id)
                          }
                          className="data-[highlighted]:bg-secondary/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] outline-none"
                        >
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate font-medium uppercase">
                            {loc.name}
                          </span>
                          {loc.cableCode && (
                            <span className="text-muted-foreground ml-auto font-mono text-[10px]">
                              {loc.cableCode}
                            </span>
                          )}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              );
            })()}
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={deleting ? "Suppression…" : "Supprimer ce contenant"}
            onClick={() => {
              if (!deleting) void handleDelete();
            }}
            danger
          />
        </div>
      </div>
    </div>
  );
}

// ── NameInput style synoptique (uppercase, inline, hint Entrée/Enregistré) ──

export function NameInput({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== value) {
      el.value = value;
      setDirty(false);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        onChange={(e) => {
          e.target.value = e.target.value.toUpperCase();
          setDirty(e.target.value.trim() !== value);
          if (saved) setSaved(false);
        }}
        onBlur={(e) => {
          const v = e.target.value.trim().toUpperCase();
          if (v && v !== value) {
            onSave(v);
            setSaved(true);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
          }
          setDirty(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = value;
            setDirty(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="text-foreground hover:border-border w-full truncate border-b border-transparent bg-transparent px-0 py-0.5 pr-20 text-sm font-semibold uppercase transition-colors focus:border-[var(--accent)] focus:outline-none"
      />
      {dirty && (
        <span className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1 text-[9px] font-medium text-[var(--accent)]">
          <CornerDownLeft className="h-3 w-3" />
          Entrée
        </span>
      )}
      {!dirty && saved && (
        // arkyo-server: habillage Strata (succès : --success-text)
        <span className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1 text-[9px] font-medium text-[var(--success-text)]">
          <Check className="h-3 w-3" />
          Enregistré
        </span>
      )}
    </div>
  );
}

// ── PresetChips : grid de boutons mono aérés pour valeurs prédéfinies ───────
// Plus lisible que `Segmented` (qui colle les options dans une mini-barre).
// Auto-grid 3 colonnes (4 si > 6 options), padding généreux, font-mono bold.

function PresetChips({
  value,
  options,
  onChange,
  format,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const cols = options.length > 6 ? "grid-cols-4" : "grid-cols-3";
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase">
        Presets
      </div>
      <div className={cn("grid gap-1.5", cols)}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                "rounded-md border px-2 py-2 text-center font-mono text-[11px] font-semibold transition-all active:scale-95",
                active
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 12 % : --accent-strong)
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)] shadow-sm"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)]",
              )}
            >
              {format ? format(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// useInventaireScope est importé en haut mais utilisé conditionnellement via
// useInventaireScopeOptional — ce ré-export silence un warning si le scope
// n'est jamais touché directement.
void useInventaireScope;
