"use client";

/**
 * rack-wizard-steps — composants d'étape + état partagés pour les wizards de
 * configuration d'un contenant.
 *
 * Extrait depuis `components/racks/new-rack-wizard.tsx` pour être consommé par
 * les DEUX wizards qui configurent un contenant :
 *   - `NewRackWizard` (création d'un template depuis /templates)
 *   - `NewProjectDialog` (étapes « premier contenant » lors de la création d'un
 *      projet)
 *
 * Le module fournit :
 *   - Les constantes de types de contenant (labels, couleurs, images, flags)
 *   - Le hook d'état `useRackConfig` + `buildRackPayload` (payload API)
 *   - `buildContainerStepIds(flight, isRackable)` — ordre dynamique des étapes
 *   - Les bodies d'étape : Type / Name / Rackable / Dimensions / Wheels /
 *     Weight / Rails
 *
 * Aucune étape intro ni summary ici — chaque wizard gère son propre accueil et
 * son propre récapitulatif.
 */

import { useState } from "react";
import { Check, Package, Server } from "@/components/ui/icons";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RangeInput } from "@/components/wizard/range-input";
import { WizardStepHeader } from "@/components/wizard/wizard-backdrop";
import { cn } from "@/lib/utils";

// ── Types de contenant ────────────────────────────────────────────────────────

export type RackType =
  | "STANDARD"
  | "FLIGHT_CASE_CLASSIC"
  | "FLIGHT_CASE_SKB"
  | "PELICAN"
  | "CAP";

export const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: 'Baie standard 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

export const RACK_TYPE_COLOR: Record<RackType, string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

export const RACK_TYPE_IMAGE: Record<RackType, string> = {
  STANDARD: "/containers/baie.png",
  FLIGHT_CASE_CLASSIC: "/containers/flightcase_rack-roulettes.png",
  FLIGHT_CASE_SKB: "/containers/SKB.png",
  PELICAN: "/containers/pelicase.png",
  CAP: "/containers/casquette_meuble.png",
};

export const RACK_TYPE_RACKABLE: Record<RackType, boolean> = {
  STANDARD: true,
  FLIGHT_CASE_CLASSIC: true,
  FLIGHT_CASE_SKB: true,
  PELICAN: false,
  CAP: false,
};

export const RACK_TYPE_FLIGHT: Record<RackType, boolean> = {
  STANDARD: false,
  FLIGHT_CASE_CLASSIC: true,
  FLIGHT_CASE_SKB: true,
  PELICAN: true,
  CAP: false,
};

export const RACK_TYPE_ORDER: RackType[] = [
  "STANDARD",
  "FLIGHT_CASE_CLASSIC",
  "FLIGHT_CASE_SKB",
  "PELICAN",
  "CAP",
];

export const U_PRESETS_FALLBACK = [6, 9, 12, 18, 24, 30, 36, 42, 45, 48];

// ── État partagé ──────────────────────────────────────────────────────────────

export type RackConfig = {
  rackType: RackType;
  name: string;
  isRackable: boolean;
  totalU: number;
  depthMm: number;
  widthMm: number;
  heightMm: number;
  hasWheels: boolean;
  emptyWeightKg: number;
  hasRearInterior: boolean;
  rearGap: number;
};

export const DEFAULT_RACK_CONFIG: RackConfig = {
  rackType: "STANDARD",
  name: "",
  isRackable: true,
  totalU: 42,
  depthMm: 600,
  widthMm: 600,
  heightMm: 400,
  hasWheels: false,
  emptyWeightKg: 0,
  hasRearInterior: false,
  rearGap: 50,
};

/**
 * Payload API d'un contenant — compatible avec :
 *   - POST /api/racks (template)
 *   - POST /api/tenant/projects/{id}/racks (élément `racks[]`)
 */
