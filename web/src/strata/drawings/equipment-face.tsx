"use client";

/**
 * Face d'équipement à l'échelle (interface Strata) : vue de face avant ou
 * arrière dessinée depuis la connectique du catalogue (1 unité SVG = 1 mm).
 *
 * Portée de la maquette approuvée (`catalogue.js`, `faceSVG`). Style de
 * dessin technique (fiche constructeur) : traits fins et neutres,
 * pictogrammes de `ConnectorIcon` à l'encre `--strata-face-ink-2`. La couleur
 * du signal n'apparaît que comme repère (filet sous le libellé de groupe),
 * l'accent seulement pour la sélection et le survol. La face est un rendu du
 * matériel : châssis sombre dans les deux thèmes (`--strata-face-*`).
 *
 * Clé d'un port : `"<index de l'entrée>:<n>"`, n à partir de 1.
 */

import type { CSSProperties } from "react";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import {
  FACE_BOTTOM_MM,
  FACE_TOP_MM,
  FACE_WIDTH_MM,
  FACE_X0_MM,
  FACE_AVAILABLE_MM,
  U_MM,
  connectorWidthResolver,
  faceHeightU,
  layoutFace,
  type DrawingConnectorType,
  type DrawingSignal,
  type FaceSide,
} from "./face-layout";

export type FaceEquipment = {
  name: string;
  brand?: string | null;
  heightU?: number | null;
  isRackable: boolean;
  /** Dimensions en mm : largeur, profondeur, hauteur (pose libre). */
  dims?: readonly (number | null | undefined)[] | null;
  connectors: readonly ConnectorEntry[];
};

export type FaceInteraction = {
  /** Ports reliés : clé de port → repère du câble (ex. `"0:1": "V-0101"`). */
  links?: Record<string, string>;
  selectedPort?: string | null;
  /** Entrée survolée (index dans `connectors`), surlignée sur la face. */
  hoverEntry?: number | null;
  onPortClick?: (portKey: string) => void;
  onEntryHover?: (entryIndex: number | null) => void;
};

export type EquipmentFaceProps = FaceInteraction & {
  equipment: FaceEquipment;
  face: FaceSide;
  connectorTypes?: readonly DrawingConnectorType[];
  signals?: readonly DrawingSignal[];
  className?: string;
  /** Largeur maximale du dessin, en px. */
  maxWidth?: number;
};

export const FONT_SANS = "var(--font-sans)";
export const FONT_MONO = "var(--font-mono)";
const v = (name: string) => `var(--${name})`;

/** Genre d'un connecteur : `M` / `F` / `N` (jamais ♂ / ♀). */
export function genderLetter(g: string | null | undefined): "M" | "F" | "N" {
  return g === "MALE" ? "M" : g === "FEMALE" ? "F" : "N";
}

export const DIRECTION_LABEL: Record<ConnectorEntry["direction"], string> = {
  IN: "entrée",
  OUT: "sortie",
  BOTH: "E/S",
};

/** Nom d'un port : libellé de l'entrée, suivi du numéro s'il y en a plusieurs. */
export function portName(label: string, count: number, n: number): string {
  return count > 1 ? `${label} ${n}` : label;
}

/**
 * Pictogramme d'un connecteur dans un dessin SVG, carré de `size` placé en
 * (x, y). `ConnectorIcon` dessine le pictogramme intégré (les surcharges
 * d'administration sont des `<img>`, sans rendu dans un SVG) ; un `iconId`
 * qui est une URL devient une `<image>`. Sans type connu : un carré neutre.
 */
export function PortGlyph({
  iconId,
  x,
  y,
  size,
  color,
}: {
  iconId: string | null | undefined;
  x: number;
  y: number;
  size: number;
  color: string;
}) {
  if (!iconId) {
    return (
      <rect
        x={x + size * 0.2}
        y={y + size * 0.2}
        width={size * 0.6}
        height={size * 0.6}
        rx={size * 0.08}
        style={{ fill: "none", stroke: color, strokeWidth: size * 0.05 }}
      />
    );
  }
  if (iconId.startsWith("/") || iconId.startsWith("http")) {
    return <image href={iconId} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid meet" />;
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <ConnectorIcon iconId={iconId} size={size} color={color} ignoreOverride />
    </g>
  );
}

