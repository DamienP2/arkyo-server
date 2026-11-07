"use client";

/**
 * Élévation de rack (interface Strata) : montants numérotés des deux côtés,
 * U libres repérés (`data-u`), équipements dessinés avec leur vraie face et,
 * à droite, les repères nommés (repère et nom de l'équipement). La vue
 * « Côté » montre la profondeur de chaque équipement et la réserve de câbles
 * arrière. Réutilisée par la vue Connectique et les vignettes (`labels`
 * à `false`).
 *
 * Portée de la maquette approuvée (`maquette-mixte.html`, `rackSVG2`), 1 unité
 * SVG = 1 mm. Le rack est un rendu du matériel (`--strata-face-*`, sombre dans
 * les deux thèmes) ; les repères, hors du rack, suivent le thème.
 */

import {
  FACE_WIDTH_MM,
  U_MM,
  type DrawingConnectorType,
  type DrawingSignal,
} from "./face-layout";
import { FONT_MONO, FONT_SANS, FaceContent, type FaceEquipment } from "./equipment-face";

export type RackFace = "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE";

export type RackElevationSlot = {
  id: string;
  /** U du bas de l'équipement, à partir de 1. */
  startU: number;
  heightU: number;
  /** Repère nommé (ex. « GRI-01 »). */
  label: string;
  /** Nom de l'équipement. */
  name: string;
  /** Équipement dont la face est dessinée ; sans lui, une plaque neutre. */
  equipment?: FaceEquipment | null;
  /** Profondeur de l'équipement en mm (vue « Côté »). */
  depthMm?: number | null;
  status?: "ok" | "warning" | "danger";
  /** Ports reliés de cet équipement (clé de port → repère du câble). */
  links?: Record<string, string>;
};

export type RackElevationProps = {
  units: number;
  slots: readonly RackElevationSlot[];
  face: RackFace;
  /** Repères nommés à droite du rack. */
  labels: boolean;
  /** Profondeur utile du rack en mm (vue « Côté »). */
  depthMm?: number | null;
  connectorTypes?: readonly DrawingConnectorType[];
  signals?: readonly DrawingSignal[];
  selectedSlotId?: string | null;
  /** Port sélectionné sur l'équipement sélectionné. */
  selectedPort?: string | null;
  onSlotClick?: (slotId: string) => void;
  onPortClick?: (slotId: string, portKey: string) => void;
  /** Échelle en px par mm ; sans elle, le dessin prend toute la largeur. */
  scale?: number;
  className?: string;
};

const v = (name: string) => `var(--${name})`;
const RAIL = 38.7;
const RW = FACE_WIDTH_MM + RAIL * 2; // 560 mm : montants compris
const LBL = 230;
const TOP = 22;
/** Réserve de câbles à l'arrière (vue « Côté »), en mm. */
const CABLE_RESERVE_MM = 120;
/** Contour d'un équipement : sélection, survol (classes, pour que le survol l'emporte). */
const SEL_STROKE = "[stroke:var(--strata-face-accent)]";
const HOVER_STROKE = "group-hover:[stroke:var(--strata-face-accent)]";

