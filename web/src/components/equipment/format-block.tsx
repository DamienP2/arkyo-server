"use client";

// Composants partagés du bloc « Format » d'un équipement — utilisés à la fois
// par la fiche (`app/(app)/admin/equipment/[id]/_editor/`) et par le wizard de
// création (`components/equipment/new-equipment-wizard.tsx`).
//
// Module volontairement léger (aucune dépendance lourde) pour être importé des
// deux côtés sans alourdir le bundle du wizard :
//   - WidthGlyph      : illustration façade 19" (rails + oreilles + portion occupée)
//   - ModularKindCard : carte à icône (Châssis / Composant, Rackable / Pose libre)
//   - KindChoice      : groupe de 2 cartes à icône (édition) / carte active seule (lecture)

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
type IconType = ComponentType<{ className?: string }>;

const WF_FRACTION: Record<WidthFraction, number> = {
  FULL: 1,
  HALF: 0.5,
  THIRD: 1 / 3,
  QUARTER: 0.25,
};

// ── WidthGlyph — illustration façade 19" ─────────────────────────────────
//
// Mini SVG sobre : deux oreilles de fixation (rectangle + trous) encadrent la
// zone utile ; la portion réellement occupée par l'équipement est remplie
// (currentColor) sur la fraction correspondante, le reste en pointillés.
// Hérite de la couleur du texte de la carte via `currentColor`.

export function WidthGlyph({ fraction }: { fraction: WidthFraction }) {
  const innerX = 10;
  const innerW = 44;
  const occW = innerW * (WF_FRACTION[fraction] ?? 1);
  return (
    <svg viewBox="0 0 64 20" className="h-5 w-16" fill="none" aria-hidden="true">
      {/* Oreilles de fixation gauche / droite */}
      {[1.5, 56.5].map((rx) => (
        <g key={rx}>
          <rect
            x={rx}
            y={2}
            width={6}
            height={16}
            rx={1}
            stroke="currentColor"
            strokeWidth={1}
            opacity={0.55}
          />
          {[5.5, 10, 14.5].map((cy) => (
            <circle
              key={cy}
              cx={rx + 3}
              cy={cy}
              r={0.8}
              fill="currentColor"
              opacity={0.55}
            />
          ))}
        </g>
      ))}
      {/* Zone utile complète (pointillés) */}
      <rect
        x={innerX}
        y={4}
        width={innerW}
        height={12}
        rx={1.5}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 2"
        opacity={0.35}
      />
      {/* Portion occupée (remplie) */}
      <rect
        x={innerX}
        y={4}
        width={occW}
        height={12}
        rx={1.5}
        fill="currentColor"
        opacity={0.85}
      />
    </svg>
  );
}

// ── KindChoice — groupe de 2 cartes à icône (pattern cartes de largeur) ────
//
// Grid 2 colonnes de `ModularKindCard` (icône + libellé + sous-texte,
// `border-2`, active = bordure + texte accent + fond accent/10). Lecture
// pure : seule la carte active est rendue.

export type KindOption<T extends string> = {
  value: T;
  icon: IconType;
  label: string;
  description: string;
};

export function KindChoice<T extends string>({
  options,
  value,
  onChange,
  readOnly,
  compact,
}: {
  options: KindOption<T>[];
  value: T;
  onChange: (v: T) => void;
  readOnly?: boolean;
  /** Variante horizontale dense (h-11, icône à gauche, pas de sous-texte) —
   *  utilisée par le wizard pour tenir sans scroll. La fiche garde le défaut
   *  (cartes verticales). */
  compact?: boolean;
}) {
  if (readOnly) {
    const active = options.find((o) => o.value === value) ?? options[0];
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModularKindCard
          icon={active.icon}
          label={active.label}
          description={active.description}
          active
          readOnly
          compact={compact}
          onClick={() => {}}
        />
      </div>
    );
  }
  return (
    <div className={cn("grid grid-cols-2", compact ? "gap-2" : "gap-3")}>
      {options.map((o) => (
        <ModularKindCard
          key={o.value}
          icon={o.icon}
          label={o.label}
          description={o.description}
          active={o.value === value}
          compact={compact}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}

// ── ModularKindCard — carte à icône ───────────────────────────────────────
//
// Défaut : carte verticale (icône + libellé + sous-texte). `compact` : rangée
// horizontale dense (icône à gauche, libellé seul, ~h-11).

export function ModularKindCard({
  icon: Icon,
  label,
  description,
  active,
  readOnly,
  compact,
  onClick,
}: {
  icon: IconType;
  label: string;
  description: string;
  active: boolean;
  readOnly?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  if (compact) {
    const content = (
      <>
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
            active
              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className={cn(
            "truncate text-xs font-semibold",
            active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
          )}
        >
          {label}
        </span>
      </>
    );
    const compactCls = cn(
      "flex h-11 w-full items-center gap-2.5 rounded-lg border-2 px-3 text-left",
      active
        ? "border-[var(--accent)] bg-[var(--accent)]/10"
        : "border-[var(--border)]",
    );
    if (readOnly) {
      return (
        <div
          role="presentation"
          className={cn(
            compactCls,
            !active && "border-[var(--border)]/40 bg-transparent",
          )}
        >
          {content}
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group transition-all",
          compactCls,
          !active && "hover:bg-[var(--secondary)]",
        )}
      >
        {content}
      </button>
    );
  }

  if (readOnly) {
    return (
      <div
        role="presentation"
        className={cn(
          "flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left",
          active
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : "border-[var(--border)]/40 bg-transparent",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            active
              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
              : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className={cn(
            "text-xs font-semibold",
            active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
          )}
        >
          {label}
        </span>
        <span className="text-[10px] leading-snug text-[var(--muted-foreground)]">
          {description}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border)] hover:bg-[var(--secondary)]",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span
        className={cn(
          "text-xs font-semibold",
          active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
        )}
      >
        {label}
      </span>
      <span className="text-[10px] leading-snug text-[var(--muted-foreground)]">
        {description}
      </span>
    </button>
  );
}
