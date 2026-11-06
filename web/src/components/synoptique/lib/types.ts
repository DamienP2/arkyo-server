// Types partagés du rack-editor. Extraits du mono-fichier `rack-editor.tsx`.
// La source de vérité géométrique reste `(view, startU, column, widthFraction)`.
//
// Depuis la refonte catalogue cross-DB (Agent A) :
//  - les soft-FK tenant (`catalogEquipmentId`, etc.) référencent main DB,
//  - le shape `equipment` côté UI vient de `CatalogEquipmentLite` (`lib/types/catalog`)
//    enrichi par la page SSR via `mainDb.catalogEquipment.findMany`.
//
// On garde le NOM `equipment` sur le slot (et non `catalogEquipment`) pour
// limiter le diff dans les ~hundreds de call-sites du rack-editor —
// la seule différence pertinente est que le shape pointe désormais vers
// `CatalogEquipmentLite` et non `.prisma/client`.Equipment.

import type { CatalogEquipmentLite } from "@/lib/types/catalog";

/** Alias rétro-compatible utilisé partout dans le rack-editor. */
export type Equipment = CatalogEquipmentLite;

export type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
export type ViewId = "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE";

export type PanelSlotData = {
  position: number;
  /** Alias d'affichage de `catalogConnectorTypeId` (soft-FK main DB). */
  connectorTypeId: string | null;
  /** Soft-FK vers main DB CatalogConnectorType.id. */
  catalogConnectorTypeId?: string | null;
  /** Enrichi cross-DB par le SSR depuis `mainDb.catalogConnectorType`. */
  connectorType: {
    iconId: string;
    color: string;
    category: string;
    style?: string | null;
    name?: string | null;
    version?: string | null;
  } | null;
};

export type PanelItem = {
  id: string;
  name: string;
  heightU: number;
  slotsPerU: number;
  rearCableDepthMm: number;
  slots: PanelSlotData[];
};

export type Slot = {
  id: string;
  view: string;
  /**
   * @deprecated Alias d'affichage de `catalogEquipmentId` — pointe désormais vers
   * `CatalogEquipment.id` dans la main DB (cross-DB soft-FK). Conservé sous ce
   * nom pour limiter le diff dans les ~hundreds d'usages internes du
   * rack-editor.
   */
  equipmentId: string | null;
  /** Soft-FK vers main DB CatalogEquipment.id (pas de relation Prisma). */
  catalogEquipmentId?: string | null;
  parentSlotId: string | null;
  /** null pour les slots fantômes non encore placés physiquement */
  startU: number | null;
  /** null pour les slots fantômes non encore placés physiquement */
  heightU: number | null;
  widthFraction: WidthFraction;
  column: number;
  label: string | null;
  notes: string | null;
  panelLabels: unknown;
  /** Enrichi cross-DB par le SSR depuis `mainDb.catalogEquipment`. */
  equipment: Equipment | null;
  /**
   * Composants (cartes/modules) d'un châssis modulaire placés dans ce slot.
   * Triés par `slotIndex` croissant ; [] ou absent si aucun. Propagé tel quel
   * vers le synoptique (voir `SlotComponent` dans `types/synoptic.ts`).
   */
  components?: Array<{
    itemId: string;
    slotIndex: number;
    slotSpan: number;
    equipment: Equipment | null;
  }>;
  panel: PanelItem | null;
  children?: Slot[];
  synopticX: number | null;
  synopticY: number | null;
};

export type RigRef = { id: string; rigConfig: { id: string; name: string } };

export type Rack = {
  id: string;
  name: string;
  totalU: number;
  depthMm: number;
  maxWeightKg: number | null;
  maxPowerW: number | null;
  emptyWeightKg?: number | null;
  rearInteriorGapMm?: number | null;
  cableId?: number | null;
  cableCode?: string | null;
  numberingOverride?: {
    includeZone?: boolean;
    includeRack?: boolean;
    separator?: string;
    pad?: number;
    suffixSeparator?: string;
  } | null;
  slots: Slot[];
  rigs?: RigRef[];
  /** True si baie/flight rackable (utilise totalU). False sinon. */
  isRackable?: boolean;
  /** Statut du modèle dans le catalogue tenant (mode template uniquement). */
  templateStatus?: "BROUILLON" | "INACTIF" | "ACTIF";
};

export type AccessoryType = "plaque" | "etagere" | "tiroir";

// Étiquetage des ports panel
export type LabelGroup = { id: string; start: number; end: number; text: string; color: string };
export type RowLevels = LabelGroup[][];

// Item actif pendant un drag
export type ActiveItem =
  | { kind: "equipment"; equipment: Equipment; wf: WidthFraction }
  | { kind: "shelf-equipment"; equipment: Equipment }
  | { kind: "shelf-child"; slot: Slot; parentSlotId: string }
  | { kind: "slot"; slot: Slot }
  | { kind: "panel"; panel: PanelItem }
  | {
      kind: "configured-accessory";
      accessoryType: AccessoryType;
      heightU: number;
      style?: string;
      depthMm?: number;
    };
