"use client";

/**
 * Schéma de principe d'un équipement (interface Strata) : entrées à gauche,
 * sorties à droite, entrées/sorties dessous, énergie au-dessus.
 *
 * Porté de la maquette approuvée (`catalogue.js`, `blockSVG`). Dessiné aux
 * couleurs de l'interface (il suit le thème) ; la couleur du signal n'est
 * qu'un repère carré de 6 px, l'accent ne marque que l'entrée survolée.
 */

import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import type { DrawingConnectorType, DrawingSignal } from "./face-layout";
import { portCount } from "./face-layout";
import { FONT_MONO, FONT_SANS, catalogIndex, genderLetter } from "./equipment-face";

type Side = "in" | "out" | "both" | "power";

export type BlockDiagramProps = {
  connectors: readonly ConnectorEntry[];
  connectorTypes?: readonly DrawingConnectorType[];
  signals?: readonly DrawingSignal[];
  name?: string;
  brand?: string | null;
  is2110?: boolean | null;
  hoverEntry?: number | null;
  onEntryHover?: (entryIndex: number | null) => void;
  className?: string;
};

const v = (name: string) => `var(--${name})`;
const W = 760;
const BW = 180;
const BX = (W - BW) / 2;
const BY = 30;
const ROW_H = 20;

export function BlockDiagram({
  connectors,
  connectorTypes,
  signals,
  name,
  brand,
  is2110,
  hoverEntry,
  onEntryHover,
  className,
}: BlockDiagramProps) {
  const cat = catalogIndex(connectorTypes, signals);
  const items = connectors.map((p, ei) => {
    const side: Side = cat.signal(p.signalName)?.isPower
      ? "power"
      : p.direction === "IN"
        ? "in"
        : p.direction === "OUT"
          ? "out"
          : "both";
    return { p, ei, side };
  });
  const of = (s: Side) => items.filter((it) => it.side === s);
  const IN = of("in");
  const OUT = of("out");
  const BI = of("both");
  const PWR = of("power");
  const n = Math.max(IN.length, OUT.length, 1);
  const bh = Math.max(64, n * ROW_H + 20);
  const H = BY + bh + (BI.length ? 22 + Math.ceil(BI.length / 2) * ROW_H : 10);

  const conn = (p: ConnectorEntry) => `${cat.type(p.connectorTypeId)?.name ?? "—"} ${genderLetter(p.gender)}`;
  const markColor = (p: ConnectorEntry) => cat.signal(p.signalName)?.color ?? v("text-tertiary");
  const hoverProps = (ei: number) =>
    onEntryHover ? { onMouseEnter: () => onEntryHover(ei), onMouseLeave: () => onEntryHover(null) } : {};

  const label = (p: ConnectorEntry, x: number, y: number, anchor: "start" | "end") => (
    <text
      x={x}
      y={y + 3.5}
      textAnchor={anchor}
      fontSize={10.5}
      style={{ fill: v("foreground"), fontFamily: FONT_SANS, whiteSpace: "pre" }}
    >
      {p.label || p.signalName}
      <tspan fontSize={9.5} style={{ fill: v("text-tertiary"), fontFamily: FONT_MONO }}>
        {`  ×${portCount(p)}  ${conn(p)}`}
      </tspan>
    </text>
  );
  const mark = (x: number, y: number, p: ConnectorEntry) => (
    <rect x={x - 3} y={y - 3} width={6} height={6} style={{ fill: markColor(p) }} />
  );

  const side = (arr: typeof items, left: boolean) =>
    arr.map((it, i) => {
      const y = BY + bh / 2 - ((arr.length - 1) * ROW_H) / 2 + i * ROW_H;
      const hov = hoverEntry === it.ei;
      const xe = left ? BX : BX + BW;
      const xo = left ? BX - 44 : BX + BW + 44;
      const ax = left ? xe : xo;
      return (
        <g key={it.ei} data-entry={it.ei} data-side={it.side} data-hover={hov ? "" : undefined} {...hoverProps(it.ei)}>
          <line
            x1={xo}
            y1={y}
            x2={xe}
            y2={y}
            style={{ stroke: v(hov ? "accent" : "text-tertiary"), strokeWidth: hov ? 1.6 : 1 }}
          />
          <path
            d={`M${ax - 5} ${y - 3} L${ax} ${y} L${ax - 5} ${y + 3}`}
            style={{ fill: "none", stroke: v("text-tertiary"), strokeWidth: 1 }}
          />
          {mark(xo + (left ? -8 : 8), y, it.p)}
          {label(it.p, xo + (left ? -16 : 16), y, left ? "end" : "start")}
        </g>
      );
    });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={name ? `Schéma de principe ${name}` : "Schéma de principe"}
      className={className}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <rect
        x={BX}
        y={BY}
        width={BW}
        height={bh}
        rx={3}
        style={{ fill: v("surface-raised"), stroke: v("border-strong"), strokeWidth: 1 }}
      />
      {name && (
        <text x={BX + 12} y={BY + 18} fontSize={12} fontWeight={600} style={{ fill: v("foreground"), fontFamily: FONT_SANS }}>
          {name}
        </text>
      )}
      {brand && (
        <text x={BX + 12} y={BY + 32} fontSize={10} style={{ fill: v("text-tertiary"), fontFamily: FONT_SANS }}>
          {brand}
        </text>
      )}
      {is2110 && (
        <text
          x={BX + BW - 10}
          y={BY + bh - 9}
          textAnchor="end"
          fontSize={9}
          style={{ fill: v("text-tertiary"), fontFamily: FONT_MONO }}
        >
          ST 2110
        </text>
      )}
      {side(IN, true)}
      {side(OUT, false)}
      {PWR.map((it, i) => {
        const x = BX + 24 + i * 110;
        return (
          <g key={it.ei} data-entry={it.ei} data-side="power" {...hoverProps(it.ei)}>
            <line x1={x} y1={6} x2={x} y2={BY} style={{ stroke: v("text-tertiary"), strokeWidth: 1 }} />
            {mark(x, 6, it.p)}
            <text x={x + 8} y={12} fontSize={9.5} style={{ fill: v("muted-foreground"), fontFamily: FONT_MONO }}>
              {`${it.p.label || it.p.signalName} ×${portCount(it.p)} ${cat.type(it.p.connectorTypeId)?.name ?? "—"}`}
            </text>
          </g>
        );
      })}
      {BI.length > 0 && (
        <text
          x={BX - 120}
          y={BY + bh + 8}
          fontSize={9}
          letterSpacing={0.6}
          style={{ fill: v("text-tertiary"), fontFamily: FONT_SANS }}
        >
          ENTRÉES / SORTIES
        </text>
      )}
      {BI.map((it, i) => {
        const colx = i % 2 === 0 ? BX - 120 : BX + BW / 2 + 20;
        const y = BY + bh + 20 + Math.floor(i / 2) * ROW_H;
        const hov = hoverEntry === it.ei;
        return (
          <g key={it.ei} data-entry={it.ei} data-side="both" data-hover={hov ? "" : undefined} {...hoverProps(it.ei)}>
            {mark(colx, y, it.p)}
            {label(it.p, colx + 9, y, "start")}
            {hov && (
              <line x1={colx - 6} y1={y + 8} x2={colx + 200} y2={y + 8} style={{ stroke: v("accent"), strokeWidth: 1 }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