export type RackPayload = {
  name: string;
  rackType: RackType;
  isRackable: boolean;
  depthMm: number;
  totalU: number;
  widthMm?: number;
  heightMm?: number;
  hasWheels?: boolean;
  emptyWeightKg?: number;
  rearInteriorGapMm?: number;
};

/** Construit le payload API à partir de l'état courant. */
export function buildRackPayload(config: RackConfig): RackPayload {
  const flight = RACK_TYPE_FLIGHT[config.rackType];
  return {
    name: config.name.trim(),
    rackType: config.rackType,
    isRackable: config.isRackable,
    depthMm: config.depthMm,
    totalU: config.isRackable ? config.totalU : 1,
    ...(config.isRackable
      ? {}
      : { widthMm: config.widthMm, heightMm: config.heightMm }),
    ...(flight ? { hasWheels: config.hasWheels } : {}),
    ...(config.emptyWeightKg > 0 ? { emptyWeightKg: config.emptyWeightKg } : {}),
    ...(config.isRackable && config.hasRearInterior
      ? { rearInteriorGapMm: config.rearGap }
      : {}),
  };
}

/**
 * Hook d'état d'un contenant. Fournit la config, un setter typé par clé, un
 * reset et les dérivés `flight` / `payload`.
 */
export function useRackConfig(overrides?: Partial<RackConfig>) {
  const initial = { ...DEFAULT_RACK_CONFIG, ...overrides };
  const [config, setConfig] = useState<RackConfig>(initial);

  const update = <K extends keyof RackConfig>(key: K, value: RackConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const reset = () => setConfig({ ...DEFAULT_RACK_CONFIG, ...overrides });

  /**
   * Applique un type de contenant en synchronisant les valeurs dérivées
   * (rackable par défaut du type, désactivation des roulettes si non-flight).
   */
  const pickType = (t: RackType) =>
    setConfig((c) => ({
      ...c,
      rackType: t,
      isRackable: RACK_TYPE_RACKABLE[t],
      hasWheels: RACK_TYPE_FLIGHT[t] ? c.hasWheels : false,
    }));

  const flight = RACK_TYPE_FLIGHT[config.rackType];

  return { config, update, setConfig, reset, pickType, flight };
}

// ── Ordre dynamique des étapes contenant ──────────────────────────────────────

export type ContainerStepId =
  | "type"
  | "name"
  | "rackable"
  | "dimensions"
  | "wheels"
  | "weight"
  | "rails";

/**
 * Ordre des étapes de configuration d'un contenant selon le type
 * (`flight` = roulettes applicables) et `isRackable` (rails applicables).
 * N'inclut ni intro ni summary — ceux-ci sont propres à chaque wizard.
 */
export function buildContainerStepIds(
  flight: boolean,
  isRackable: boolean,
): ContainerStepId[] {
  const ids: ContainerStepId[] = ["type", "name", "rackable", "dimensions"];
  if (flight) ids.push("wheels");
  ids.push("weight");
  if (isRackable) ids.push("rails");
  return ids;
}

// ── Étapes ────────────────────────────────────────────────────────────────────

export function RackTypeStep({
  current,
  onSelect,
}: {
  current: RackType;
  onSelect: (t: RackType) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quel type de contenant ?"
        subtitle="Sélectionnez la forme physique du contenant."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-3 sm:grid-cols-5">
        {RACK_TYPE_ORDER.map((t) => {
          const selected = current === t;
          const color = RACK_TYPE_COLOR[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "group relative flex h-36 flex-col items-center justify-center gap-2 rounded-xl border bg-[var(--card)] p-3 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <span
                className={cn(
                  "absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                  selected
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-50 opacity-0",
                )}
              >
                <Check className="h-3 w-3" />
              </span>
              <div
                className="flex h-14 w-14 items-center justify-center rounded-lg bg-white p-1 dark:bg-white/95"
                style={{
                  boxShadow: selected ? `inset 0 0 0 1px ${color}40` : undefined,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={RACK_TYPE_IMAGE[t]}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="text-center text-[11px] leading-tight font-medium text-[var(--foreground)]">
                {RACK_TYPE_LABEL[t]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RackNameStep({
  rackType,
  value,
  onChange,
  error,
}: {
  rackType: RackType;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const placeholder = (() => {
    switch (rackType) {
      case "STANDARD":
        return "Ex. Baie A — Vidéo";
      case "FLIGHT_CASE_CLASSIC":
      case "FLIGHT_CASE_SKB":
        return "Ex. Flight case audio";
      case "PELICAN":
        return "Ex. Pelicase HF";
      case "CAP":
        return "Ex. Meuble régie";
    }
  })();
  return (
    <div>
      <WizardStepHeader
        title="Comment s'appelle ce contenant ?"
        subtitle="Choisissez un nom clair pour le retrouver facilement."
      />
      <div className="mx-auto max-w-lg">
        <FormField label="Nom du contenant" required error={error}>
          <Input
            autoFocus
            className="h-11 text-sm"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}

export function RackRackableStep({
  current,
  onSelect,
}: {
  current: boolean;
  onSelect: (v: boolean) => void;
}) {
  const options: {
    value: boolean;
    title: string;
    description: string;
    icon: typeof Server;
    color: string;
  }[] = [
    {
      value: true,
      title: 'Rackable (19")',
      description:
        'Le contenant accueille des équipements 19" sur des rails standards.',
      icon: Server,
      color: "#3b82f6",
    },
    {
      value: false,
      title: "Non rackable",
      description:
        "Caisson de transport simple — pas de placement physique en U.",
      icon: Package,
      color: "#06b6d4",
    },
  ];

  return (
    <div>
      <WizardStepHeader
        title="Le contenant est-il rackable ?"
        subtitle="Détermine si vous pourrez placer des équipements 19'' à l'intérieur."
      />
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {options.map((opt) => {
          const selected = current === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value ? "rackable" : "non-rackable"}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                "group relative flex h-52 flex-col items-center justify-center rounded-2xl border bg-[var(--card)] p-5 text-center shadow-sm transition-all duration-200",
                selected
                  ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
                  : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
                  selected
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-50 opacity-0",
                )}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
                style={{
                  backgroundColor: `${opt.color}14`,
                  color: opt.color,
                }}
              >
                <Icon className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                {opt.title}
              </p>
              <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RackDimensionsStep({
  isRackable,
  totalU,
  setTotalU,
  depthMm,
  setDepthMm,
  widthMm,
  setWidthMm,
  heightMm,
  setHeightMm,
  uPresets,
}: {
  isRackable: boolean;
  totalU: number;
  setTotalU: (v: number) => void;
  depthMm: number;
  setDepthMm: (v: number) => void;
  widthMm: number;
  setWidthMm: (v: number) => void;
  heightMm: number;
  setHeightMm: (v: number) => void;
  uPresets: number[];
}) {
  return (
    <div>
      <WizardStepHeader
        title={
          isRackable ? "Quelles dimensions ?" : "Quelles dimensions externes ?"
        }
        subtitle={
          isRackable
            ? 'Hauteur en U (rack 19") et profondeur intérieure.'
            : "Longueur, largeur et profondeur externes du caisson."
        }
      />
      <div className="mx-auto max-w-xl space-y-5">
        {isRackable ? (
          <>
            <FormField label={`Hauteur — ${totalU}U`}>
              <div className="grid grid-cols-5 gap-1.5">
                {uPresets.map((u) => (
                  <RackPillButton
                    key={u}
                    active={totalU === u}
                    onClick={() => setTotalU(u)}
                  >
                    {u}U
                  </RackPillButton>
                ))}
              </div>
            </FormField>
            <FormField label={`Profondeur — ${depthMm} mm`}>
              <RangeInput
                min={200}
                max={1200}
                step={10}
                value={depthMm}
                onChange={setDepthMm}
              />
            </FormField>
          </>
        ) : (
          <>
            <FormField label={`Longueur — ${widthMm} mm`}>
              <RangeInput
                min={100}
                max={1500}
                step={10}
                value={widthMm}
                onChange={setWidthMm}
              />
            </FormField>
            <FormField label={`Largeur — ${heightMm} mm`}>
              <RangeInput
                min={100}
                max={1500}
                step={10}
                value={heightMm}
                onChange={setHeightMm}
              />
            </FormField>
            <FormField label={`Profondeur — ${depthMm} mm`}>
              <RangeInput
                min={100}
                max={1500}
                step={10}
                value={depthMm}
                onChange={setDepthMm}
              />
            </FormField>
          </>
        )}
      </div>
    </div>
  );
}

export function RackWheelsStep({
  hasWheels,
  setHasWheels,
}: {
  hasWheels: boolean;
  setHasWheels: (v: boolean) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Le contenant est-il sur roulettes ?"
        subtitle="Indispensable pour estimer la mobilité et le poids roulant."
      />
      <div className="mx-auto max-w-md">
        <div className="grid grid-cols-2 gap-3">
          <BigToggleCard
            active={!hasWheels}
            onClick={() => setHasWheels(false)}
            label="Non"
            description="Posé au sol — pas de mobilité."
          />
          <BigToggleCard
            active={hasWheels}
            onClick={() => setHasWheels(true)}
            label="Oui"
            description="Sur roulettes — déplaçable à plein."
          />
        </div>
      </div>
    </div>
  );
}

export function RackWeightStep({
  emptyWeightKg,
  setEmptyWeightKg,
}: {
  emptyWeightKg: number;
  setEmptyWeightKg: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Quel est le poids à vide ?"
        subtitle="Optionnel — permet d'estimer le poids total une fois équipé."
      />
      <div className="mx-auto max-w-md space-y-3">
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] px-4 py-5 text-center shadow-sm">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Poids à vide
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
            {emptyWeightKg > 0 ? (
              <>
                {emptyWeightKg}
                <span className="ml-1 text-lg font-medium text-[var(--muted-foreground)]">
                  kg
                </span>
              </>
            ) : (
              <span className="text-lg italic text-[var(--muted-foreground)]/60">
                non défini
              </span>
            )}
          </p>
        </div>
        <div>
          <RangeInput
            min={0}
            max={100}
            step={1}
            value={emptyWeightKg}
            onChange={setEmptyWeightKg}
          />
          <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
            <span>0 kg</span>
            <span>100 kg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RackRailsStep({
  hasRearInterior,
  setHasRearInterior,
  rearGap,
  setRearGap,
}: {
  hasRearInterior: boolean;
  setHasRearInterior: (v: boolean) => void;
  rearGap: number;
  setRearGap: (v: number) => void;
}) {
  return (
    <div>
      <WizardStepHeader
        title="Y a-t-il des rails arrière internes ?"
        subtitle="Rails additionnels en retrait du fond — utiles pour racker des éléments peu profonds en gardant de l'espace de câblage derrière."
      />
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <BigToggleCard
            active={!hasRearInterior}
            onClick={() => setHasRearInterior(false)}
            label="Non"
            description="Pas de rails internes additionnels."
          />
          <BigToggleCard
            active={hasRearInterior}
            onClick={() => setHasRearInterior(true)}
            label="Oui"
            description="Rails additionnels en retrait du fond."
          />
        </div>

        {hasRearInterior && (
          <div className="grid grid-cols-1 gap-5 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-4 shadow-sm sm:grid-cols-2">
            {/* Colonne gauche : slider */}
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                  Distance fond → rails
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                  {rearGap}
                  <span className="ml-1 text-base font-medium text-[var(--muted-foreground)]">
                    mm
                  </span>
                </p>
              </div>
              <div>
                <RangeInput
                  min={20}
                  max={300}
                  step={5}
                  value={rearGap}
                  onChange={setRearGap}
                />
                <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
                  <span>20 mm</span>
                  <span>300 mm</span>
                </div>
              </div>
            </div>

            {/* Colonne droite : schéma visuel */}
            <div className="flex items-center justify-center">
              <RearInteriorIllustration rearGapMm={rearGap} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * RearInteriorIllustration — schéma simplifié d'un rack vu de dessus, montrant
 * la distance entre le fond et les rails arrière internes. Cote synchronisée
 * en temps réel avec `rearGapMm` (20-300mm → 14-72px à l'écran).
 */
function RearInteriorIllustration({ rearGapMm }: { rearGapMm: number }) {
  const minMm = 20;
  const maxMm = 300;
  const minPx = 14;
  const maxPx = 72;
  const ratio =
    (Math.max(minMm, Math.min(maxMm, rearGapMm)) - minMm) / (maxMm - minMm);
  const gapPx = minPx + ratio * (maxPx - minPx);

  const W = 220;
  const H = 110;
  const padX = 14;
  const padY = 18;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;
  const frontX = padX + 6;
  const rearX = padX + innerW - 6;
  const internalX = rearX - gapPx;
  const railTop = padY + 8;
  const railBot = padY + innerH - 8;

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="text-[var(--muted-foreground)]"
        aria-hidden
      >
        <rect
          x={padX}
          y={padY}
          width={innerW}
          height={innerH}
          rx={3}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          opacity={0.6}
        />
        <text
          x={frontX - 2}
          y={padY - 4}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
          fontFamily="ui-monospace, monospace"
        >
          AVANT
        </text>
        <text
          x={rearX - 22}
          y={padY - 4}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
          fontFamily="ui-monospace, monospace"
        >
          ARRIÈRE
        </text>
        <line
          x1={frontX}
          y1={railTop}
          x2={frontX}
          y2={railBot}
          stroke="currentColor"
          strokeWidth={2.5}
          opacity={0.85}
        />
        <line
          x1={rearX}
          y1={railTop}
          x2={rearX}
          y2={railBot}
          stroke="currentColor"
          strokeWidth={2.5}
          opacity={0.85}
        />
        <line
          x1={internalX}
          y1={railTop}
          x2={internalX}
          y2={railBot}
          stroke="var(--accent)"
          strokeWidth={2.5}
        />
        <line
          x1={internalX}
          y1={railBot + 8}
          x2={rearX}
          y2={railBot + 8}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={internalX}
          y1={railBot + 4}
          x2={internalX}
          y2={railBot + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <line
          x1={rearX}
          y1={railBot + 4}
          x2={rearX}
          y2={railBot + 12}
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <text
          x={(internalX + rearX) / 2}
          y={railBot + 22}
          fontSize={9}
          fill="var(--accent)"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          {rearGapMm} mm
        </text>
      </svg>
      <p className="text-center text-[10px] leading-tight text-[var(--muted-foreground)]">
        <span className="font-mono font-bold text-[var(--accent)]">━━━</span> rails
        internes ·{" "}
        <span className="font-mono font-bold opacity-70">━━━</span> rails avant/fond
      </p>
    </div>
  );
}

function BigToggleCard({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-32 flex-col items-center justify-center rounded-2xl border bg-[var(--card)] p-4 text-center shadow-sm transition-all duration-200",
        active
          ? "border-[var(--accent)] -translate-y-0.5 bg-[var(--accent)]/5 shadow-md ring-2 ring-[var(--accent)]/20"
          : "border-[var(--border)]/60 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:shadow-md",
      )}
    >
      <span
        className={cn(
          "absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm transition-all duration-200",
          active
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-50 opacity-0",
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <p className="text-base font-semibold text-[var(--foreground)]">{label}</p>
      <p className="mt-1.5 max-w-[220px] text-[11px] leading-snug text-[var(--muted-foreground)]">
        {description}
      </p>
    </button>
  );
}

function RackPillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border-2 px-2 text-[11px] font-bold transition-all",
        active
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
      )}
    >
      {children}
    </button>
  );
}