/** Index des types de connecteur et des signaux, partagé par les dessins. */
export function catalogIndex(connectorTypes: readonly DrawingConnectorType[] = [], signals: readonly DrawingSignal[] = []) {
  const types = new Map(connectorTypes.map((t) => [t.id, t]));
  const sigs = new Map(signals.map((s) => [s.name, s]));
  return {
    type: (id: string) => types.get(id),
    signal: (name: string) => sigs.get(name),
    widthOf: connectorWidthResolver(connectorTypes),
  };
}

/**
 * Contenu d'une face, en coordonnées de la face (482,6 × hauteur mm). Utilisé
 * seul par `EquipmentFace` et intégré tel quel dans `RackElevation`.
 */
export function FaceContent({
  equipment,
  face,
  connectorTypes,
  signals,
  heightU,
  links,
  selectedPort,
  hoverEntry,
  onPortClick,
  onEntryHover,
}: FaceInteraction & {
  equipment: FaceEquipment;
  face: FaceSide;
  connectorTypes?: readonly DrawingConnectorType[];
  signals?: readonly DrawingSignal[];
  /** Hauteur imposée en U (emplacement de rack) ; sinon celle de l'équipement. */
  heightU?: number;
}) {
  const U = heightU ?? faceHeightU(equipment.heightU, equipment.isRackable);
  const W = FACE_WIDTH_MM;
  const H = U * U_MM;
  const ear = equipment.isRackable ? 16 : 0;
  const x0 = FACE_X0_MM;
  const x1 = FACE_X0_MM + FACE_AVAILABLE_MM;
  const cat = catalogIndex(connectorTypes, signals);
  const groups = layoutFace(equipment.connectors, face, U, cat.widthOf);
  const usableH = H - FACE_TOP_MM - FACE_BOTTOM_MM;
  const cy = (H - 6) / 2;
  const brand = equipment.brand?.trim();
  const dims = (equipment.dims ?? []).filter((d): d is number => typeof d === "number" && Number.isFinite(d));

  return (
    <>
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={1.5}
        style={{ fill: v("strata-face-bg"), stroke: v("strata-face-line"), strokeWidth: 0.8 }}
      />
      {ear > 0 &&
        [0, W - ear].map((ex) => (
          <g key={ex}>
            <line
              x1={ex === 0 ? ear : ex}
              y1={0}
              x2={ex === 0 ? ear : ex}
              y2={H}
              style={{ stroke: v("strata-face-line"), strokeWidth: 0.6 }}
            />
            {Array.from({ length: U }, (_, u) =>
              [6.35, 38.1].map((dy) => (
                <rect
                  key={`${u}-${dy}`}
                  x={ex + ear / 2 - 3}
                  y={u * U_MM + dy - 2}
                  width={6}
                  height={4}
                  rx={2}
                  style={{ fill: "none", stroke: v("strata-face-ink-3"), strokeWidth: 0.6 }}
                />
              )),
            )}
          </g>
        ))}
      <text
        x={x0}
        y={H - 3.5}
        fontSize={4.6}
        letterSpacing={0.3}
        style={{ fill: v("strata-face-ink-3"), fontFamily: FONT_SANS, whiteSpace: "pre" }}
      >
        {brand ? `${brand.toUpperCase()}  ${equipment.name}` : equipment.name}
      </text>
      <text
        x={x1}
        y={H - 3.5}
        textAnchor="end"
        fontSize={4.6}
        style={{ fill: v("strata-face-ink-3"), fontFamily: FONT_MONO }}
      >
        {face === "FRONT" ? "AVANT" : "ARRIÈRE"}
      </text>

      {groups.length === 0 ? (
        <>
          {/* Façade neutre : grille d'aération, sans connectique. */}
          {Array.from({ length: 16 }, (_, k) => (
            <line
              key={k}
              x1={x1 - 96 + k * 6}
              y1={cy - H * 0.22}
              x2={x1 - 96 + k * 6}
              y2={cy + H * 0.22}
              style={{ stroke: v("strata-face-line"), strokeWidth: 1.2 }}
            />
          ))}
          {!equipment.isRackable && (
            <text
              x={W / 2}
              y={cy + 2}
              textAnchor="middle"
              fontSize={7}
              style={{ fill: v("strata-face-ink-2"), fontFamily: FONT_SANS }}
            >
              {dims.length ? `Pose libre · ${dims.join(" × ")} mm` : "Pose libre"}
            </text>
          )}
        </>
      ) : (
        groups.map((g) => {
          const e = equipment.connectors[g.entryIndex];
          const type = cat.type(e.connectorTypeId);
          const signal = cat.signal(e.signalName);
          const hov = hoverEntry === g.entryIndex;
          const gy = FACE_TOP_MM + (usableH - g.rows * g.pitch) / 2;
          const gridW = g.cols * g.pitch;
          const connText = `${type?.name ?? "Connecteur inconnu"} ${genderLetter(e.gender)}`;
          return (
            <g
              key={g.entryIndex}
              data-entry={g.entryIndex}
              data-hover={hov ? "" : undefined}
              onMouseEnter={onEntryHover ? () => onEntryHover(g.entryIndex) : undefined}
              onMouseLeave={onEntryHover ? () => onEntryHover(null) : undefined}
            >
              <text
                x={g.x}
                y={6.2}
                fontSize={4.6}
                fontWeight={600}
                letterSpacing={0.2}
                style={{ fill: v(hov ? "strata-face-ink" : "strata-face-ink-2"), fontFamily: FONT_SANS }}
              >
                {g.count > 1 ? `${g.label} 1–${g.count}` : g.label}
              </text>
              <line
                x1={g.x}
                y1={8.2}
                x2={g.x + Math.max(8, gridW - 1)}
                y2={8.2}
                style={{ stroke: signal?.color ?? v("strata-face-ink-3"), strokeWidth: hov ? 1.4 : 0.8 }}
              />
              {hov && (
                <rect
                  x={g.x - 1.5}
                  y={FACE_TOP_MM - 1}
                  width={gridW + 2}
                  height={g.rows * g.pitch + 2}
                  style={{ fill: "none", stroke: v("strata-face-accent"), strokeWidth: 0.6 }}
                />
              )}
              {Array.from({ length: g.count }, (_, i) => {
                const n = i + 1;
                const key = `${g.entryIndex}:${n}`;
                const px = g.x + Math.floor(i / g.rows) * g.pitch + (g.pitch - g.size) / 2;
                const py = gy + (i % g.rows) * g.pitch + (g.pitch - g.size) / 2;
                const link = links?.[key];
                const sel = selectedPort === key;
                const color = v(sel ? "strata-face-accent" : link ? "strata-face-ink" : "strata-face-ink-2");
                const title = [
                  portName(g.label, g.count, n),
                  connText,
                  e.signalName,
                  DIRECTION_LABEL[e.direction] ?? e.direction,
                  link ?? "libre",
                ].join(" · ");
                const style: CSSProperties | undefined = onPortClick ? { cursor: "pointer" } : undefined;
                return (
                  <g
                    key={key}
                    data-port={key}
                    data-linked={link ? "" : undefined}
                    data-selected={sel ? "" : undefined}
                    onClick={onPortClick ? () => onPortClick(key) : undefined}
                    style={style}
                  >
                    <title>{title}</title>
                    <rect x={px} y={py} width={g.size} height={g.size} style={{ fill: "transparent" }} />
                    <PortGlyph iconId={type?.iconId} x={px} y={py} size={g.size} color={color} />
                    {sel && (
                      <rect
                        x={px - 0.8}
                        y={py - 0.8}
                        width={g.size + 1.6}
                        height={g.size + 1.6}
                        style={{ fill: "none", stroke: v("strata-face-accent"), strokeWidth: 0.8 }}
                      />
                    )}
                    {link && <circle cx={px + g.size - 0.5} cy={py + 0.5} r={1.1} style={{ fill: v("success") }} />}
                  </g>
                );
              })}
            </g>
          );
        })
      )}
    </>
  );
}

/** Face avant ou arrière d'un équipement, à l'échelle, pleine largeur. */
export function EquipmentFace({ className, maxWidth, ...props }: EquipmentFaceProps) {
  const U = faceHeightU(props.equipment.heightU, props.equipment.isRackable);
  return (
    <svg
      viewBox={`0 0 ${FACE_WIDTH_MM} ${U * U_MM}`}
      role="img"
      aria-label={`Face ${props.face === "FRONT" ? "avant" : "arrière"} ${props.equipment.name}`}
      className={className}
      style={{ display: "block", width: "100%", height: "auto", maxWidth }}
    >
      <FaceContent {...props} heightU={U} />
    </svg>
  );
}
