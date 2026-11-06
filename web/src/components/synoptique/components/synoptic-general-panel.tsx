"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Grid3x3,
  Magnet,
  MapPin,
  Map,
  SplitSquareHorizontal,
  ListChecks,
  Keyboard,
  HelpCircle,
  Weight,
  Zap,
  Trash2,
  CornerDownLeft,
  Check,
} from "@/components/ui/icons";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import { SynopticShortcutsModal } from "./synoptic-shortcuts-modal";
import { SynopticHelpModal } from "./synoptic-help-modal";
import { cn } from "@/lib/utils";
import { InfoCard, ActionButton } from "./property-patterns";

const PORT_H = 28;
const STEP_MULTIPLIERS = [1, 2, 4] as const;
const MAJOR_CHOICES = [2, 4, 8] as const;
const COLOR_PRESETS = [
  "#6366f1",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];

type Props = {
  rackName: string;
  rackType?: string;
  totalU?: number;
  totalWeightKg: number;
  totalPowerW: number;
  onRackNameChange?: (name: string) => void;
};

const RACK_TYPE_LABELS: Record<string, string> = {
  STANDARD: "Baie",
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "Flight case SKB",
  PELICAN: "Pelicase",
  CAP: "Casquette",
};

// ── Petits helpers ──────────────────────────────────────────────────────────
export function Switch({
  checked,
  onChange,
  onClick,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
        onChange?.(!checked);
      }}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  formatter,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  formatter?: (v: T) => string;
}) {
  return (
    <div
      className="bg-muted grid gap-0.5 rounded-md p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((v) => {
        const active = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "rounded px-2 py-1 text-[11px] transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {formatter ? formatter(v) : String(v)}
          </button>
        );
      })}
    </div>
  );
}

function ColorSwatches({
  value,
  onChange,
  allowNull = false,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  allowNull?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNull && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-black/10",
            value == null ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-110",
          )}
          style={{ background: "transparent" }}
          title="Par défaut"
        >
          <span className="block h-3 w-3 rounded-full bg-[var(--accent)]" />
        </button>
      )}
      {COLOR_PRESETS.map((c) => {
        const active = (value ?? "").toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform",
              active ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-110",
            )}
            style={{ background: c }}
            title={c}
          />
        );
      })}
      <label
        className="ring-dashed ring-border relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 hover:ring-[var(--accent)]"
        title="Couleur personnalisée"
      >
        <input
          type="color"
          value={value ?? "#6366f1"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <div
          className="h-full w-full"
          style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
        />
      </label>
    </div>
  );
}

