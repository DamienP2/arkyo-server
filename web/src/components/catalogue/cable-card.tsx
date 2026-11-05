"use client";

/**
 * CableCard — carte cordon partagée par supervisor (CRUD) et tenant (read-only).
 *
 * Présentation pure : pas de fetch, pas de mutation, pas de navigation. Le
 * composant prend une `cable: CableCardItem` (forme stable cf. ./types.ts)
 * + une couleur de section + un éventuel `onClick` (édition) + une zone
 * `actions` (boutons supervisor : delete, propose…). Quand `onClick`/`actions`
 * sont absents → carte read-only.
 *
 * Design extrait de :
 *   app/supervisor/catalog/_components/cables-list-panel.tsx (CableCard inline).
 * Toute modification visuelle ici se répercute partout.
 */

import type { ReactNode } from "react";
import { Cable as CableIcon } from "@/components/ui/icons";

import { Card } from "@/components/ui/card";

import type { CableCardItem, Gender } from "./types";

const GENDER_LABEL: Record<Gender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

type Props = {
  cable: CableCardItem;
  /** Couleur de la card (border-left + bandeau + icône). Vient en général
   *  de la fonction associée (`cable.function.color`). */
  color: string;
  /** Click sur la card entière (édition côté supervisor). Read-only si omis. */
  onClick?: () => void;
  /** Actions supervisor (delete, proposer…) — affichées en haut à droite. */
  actions?: ReactNode;
  /** Mode d'affichage : carte verticale (défaut) ou ligne compacte horizontale. */
  view?: "grid" | "list";
};

export function CableCard({ cable, color, onClick, actions, view = "grid" }: Props) {
  // Libellé longueurs : "X longueurs · coupe 0.5–100 m" (présent seulement si
  // les use-cases sont renseignés côté supervisor). Côté tenant on tombe sur
  // la chaîne par défaut.
  const lengthLabel = (() => {
    const parts: string[] = [];
    if (cable.useCases?.includes("PRESTATION") && (cable.availableLengths?.length ?? 0) > 0) {
      parts.push(`${cable.availableLengths!.length} longueurs`);
    }
    if (
      cable.useCases?.includes("INSTALLATION") &&
      (cable.customMinLength != null || cable.customMaxLength != null)
    ) {
      parts.push(`coupe ${cable.customMinLength ?? 0}–${cable.customMaxLength ?? "∞"} m`);
    }
    return parts.join(" · ") || "Longueurs : héritées";
  })();

  const interactive = Boolean(onClick);

  // ── LIST view : ligne compacte horizontale (pattern aligné sur
  //    EquipmentCard / AdapterCard). ────────────────────────────────────
  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={`group flex items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors ${
          interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
        }`}
        style={{
          borderTopColor: `${color}20`,
          borderRightColor: `${color}20`,
          borderBottomColor: `${color}20`,
          borderLeftColor: color,
          borderLeftWidth: 3,
        }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}20` }}
        >
          <CableIcon className="h-3.5 w-3.5" style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{cable.name}</p>
          <p className="truncate text-[9px] text-[var(--muted-foreground)]">
            <span className="font-mono">
              {cable.leftConnector?.name ?? "—"} {GENDER_LABEL[cable.leftGender]}
            </span>
            <span className="opacity-50"> ↔ </span>
            <span className="font-mono">
              {cable.rightConnector?.name ?? "—"} {GENDER_LABEL[cable.rightGender]}
            </span>
          </p>
        </div>
        {cable.brand?.name && (
          <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
            {cable.brand.name}
          </span>
        )}
        {cable.reference && (
          <span className="shrink-0 font-mono text-[9px] text-[var(--muted-foreground)]">
            {cable.reference}
          </span>
        )}
        {cable.useCases?.map((uc) => (
          <span
            key={uc}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
            style={{ background: `${color}20`, color }}
          >
            {uc === "INSTALLATION" ? "Install." : "Presta"}
          </span>
        ))}
        {actions}
      </div>
    );
  }

  // ── GRID view (défaut) ──────────────────────────────────────────────
  return (
    <Card
      onClick={onClick}
      className={`group flex flex-col overflow-hidden transition-colors ${
        interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
      }`}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div
        className="flex items-start justify-between gap-2 px-4 pt-4 pb-3"
        style={{ background: `${color}08` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color}20` }}
          >
            <CableIcon className="h-4 w-4" style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">{cable.name}</p>
            {cable.reference && (
              <p className="mt-0.5 truncate font-mono text-[10px] font-bold" style={{ color }}>
                {cable.reference}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        {/* Schématisation extrémités — style adaptateurs (trait + 2 points) */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex-1 truncate font-mono font-medium">
            {cable.leftConnector?.name ?? "—"}{" "}
            <span className="opacity-50">{GENDER_LABEL[cable.leftGender]}</span>
          </span>
          <CableLineSvg />
          <span className="flex-1 truncate text-right font-mono font-medium">
            <span className="opacity-50">{GENDER_LABEL[cable.rightGender]}</span>{" "}
            {cable.rightConnector?.name ?? "—"}
          </span>
        </div>

        {/* Use cases + marque */}
        <div className="flex flex-wrap items-center gap-1">
          {cable.useCases?.map((uc) => (
            <span
              key={uc}
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
              style={{ backgroundColor: `${color}15`, color }}
            >
              {uc === "INSTALLATION" ? "Installation" : "Prestation"}
            </span>
          ))}
          {cable.brand && (
            <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--muted-foreground)]">
              {cable.brand.name}
              {cable.model ? ` ${cable.model}` : ""}
            </span>
          )}
        </div>

        <p className="truncate text-[10px] text-[var(--muted-foreground)]">{lengthLabel}</p>
      </div>
    </Card>
  );
}

// Schématisation cordon — 2 cercles aux extrémités reliés par un trait. Pas de
// flèche directionnelle (un cordon n'a pas d'orientation intrinsèque).
function CableLineSvg() {
  const VW = 36;
  const H = 12;
  const cy = H / 2;
  return (
    <svg
      viewBox={`0 0 ${VW} ${H}`}
      className="shrink-0"
      style={{ height: H, width: VW }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <line
        x1={3}
        y1={cy}
        x2={VW - 3}
        y2={cy}
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.55}
      />
      <circle cx={3} cy={cy} r={3} fill="var(--accent)" opacity={0.65} />
      <circle cx={VW - 3} cy={cy} r={3} fill="var(--accent)" opacity={0.65} />
    </svg>
  );
}
