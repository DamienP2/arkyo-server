/**
 * Disposition d'une face d'équipement (interface Strata).
 *
 * Algorithme porté de la maquette approuvée (`catalogue.js`, `faceSVG`) : la
 * face fait 482,6 mm de large (19 pouces) et `heightU × 44,45 mm` de haut ;
 * chaque entrée de connectique devient un groupe de ports disposé en grille
 * (colonnes remplies de haut en bas), au pas de 1,18 × la taille du
 * pictogramme. L'échelle part de 0,92 et baisse par pas de 0,04 tant que les
 * groupes, espacés de 9 mm, ne tiennent pas dans les 434,6 mm utiles.
 *
 * Toutes les mesures sont en mm (1 unité SVG = 1 mm).
 */

import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";

/** Type de connecteur tel que renvoyé par `GET /api/tenant/catalogue/lookup`. */
export type DrawingConnectorType = { id: string; name: string; iconId: string };

/**
 * Signal tel que renvoyé par `GET /api/tenant/catalogue/lookup`. `isPower`
 * (signal de la fonction Énergie) range l'entrée au-dessus du schéma de
 * principe ; l'appelant le calcule, le lookup ne le fournit pas.
 */
export type DrawingSignal = { name: string; color: string; isPower?: boolean };

export type FaceSide = "FRONT" | "REAR";

export type FaceGroup = {
  /** Index de l'entrée dans `connectors` (toutes faces confondues). */
  entryIndex: number;
  label: string;
  /** Nombre de ports (quantité de l'entrée, ≥ 0). */
  count: number;
  rows: number;
  cols: number;
  /** Abscisse du bord gauche du groupe sur la face (mm). */
  x: number;
  /** Largeur réservée au groupe (grille ou libellé, le plus large). */
  width: number;
  /** Pas de la grille (mm). */
  pitch: number;
  /** Taille d'un pictogramme de port (mm). */
  size: number;
};

/** Largeur réelle approximative d'un connecteur en façade, en mm, par `iconId`. */
export const CONNECTOR_MM: Record<string, number> = {
  bnc: 11,
  din102: 7,
  smpte: 17,
  lemo: 17,
  hdmi: 15,
  xlr3: 19,
  xlr4: 19,
  xlr5: 19,
  rj45: 12,
  ethercon: 19,
  sfp: 14,
  qsfp: 18,
  lc: 12,
  sc: 13,
  dsub: 19,
  sma: 7,
  usbc: 9,
  iec13: 24,
  iec19: 27,
  true1: 26,
  powercon: 26,
  cee16: 40,
};
export const DEFAULT_CONNECTOR_MM = 14;

/** Anciens `iconId` encore acceptés par `ConnectorIcon` (mêmes alias). */
const ICON_ALIASES: Record<string, string> = {
  vga: "dsub",
  db9: "dsub",
  db15: "dsub",
  db25: "dsub",
  cee: "cee16",
  powercontrue1: "true1",
};

export const U_MM = 44.45;
export const FACE_WIDTH_MM = 482.6;
/** Largeur utile entre les oreilles (16 mm) et les marges (8 mm). */
export const FACE_AVAILABLE_MM = 434.6;
export const FACE_X0_MM = (FACE_WIDTH_MM - FACE_AVAILABLE_MM) / 2;
export const GROUP_GAP_MM = 9;
/** Bande des libellés de groupe, en haut de la face. */
export const FACE_TOP_MM = 11;
/** Bande de la légende (marque, nom, côté), en bas de la face. */
export const FACE_BOTTOM_MM = 8;
const PITCH_RATIO = 1.18;
const SCALE_START = 0.92;
const SCALE_STEP = 0.04;
const SCALE_MIN = 0.3;
/** Largeur d'un caractère de libellé (mm) et plafond de la largeur de libellé. */
const LABEL_CHAR_MM = 2.9;
const LABEL_MAX_MM = 52;

/** Hauteur dessinée d'un équipement, en U (2 U pour un équipement posé). */
export function faceHeightU(heightU: number | null | undefined, isRackable: boolean): number {
  if (!isRackable) return 2;
  return Number.isFinite(heightU) ? Math.max(1, Math.round(heightU as number)) : 1;
}

/** Résout la largeur en mm d'un type de connecteur depuis les types du catalogue. */
export function connectorWidthResolver(types: readonly DrawingConnectorType[]): (typeId: string) => number {
  const byId = new Map(types.map((t) => [t.id, t.iconId]));
  return (typeId) => {
    const icon = byId.get(typeId);
    if (!icon) return DEFAULT_CONNECTOR_MM;
    const key = icon.toLowerCase();
    return CONNECTOR_MM[ICON_ALIASES[key] ?? key] ?? DEFAULT_CONNECTOR_MM;
  };
}

/** Quantité exploitable d'une entrée (entier ≥ 0, 0 si absente ou invalide). */
export function portCount(e: Pick<ConnectorEntry, "quantity">): number {
  const q = Number(e.quantity);
  return Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 0;
}

/** Libellé d'une entrée : son libellé, à défaut son signal. */
export function entryLabel(e: Pick<ConnectorEntry, "label" | "signalName">): string {
  return e.label?.trim() || e.signalName || "";
}

/** Groupes de ports d'une face, disposés de gauche à droite et centrés. */
export function layoutFace(
  entries: readonly ConnectorEntry[],
  face: FaceSide,
  heightU: number,
  connectorWidthMm: (typeId: string) => number,
): FaceGroup[] {
  const u = Number.isFinite(heightU) ? Math.max(1, Math.round(heightU)) : 1;
  const usableH = u * U_MM - FACE_TOP_MM - FACE_BOTTOM_MM;
  const groups = entries.flatMap((e, entryIndex) => {
    if (e.face !== face) return [];
    const mm = connectorWidthMm(e.connectorTypeId);
    return [
      {
        entryIndex,
        label: entryLabel(e),
        count: portCount(e),
        mm: Number.isFinite(mm) && mm > 0 ? mm : DEFAULT_CONNECTOR_MM,
      },
    ];
  });

  const layout = (k: number): FaceGroup[] =>
    groups.map((g) => {
      const size = g.mm * k;
      const pitch = size * PITCH_RATIO;
      const rows = Math.max(1, Math.min(g.count, Math.floor(usableH / pitch)));
      const cols = Math.ceil(g.count / rows);
      const labelW = Math.min(LABEL_MAX_MM, (g.label.length + (g.count > 1 ? 4 : 0)) * LABEL_CHAR_MM);
      return {
        entryIndex: g.entryIndex,
        label: g.label,
        count: g.count,
        rows,
        cols,
        x: 0,
        width: Math.max(cols * pitch, labelW),
        pitch,
        size,
      };
    });
  const total = (l: FaceGroup[]) => l.reduce((a, g) => a + g.width, 0) + Math.max(0, l.length - 1) * GROUP_GAP_MM;

  let k = SCALE_START;
  let placed = layout(k);
  while (total(placed) > FACE_AVAILABLE_MM && k > SCALE_MIN) {
    k -= SCALE_STEP;
    placed = layout(k);
  }

  let x = FACE_X0_MM + Math.max(0, (FACE_AVAILABLE_MM - total(placed)) / 2);
  for (const g of placed) {
    g.x = x;
    x += g.width + GROUP_GAP_MM;
  }
  return placed;
}