// ── Row collapsible avec icône ──────────────────────────────────────────────
export function OptionRow({
  icon: Icon,
  label,
  checked,
  onToggle,
  expandable = true,
  children,
  onButton,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked?: boolean;
  onToggle?: (v: boolean) => void;
  expandable?: boolean;
  onButton?: () => void;
  children?: React.ReactNode;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const isExpandable = expandable && !!children && (checked === undefined || checked);
  const clickable = !!onButton || isExpandable;
  return (
    <div className="border-border bg-card rounded-md border">
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-2 text-[11px] select-none",
          clickable && "hover:bg-muted/40 cursor-pointer",
        )}
        onClick={() => {
          if (onButton) onButton();
          else if (isExpandable) setOpen((v) => !v);
        }}
      >
        <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 font-medium">{label}</span>
        {badge !== undefined && (
          <span className="text-muted-foreground font-mono text-[10px]">{badge}</span>
        )}
        {onToggle !== undefined && checked !== undefined && (
          <Switch checked={checked} onChange={onToggle} />
        )}
        {isExpandable && (
          <ChevronRight
            className={cn(
              "text-muted-foreground h-3.5 w-3.5 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </div>
      {isExpandable && open && (
        <div className="border-border flex flex-col gap-3 border-t px-2.5 py-2.5">{children}</div>
      )}
    </div>
  );
}

export function NameInput({
  rackName,
  onRackNameChange,
}: {
  rackName: string;
  onRackNameChange?: (name: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
  // `saved` flashe pendant 1.5s après une sauvegarde réussie pour confirmer
  // visuellement que le nom a été persisté (l'utilisateur ne voit sinon rien
  // changer puisque l'input passe en blur sans feedback).
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Synchronise la valeur DOM avec la prop `rackName` quand elle change
  // depuis l'extérieur (ex: l'utilisateur sélectionne un autre slot dans le
  // rack-editor). Sans cela, l'input non-contrôlé conserve l'ancienne valeur
  // et au prochain blur il PROPAGE cette ancienne valeur sur le nouveau slot.
  // On évite l'écrasement quand l'input est focus pour ne pas tuer la frappe
  // en cours.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== rackName) {
      el.value = rackName;
      setDirty(false);
    }
  }, [rackName]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return (
    <div className="relative mb-2">
      <input
        ref={inputRef}
        type="text"
        defaultValue={rackName}
        onChange={(e) => {
          e.target.value = e.target.value.toUpperCase();
          setDirty(e.target.value.trim() !== rackName);
          if (saved) setSaved(false);
        }}
        onBlur={(e) => {
          const v = e.target.value.trim().toUpperCase();
          if (v && v !== rackName) {
            onRackNameChange?.(v);
            // Affiche le badge "Enregistré" pendant 1.5s. La sauvegarde
            // côté parent est fire-and-forget : on assume succès optimiste.
            setSaved(true);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
          }
          setDirty(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = rackName;
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
      {!dirty && saved && ( // arkyo-server: habillage Strata
        <span className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1 text-[9px] font-medium text-[var(--success-text)]">
          <Check className="h-3 w-3" />
          Enregistré
        </span>
      )}
    </div>
  );
}

// ── Panneau principal ───────────────────────────────────────────────────────
export function SynopticGeneralPanel({
  rackName,
  rackType,
  totalU,
  totalWeightKg,
  totalPowerW,
  onRackNameChange,
}: Props) {
  const gridEnabled = useTopbarActions((s) => s.gridEnabled);
  const gridStep = useTopbarActions((s) => s.gridStep);
  const snapEnabled = useTopbarActions((s) => s.snapEnabled);
  const guidesVisible = useTopbarActions((s) => s.guidesVisible);
  const setGridEnabled = useTopbarActions((s) => s.setGridEnabled);
  const setGridStep = useTopbarActions((s) => s.setGridStep);
  const setSnapEnabled = useTopbarActions((s) => s.setSnapEnabled);
  const setGuidesVisible = useTopbarActions((s) => s.setGuidesVisible);
  const guideDefaultColor = useTopbarActions((s) => s.guideDefaultColor);
  const setGuideDefaultColor = useTopbarActions((s) => s.setGuideDefaultColor);
  const gridMajorEvery = useTopbarActions((s) => s.gridMajorEvery);
  const gridColor = useTopbarActions((s) => s.gridColor);
  const gridOpacity = useTopbarActions((s) => s.gridOpacity);
  const setGridMajorEvery = useTopbarActions((s) => s.setGridMajorEvery);
  const setGridColor = useTopbarActions((s) => s.setGridColor);
  const setGridOpacity = useTopbarActions((s) => s.setGridOpacity);
  const guidesCount = useTopbarActions((s) => s.synopticGuidesCount);
  const onClearGuides = useTopbarActions((s) => s.onClearSynopticGuides);
  const miniMap = useTopbarActions((s) => s.miniMapByWs.synoptic);
  const legendVisible = useTopbarActions((s) => s.synopticLegendVisible);
  const onToggleLegend = useTopbarActions((s) => s.onToggleSynopticLegend);
  const cableSpreadEnabled = useTopbarActions((s) => s.cableSpreadEnabled);
  const setCableSpreadEnabled = useTopbarActions((s) => s.setCableSpreadEnabled);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const currentMultiplier = Math.max(1, Math.round(gridStep / PORT_H));
  const opacityPct = Math.round(gridOpacity * 100);

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* En-tête rack */}
      <div>
        <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
          {RACK_TYPE_LABELS[rackType ?? "STANDARD"] ?? "Baie"}
          {totalU ? ` (${totalU}U)` : ""}
        </div>
        <NameInput rackName={rackName} onRackNameChange={onRackNameChange} />
        <div className="flex gap-2">
          <InfoCard
            icon={<Weight className="h-4 w-4" />}
            label="Poids"
            value={totalWeightKg > 0 ? `${totalWeightKg.toFixed(1)} kg` : "—"}
            className="flex-1"
          />
          <InfoCard
            icon={<Zap className="h-4 w-4" />}
            label="Conso"
            value={totalPowerW > 0 ? `${totalPowerW} W` : "—"}
            className="flex-1"
          />
        </div>
      </div>

      {/* Liste d'options d'affichage */}
      <div className="flex flex-col gap-1.5">
        <OptionRow
          icon={Grid3x3}
          label="Grille"
          checked={gridEnabled}
          onToggle={setGridEnabled}
          badge={`${currentMultiplier * PORT_H}px`}
        >
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-muted-foreground text-[10px]">Pas</div>
              <div
                className="text-muted-foreground text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {currentMultiplier * PORT_H}px
              </div>
            </div>
            <Segmented
              value={currentMultiplier}
              options={STEP_MULTIPLIERS}
              onChange={(m) => setGridStep(m * PORT_H)}
              formatter={(m) => `${m}×`}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-muted-foreground text-[10px]">Groupe</div>
              <div
                className="text-muted-foreground text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                tous les {gridMajorEvery}
              </div>
            </div>
            <Segmented
              value={gridMajorEvery}
              options={MAJOR_CHOICES}
              onChange={setGridMajorEvery}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px]">Couleur</div>
            <ColorSwatches value={gridColor} onChange={(c) => setGridColor(c ?? "#808080")} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-muted-foreground text-[10px]">Opacité</div>
              <div
                className="text-muted-foreground text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {opacityPct}%
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={gridOpacity}
              onChange={(e) => setGridOpacity(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </OptionRow>

        <OptionRow
          icon={Magnet}
          label="Snap sur la grille"
          checked={snapEnabled}
          onToggle={setSnapEnabled}
          expandable={false}
        />

        <OptionRow
          icon={MapPin}
          label="Repères"
          checked={guidesVisible}
          onToggle={setGuidesVisible}
          badge={guidesCount > 0 ? guidesCount : undefined}
        >
          <div>
            <div className="text-muted-foreground mb-1.5 text-[10px]">Nouvelle couleur</div>
            <ColorSwatches
              value={guideDefaultColor ?? null}
              onChange={setGuideDefaultColor}
              allowNull
            />
          </div>
          {guidesCount > 0 && (
            <ActionButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Effacer tous les repères"
              onClick={() => onClearGuides?.()}
              danger
            />
          )}
        </OptionRow>

        {miniMap.onToggle && (
          <OptionRow
            icon={Map}
            label="Mini-map"
            checked={miniMap.visible}
            onToggle={() => miniMap.onToggle?.()}
            expandable={false}
          />
        )}

        <OptionRow
          icon={SplitSquareHorizontal}
          label="Séparer les câbles parallèles"
          checked={cableSpreadEnabled}
          onToggle={setCableSpreadEnabled}
          expandable={false}
        />

        {onToggleLegend && (
          <OptionRow
            icon={ListChecks}
            label="Légende"
            checked={legendVisible}
            onToggle={() => onToggleLegend?.()}
            expandable={false}
          />
        )}

        <div className="text-muted-foreground mt-2 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase">
          Actions
        </div>
        <ActionButton
          icon={<Keyboard className="h-3.5 w-3.5" />}
          label="Raccourcis clavier"
          onClick={() => setShowShortcuts(true)}
        />
        <ActionButton
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          label="Aide générale"
          onClick={() => setShowHelp(true)}
        />
      </div>

      <SynopticShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <SynopticHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
