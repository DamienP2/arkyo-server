/**
 * Estimation de longueur de câble entre 2 équipements dans un rack 19".
 *
 * Modèle physique basé sur le chemin réel :
 *   Connecteur A → sortie (profondeur connecteur) → coude → chemin horizontal
 *   vers canal de câblage → coude → parcours vertical → coude → chemin
 *   horizontal vers connecteur B → coude → entrée connecteur B
 *
 * Formule :
 *   L = V + H + D + B + service_loop
 *
 * Pure TS, aucune dépendance Prisma / React.
 */

// ── Constantes physiques ────────────────────────────────────────────────────
const U_HEIGHT = 44.45; // mm — norme EIA-310
const RACK_WIDTH = 482.6; // mm — 19 pouces

// ── Profondeurs connecteur par défaut (connecteur + rayon de sortie) ────────
export const CONNECTOR_DEPTHS: Record<string, number> = {
  BNC: 30,
  XLR: 45,
  RJ45: 35,
  LC: 25,
  SC: 30,
  "HD-SDI": 30,
  HDMI: 40,
  USB: 35,
  powerCon: 45,
  Speakon: 40,
  DIN: 30,
  DB9: 35,
  DB25: 40,
  default: 35,
};

// ── Types ───────────────────────────────────────────────────────────────────

export type PortFace = "front" | "rear";
export type RoutingMode = "side_channel" | "rear_vertical" | "front_patch";

export type CableLengthInput = {
  // Équipement A
  startU_A: number;
  heightU_A: number;
  portFace_A?: PortFace;
  /** Position horizontale du port sur la face (mm depuis le bord gauche). Défaut : centre. */
  portXOffset_A?: number;
  /** Profondeur du connecteur + rayon de sortie (mm). Défaut : 35. */
  connectorDepth_A?: number;

  // Équipement B
  startU_B: number;
  heightU_B: number;
  portFace_B?: PortFace;
  portXOffset_B?: number;
  connectorDepth_B?: number;

  // Rack
  /** Profondeur utile du rack en mm (600–1000). Défaut : 600. */
  rackDepthMm?: number;
  /** Position du canal de câblage depuis le centre du rack (mm). Défaut : RACK_WIDTH/2 + 50. */
  channelSideMm?: number;
  /** Rayon de courbure minimum (mm). 50 cuivre, 25 fibre. Défaut : 50. */
  bendRadiusMm?: number;
  /** Boucle de service (mm). Défaut : 300. */
  serviceLoopMm?: number;
};

export type CableLengthResult = {
  /** Longueur totale estimée en mm. */
  lengthMm: number;
  /** Longueur arrondie au demi-mètre supérieur (valeur câble standard). */
  roundedM: number;
  /** Détail du calcul. */
  breakdown: {
    verticalMm: number;
    horizontalMm: number;
    connectorDepthMm: number;
    bendsMm: number;
    serviceLoopMm: number;
    nBends: number;
  };
};

// ── Calcul ──────────────────────────────────────────────────────────────────

export function estimateCableLength(input: CableLengthInput): CableLengthResult {
  const { startU_A, heightU_A, startU_B, heightU_B } = input;

  const faceA = input.portFace_A ?? "rear";
  const faceB = input.portFace_B ?? "rear";
  const rackDepth = input.rackDepthMm ?? 600;
  const channelSide = input.channelSideMm ?? RACK_WIDTH / 2 + 50;
  const bendRadius = input.bendRadiusMm ?? 50;
  const serviceLoop = input.serviceLoopMm ?? 500;
  const portXA = input.portXOffset_A ?? RACK_WIDTH / 2;
  const portXB = input.portXOffset_B ?? RACK_WIDTH / 2;
  const connDepthA = input.connectorDepth_A ?? CONNECTOR_DEPTHS.default;
  const connDepthB = input.connectorDepth_B ?? CONNECTOR_DEPTHS.default;

  // 1. Centre vertical de chaque équipement
  const centerA = (startU_A + heightU_A / 2) * U_HEIGHT;
  const centerB = (startU_B + heightU_B / 2) * U_HEIGHT;

  // 2. Distance verticale
  const V = Math.abs(centerA - centerB);

  // 3. Course horizontale (port → chemin de câbles)
  const sameFace = faceA === faceB;
  let H: number;
  let nBends: number;

  if (sameFace) {
    // Même face : 2 trajets horizontaux port → canal
    H = Math.abs(channelSide - portXA) + Math.abs(channelSide - portXB);
    nBends = 2;
  } else {
    // Faces opposées : un port traverse la profondeur du rack
    H = Math.abs(channelSide - portXA) + rackDepth + Math.abs(channelSide - portXB);
    nBends = 4;
  }

  // 4. Profondeur connecteurs (sortie + entrée)
  const D = connDepthA + connDepthB;

  // 5. Courbures (chaque virage à 90° = quart de cercle)
  const B = nBends * bendRadius * (Math.PI / 2);

  // 6. Longueur totale
  // Facteur de cheminement : en pratique les câbles ne suivent jamais le
  // chemin le plus court (détours, lovage, passage entre goulottes, attaches).
  // ×1.3 est une estimation conservatrice issue de la pratique broadcast.
  const ROUTING_FACTOR = 1.3;
  const rawMm = (V + H + D + B) * ROUTING_FACTOR + serviceLoop;
  const lengthMm = Math.max(500, Math.round(rawMm));

  // Arrondi au demi-mètre supérieur
  const roundedM = Math.ceil(lengthMm / 500) * 0.5;

  return {
    lengthMm,
    roundedM,
    breakdown: {
      verticalMm: Math.round(V),
      horizontalMm: Math.round(H),
      connectorDepthMm: Math.round(D),
      bendsMm: Math.round(B),
      serviceLoopMm: serviceLoop,
      nBends,
    },
  };
}

export function formatCableLength(meters: number): string {
  if (meters < 1) return `${Math.round(meters * 100)} cm`;
  return `${meters} m`;
}
