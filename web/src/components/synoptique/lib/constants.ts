import type { AccessoryType, ViewId, WidthFraction } from "./types";

export const U_HEIGHT_PX = 44;

export const ACCESSORY_TYPES: {
  type: AccessoryType;
  label: string;
  description: string;
  icon: string;
}[] = [
  { type: "plaque", label: "Plaque", description: "Panneau de remplissage (blank)", icon: "▬" },
  { type: "etagere", label: "Étagère", description: "Étagère fixe avec profondeur", icon: "⊟" },
  { type: "tiroir", label: "Tiroir", description: "Tiroir coulissant avec profondeur", icon: "⊞" },
];

export const PLAQUE_STYLES: { id: string; label: string; sublabel: string }[] = [
  { id: "plein", label: "Plein", sublabel: "Panneau plein opaque" },
  { id: "transversal", label: "Passe-câble transv.", sublabel: "Fente horizontale" },
  { id: "longitudinal", label: "Passe-câble longit.", sublabel: "Fente verticale" },
  { id: "aere", label: "Aéré", sublabel: "Panneau perforé" },
];

// Ordre d'affichage : Avant → Côté (auto) → Arrière int. → Arrière
export const VIEWS: { id: ViewId; label: string; short: string; auto?: boolean }[] = [
  { id: "FRONT", label: "Face avant", short: "Avant" },
  { id: "SIDE", label: "Vue côté", short: "Côté", auto: true },
  { id: "REAR_INTERIOR", label: "Arrière intérieur", short: "Arr. int." },
  { id: "REAR", label: "Face arrière", short: "Arrière" },
];

export const WIDTH_CONFIG: Record<WidthFraction, { cols: number; label: string; pct: number }> = {
  FULL: { cols: 1, label: "1/1", pct: 100 },
  HALF: { cols: 2, label: "1/2", pct: 50 },
  THIRD: { cols: 3, label: "1/3", pct: 33.33 },
  QUARTER: { cols: 4, label: "1/4", pct: 25 },
};

// Dimensions géométriques du rack 19"
export const RACK_DEPTH_DEFAULT = 600; // mm
export const RACK_WIDTH_MM = 482.6; // 19" standard
export const U_MM = 44.45; // hauteur 1U en mm
// Vue front : largeur de la ZONE DE SLOTS (entre les rails de labels U), au
// ratio HORS-TOUT réel du 19" — zone / (nbU × U_HEIGHT_PX) == RACK_WIDTH_MM /
// U_MM ≈ 10.86. Les visuels GFX/PIC sont cropés à ce même ratio (oreilles de
// montage comprises) : une boîte de slot pleine largeur est donc exactement
// au ratio de son image — elle la remplit bord à bord (côtés visibles) et
// touche les séparations de U. C'est aussi l'ancre d'échelle px/mm de la vue
// côté (PX_PER_MM = FRONT_OUTER_W / RACK_WIDTH_MM).
export const FRONT_OUTER_W = Math.round(U_HEIGHT_PX * (RACK_WIDTH_MM / U_MM)); // ≈ 478px
// Rails de labels U : chrome UI dessiné EN DEHORS de la largeur 19", jamais
// recouvert par les équipements.
export const RAIL_W = 20;
/**
 * Traverses haute et basse qui « ferment » le châssis en vue FRONT/REAR.
 * Purement décoratives (aucun label) et plus fines que les rails latéraux.
 * La zone de U et les rails s'insèrent ENTRE les deux : le repère U interne
 * est simplement décalé de cette hauteur, à l'identique partout (séparateurs,
 * cellules de drop, slots, visuels GFX/PIC restent alignés).
 */
export const RACK_CROSSBAR_H = 10;
/** Hauteur totale du corps du rack (bordures 2px + traverses comprises). */
export function rackBodyHeight(totalU: number): number {
  return totalU * U_HEIGHT_PX + 4 + 2 * RACK_CROSSBAR_H;
}
// Largeur totale du corps du rack en vue FRONT/REAR :
// zone de slots + 2 rails + 2 bordures de 2px.
export const RACK_BODY_W = FRONT_OUTER_W + 2 * RAIL_W + 4; // ≈ 522px
// Vue côté : échelle indépendante, plus compacte
export const SIDE_INNER_W_REF = 160; // largeur intérieure de référence pour un rack de 600mm de profondeur
export const SIDE_PANEL_W = 16;

// Couleurs du label editor
export const LABEL_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#64748b",
];

// Shell UX (construction)
export const SHELL_TOPBAR_GLOBAL_H = 52;
export const SHELL_TOPBAR_CTX_H = 44;
export const SHELL_LEFT_TOOLBAR_W = 48;
export const SHELL_LEFT_SIDE_PANEL_W = 280;
export const SHELL_RIGHT_PANEL_W = 300;
export const SHELL_RIGHT_PANEL_MIN_W = 260;
export const SHELL_RIGHT_PANEL_MAX_W = 480;
export const SHELL_SLIDEOVER_W = 480;
export const SHELL_TOOL_ICON_SIZE = 18;
export const SHELL_CURSOR_HINT_OFFSET = 12;
