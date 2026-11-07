"use client";

/**
 * Câble (interface Strata) : vue en plan, connecteur A, gaine, connecteur B,
 * avec le genre de chaque extrémité (`M` / `F` / `N`).
 *
 * Porté de la maquette approuvée (`catalogue.js`, `cableSVG`). Aux couleurs de
 * l'interface ; la couleur du modèle (signal ou fonction, couleur métier)
 * n'est qu'une bague au milieu de la gaine.
 */

import { FONT_MONO, PortGlyph, genderLetter } from "./equipment-face";

export type DrawingGender = "MALE" | "FEMALE" | "NEUTRAL";

export type CableEndDrawing = {
  connectorName: string;
  iconId?: string | null;
  gender?: DrawingGender | null;
};

export type CableDrawingData = {
  name: string;
  left: CableEndDrawing;
  right: CableEndDrawing;
  /** Couleur métier du câble (signal ou fonction) ; sans couleur, pas de bague. */
  color?: string | null;
};

const v = (name: string) => `var(--${name})`;

function CableEnd({ x, end, right }: { x: number; end: CableEndDrawing; right: boolean }) {
  return (
    <>
      <PortGlyph iconId={end.iconId} x={x - 13} y={6} size={26} color={v("muted-foreground")} />
      <text
        x={right ? x + 13 : x - 13}
        y={41}
        textAnchor={right ? "end" : "start"}
        fontSize={9}
        style={{ fill: v("text-tertiary"), fontFamily: FONT_MONO }}
      >
        {`${end.connectorName} ${genderLetter(end.gender)}`}
      </text>
      <rect
        x={right ? x - 30 : x + 16}
        y={15}
        width={14}
        height={8}
        style={{ fill: v("muted"), stroke: v("border-strong"), strokeWidth: 1 }}
      />
    </>
  );
}

export function CableDrawing({ cable, className }: { cable: CableDrawingData; className?: string }) {
  return (
    <svg
      viewBox="0 0 320 44"
      role="img"
      aria-label={cable.name}
      className={className}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <line x1={60} y1={19} x2={260} y2={19} style={{ stroke: v("text-tertiary"), strokeWidth: 2 }} />
      {cable.color && <rect x={150} y={16} width={20} height={6} style={{ fill: cable.color }} />}
      <CableEnd x={30} end={cable.left} right={false} />
      <CableEnd x={290} end={cable.right} right />
    </svg>
  );
}