export function RackElevation({
  units: rawUnits,
  slots,
  face,
  labels,
  depthMm,
  connectorTypes,
  signals,
  selectedSlotId,
  selectedPort,
  onSlotClick,
  onPortClick,
  scale,
  className,
}: RackElevationProps) {
  const units = Number.isFinite(rawUnits) ? Math.max(1, Math.round(rawUnits)) : 1;
  const H = units * U_MM + TOP * 2;
  const W = RW + (labels ? LBL : 0);
  const placed = slots.filter(
    (s) => Number.isFinite(s.startU) && Number.isFinite(s.heightU) && s.heightU >= 1 && s.startU >= 1 && s.startU <= units,
  );
  const occupied = new Set<number>();
  for (const s of placed) for (let k = 0; k < s.heightU; k++) occupied.add(s.startU + k);
  // Haut de l'équipement, borné au haut du rack (un équipement qui dépasse est rogné, pas dessiné au-dessus du cadre).
  const yOf = (s: RackElevationSlot) => TOP + (units - Math.min(units, s.startU + s.heightU - 1)) * U_MM;
  const hOf = (s: RackElevationSlot) => Math.min(s.heightU, units - s.startU + 1) * U_MM;
  const depthPx = RW - RAIL * 2;
  const knownDepth = depthMm && depthMm > 0 ? depthMm : null;
  // Sans profondeur de rack connue, l'équipement le plus profond sert d'échelle.
  const rackDepth = knownDepth ?? Math.max(1, ...placed.map((s) => (s.depthMm && s.depthMm > 0 ? s.depthMm : 0)));
  const clickProps = (id: string) =>
    onSlotClick ? { onClick: () => onSlotClick(id), style: { cursor: "pointer" } as const } : {};

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Élévation du rack"
      className={className}
      width={scale ? Math.round(W * scale) : undefined}
      height={scale ? Math.round(H * scale) : undefined}
      style={scale ? { display: "block" } : { display: "block", width: "100%", height: "auto" }}
    >
      <rect x={0} y={0} width={RW} height={H} rx={4} style={{ fill: v("strata-face-bg"), stroke: v("strata-face-line") }} />
      <rect x={RAIL} y={TOP} width={RW - RAIL * 2} height={units * U_MM} style={{ fill: v("strata-face-well") }} />
      {Array.from({ length: units }, (_, i) => {
        const u = i + 1;
        const y = TOP + (units - u) * U_MM;
        const num = { fontSize: 16, style: { fill: v("strata-face-ink-3"), fontFamily: FONT_MONO } };
        return (
          <g key={u}>
            <text x={RAIL - 8} y={y + U_MM / 2 + 5} textAnchor="end" {...num}>
              {u}
            </text>
            <text x={RW - RAIL + 8} y={y + U_MM / 2 + 5} {...num}>
              {u}
            </text>
            <line x1={RAIL} x2={RW - RAIL} y1={y} y2={y} style={{ stroke: v("strata-face-bg"), strokeWidth: 1 }} />
            {!occupied.has(u) && (
              <rect data-u={u} x={RAIL} y={y} width={RW - RAIL * 2} height={U_MM} style={{ fill: "transparent" }} />
            )}
          </g>
        );
      })}

      {face === "SIDE" ? (
        <>
          {placed.map((s) => {
            const y = yOf(s);
            const h = hOf(s);
            const d = s.depthMm && s.depthMm > 0 ? s.depthMm : 0;
            const dw = Math.min(depthPx, (d / rackDepth) * depthPx);
            // Réserve de câbles seulement à l'échelle d'une profondeur de rack connue.
            const res = knownDepth ? Math.min(depthPx - dw, (CABLE_RESERVE_MM / rackDepth) * depthPx) : 0;
            const sel = selectedSlotId === s.id;
            return (
              <g key={s.id} data-slot={s.id} data-selected={sel ? "" : undefined} className="group" {...clickProps(s.id)}>
                <rect
                  x={RAIL}
                  y={y + 1}
                  width={dw}
                  height={h - 2}
                  className={sel ? SEL_STROKE : `[stroke:var(--strata-face-line)] ${HOVER_STROKE}`}
                  style={{ fill: v("strata-face-bg"), strokeWidth: sel ? 3 : 1 }}
                />
                {res > 0 && (
                  <rect
                    x={RAIL + dw}
                    y={y + 1}
                    width={res}
                    height={h - 2}
                    strokeDasharray="4 4"
                    style={{ fill: "none", stroke: v("strata-face-ink-3"), strokeWidth: 1 }}
                  />
                )}
                <text
                  x={RAIL + 8}
                  y={y + Math.min(h / 2 + 5, 28)}
                  fontSize={14}
                  style={{ fill: v("strata-face-ink"), fontFamily: FONT_SANS }}
                >
                  {d ? `${s.label} · ${d} mm` : s.label}
                </text>
              </g>
            );
          })}
          <text
            x={RW / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={12}
            style={{ fill: v("strata-face-ink-3"), fontFamily: FONT_SANS }}
          >
            {knownDepth
              ? `Profondeur utile ${knownDepth} mm · réserve câbles arrière ${CABLE_RESERVE_MM} mm en pointillés`
              : "Profondeur non renseignée"}
          </text>
        </>
      ) : (
        <>
          {placed.map((s) => {
            const y = yOf(s);
            const h = hOf(s);
            const sel = selectedSlotId === s.id;
            const mid = y + h / 2;
            return (
              <g
                key={s.id}
                data-slot={s.id}
                data-selected={sel ? "" : undefined}
                className="group"
                opacity={face === "REAR_INTERIOR" ? 0.55 : undefined}
                {...clickProps(s.id)}
              >
                {s.equipment ? (
                  <svg
                    x={RAIL}
                    y={y}
                    width={FACE_WIDTH_MM}
                    height={h}
                    viewBox={`0 0 ${FACE_WIDTH_MM} ${h}`}
                    preserveAspectRatio="none"
                    overflow="hidden"
                  >
                    <FaceContent
                      equipment={s.equipment}
                      face={face === "FRONT" ? "FRONT" : "REAR"}
                      heightU={h / U_MM}
                      connectorTypes={connectorTypes}
                      signals={signals}
                      links={s.links}
                      selectedPort={sel ? selectedPort : null}
                      onPortClick={onPortClick ? (key) => onPortClick(s.id, key) : undefined}
                    />
                  </svg>
                ) : (
                  <>
                    <rect
                      x={RAIL + 0.5}
                      y={y + 0.5}
                      width={FACE_WIDTH_MM - 1}
                      height={h - 1}
                      rx={1.5}
                      style={{ fill: v("strata-face-bg"), stroke: v("strata-face-line"), strokeWidth: 0.8 }}
                    />
                    <text
                      x={RAIL + FACE_WIDTH_MM / 2}
                      y={mid + 4}
                      textAnchor="middle"
                      fontSize={12}
                      style={{ fill: v("strata-face-ink-2"), fontFamily: FONT_SANS }}
                    >
                      {s.name}
                    </text>
                  </>
                )}
                <rect
                  x={RAIL + 0.5}
                  y={y + 0.5}
                  width={FACE_WIDTH_MM - 1}
                  height={h - 1}
                  pointerEvents="none"
                  className={sel ? SEL_STROKE : `[stroke:transparent] ${HOVER_STROKE}`}
                  style={{ fill: "none", strokeWidth: sel ? 3 : 2 }}
                />
                {s.status && s.status !== "ok" && (
                  <circle
                    cx={RW - 8}
                    cy={y + 8}
                    r={4}
                    data-status={s.status}
                    style={{ fill: v(s.status === "danger" ? "danger" : "warning") }}
                  />
                )}
                {labels && (
                  <g data-callout={s.id}>
                    <line x1={RW} y1={mid} x2={RW + 14} y2={mid} style={{ stroke: v("text-tertiary"), strokeWidth: 1 }} />
                    <text
                      x={RW + 18}
                      y={mid - 2}
                      fontSize={17}
                      fontWeight={600}
                      style={{ fill: v(sel ? "accent-strong" : "foreground"), fontFamily: FONT_SANS }}
                    >
                      {s.label}
                    </text>
                    <text
                      x={RW + 18}
                      y={mid + 16}
                      fontSize={14}
                      style={{ fill: v("muted-foreground"), fontFamily: FONT_SANS }}
                    >
                      {s.name}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {face === "REAR_INTERIOR" && (
            <text
              x={RW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize={12}
              style={{ fill: v("strata-face-ink-3"), fontFamily: FONT_SANS }}
            >
              Arrière intérieur · montage sur rails arrière
            </text>
          )}
        </>
      )}
    </svg>
  );
}
