"use client";

/**
 * Adaptateur (interface Strata) : entrées à gauche, corps, sorties à droite,
 * chaque extrémité avec son pictogramme, son nom et son genre (`M` / `F` /
 * `N`), et la quantité quand elle dépasse 1.
 *
 * Porté de la maquette approuvée (`catalogue.js`, `adapterSVG`), aux couleurs
 * de l'interface.
 */

import { FONT_MONO, FONT_SANS, PortGlyph, genderLetter } from "./equipment-face";
import type { DrawingGender } from "./cable-drawing";

export type AdapterEndDrawing = {
  connectorName: string;
  iconId?: string | null;
  gender?: DrawingGender | null;
  quantity?: number | null;
};

export type AdapterDrawingData = {
  name: string;
  inputs: readonly AdapterEndDrawing[];
  outputs: readonly AdapterEndDrawing[];
  powered?: boolean | null;
};

const v = (name: string) => `var(--${name})`;
const ROW = 18;

export function AdapterDrawing({ adapter, className }: { adapter: AdapterDrawingData; className?: string }) {
  const n = Math.max(adapter.inputs.length, adapter.outputs.length);
  const H = Math.max(36, n * ROW + 10);

  const side = (arr: readonly AdapterEndDrawing[], left: boolean) =>
    arr.map((c, i) => {
      const y = H / 2 - ((arr.length - 1) * ROW) / 2 + i * ROW;
      const x = left ? 116 : 228;
      const q = Number(c.quantity);
      const text = `${c.connectorName} ${genderLetter(c.gender)}${Number.isFinite(q) && q > 1 ? ` ×${Math.floor(q)}` : ""}`;
      return (
        <g key={`${left ? "in" : "out"}-${i}`}>
          <line
            x1={left ? 134 : 210}
            y1={y}
            x2={left ? 150 : 226}
            y2={y}
            style={{ stroke: v("text-tertiary"), strokeWidth: 1 }}
          />
          <PortGlyph iconId={c.iconId} x={x} y={y - 8} size={16} color={v("muted-foreground")} />
          <text
            x={left ? x - 4 : x + 22}
            y={y + 3.5}
            textAnchor={left ? "end" : "start"}
            fontSize={10}
            style={{ fill: v("muted-foreground"), fontFamily: FONT_MONO }}
          >
            {text}
          </text>
        </g>
      );
    });

  return (
    <svg
      viewBox={`0 0 360 ${H}`}
      role="img"
      aria-label={adapter.name}
      className={className}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <rect
        x={150}
        y={4}
        width={60}
        height={H - 8}
        rx={3}
        style={{ fill: v("surface-raised"), stroke: v("border-strong"), strokeWidth: 1 }}
      />
      {adapter.powered && (
        <text
          x={180}
          y={H / 2 + 3}
          textAnchor="middle"
          fontSize={8.5}
          style={{ fill: v("text-tertiary"), fontFamily: FONT_SANS }}
        >
          alimenté
        </text>
      )}
      {side(adapter.inputs, true)}
      {side(adapter.outputs, false)}
    </svg>
  );
}
