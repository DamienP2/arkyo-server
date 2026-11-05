// ─── Synoptic View — shared types & constants ──────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectorEntry = {
  face?: string;
  connectorTypeId?: string;
  quantity?: number;
  label?: string;
  direction?: string; // IN | OUT | BIDIR | undefined
  signalName?: string;
  gender?: string; // MALE | FEMALE
  /**
   * Optional grouping label — when set on a series of consecutive ports inside
   * a synthetic rack node (vue Générale), the SynopticNode regroupe visuellement
   * ces ports sous un mini-header centré. En mode rack focus (aucun groupLabel),
   * le rendu reste identique à l'historique (left/right colonnes).
   */
  groupLabel?: string | null;
};

export type ConnectorTypeInfo = {
  id: string;
  name: string;
  version?: string | null;
  iconId: string;
  color: string;
  category: string;
};

export type PanelSlotInfo = {
  position: number;
  connectorTypeId: string | null;
  connectorType: {
    id?: string;
    iconId: string;
    color: string;
    category: string;
    style?: string | null;
    name?: string | null;
    version?: string | null;
  } | null;
};

export type SlotEquipmentInfo = {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  heightU: number | null;
  weight: number | null;
  powerW: number | null;
  depthMm: number | null;
  imageUrl: string | null;
  connectors: unknown;
  brand?: { id: string; name: string } | null;
};

/**
 * Composant d'un châssis modulaire (type openGear) placé dans un slot hôte.
 * Ses ports sont rendus sur le nœud synoptique de l'équipement hôte, à la suite
 * de ceux de l'hôte, dans l'ordre `slotIndex` croissant. Voir `componentPortMap`
 * dans `lib/connection-devirt.ts` pour la convention d'offset (source de vérité).
 */
export type SlotComponent = {
  itemId: string;
  slotIndex: number;
  slotSpan: number;
  /** Même shape enrichie que `slot.equipment` (avec `connectors`). */
  equipment: SlotEquipmentInfo | null;
};

export type RackSlotWithEquipment = {
  id: string;
  /**
   * Contenant propriétaire du slot. Absent en vue rack focus (tous les slots
   * appartiennent au rack courant) ; renseigné par les payloads agrégés
   * multi-rack (vue lieu) pour router les écritures ancrées au slot vers le bon
   * `/api/racks/[rackId]/...`.
   */
  rackId?: string;
  /**
   * Force le rendu du nœud même sans aucun point de connexion (corps vide,
   * entête seule). Réservé aux nœuds SYNTHÉTIQUES des vues agrégées (bloc
   * « emplacement » ou « contenant » de la vue Générale) : un lieu sans port
   * externe doit rester visible et déplaçable. Jamais posé par les payloads
   * rack / lieu → aucun impact sur le filtrage existant.
   */
  renderWhenEmpty?: boolean;
  equipmentId: string | null;
  /** null pour les slots fantômes non encore placés physiquement */
  startU: number | null;
  /** null pour les slots fantômes non encore placés physiquement */
  heightU: number | null;
  label: string | null;
  widthFraction: string | null;
  notes: string | null;
  synopticX: number | null;
  synopticY: number | null;
  equipment: SlotEquipmentInfo | null;
  /** Composants (cartes/modules) placés dans ce slot hôte — [] si aucun. */
  components?: SlotComponent[];
  panel?: {
    id: string;
    name: string;
    heightU: number;
    slotsPerU: number;
    slots: PanelSlotInfo[];
  } | null;
};

export type RackConnection = {
  id: string;
  rackId: string;
  fromSlotId: string;
  fromConnectorIndex: number;
  toSlotId: string;
  toConnectorIndex: number;
  label: string | null;
  color: string | null;
  waypoints: unknown;
  cableStyle: string | null;
  /** Soft-FK cross-DB → main.CableModel.id (modèle physique du câble). */
  catalogCableModelId?: string | null;
};

// One Port = one physical connector unit (ConnectorEntry expanded by quantity)
export type Port = {
  portIndex: number; // flat index used as connection anchor (unique per slot)
  entryIndex: number; // index in ConnectorEntry[]
  unitIndex: number; // 0-based within this entry's quantity
  totalUnits: number; // entry.quantity
  entry: ConnectorEntry;
  ct: ConnectorTypeInfo | null;
  side: "left" | "right"; // IN→left, OUT→right, BIDIR→right
};

export type PortRef = {
  slotId: string;
  portIndex: number;
  side: "left" | "right";
  el: HTMLElement;
};

export type ZoneLabelPos = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Zone = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  labelPosition: ZoneLabelPos;
  color: string;
  borderRadius?: number;
  borderWidth?: number;
  borderStyle?: string;
  opacity?: number;
  labelFontSize?: number;
  labelFontWeight?: string;
  labelFontStyle?: string;
  labelTextDecoration?: string;
  labelFontFamily?: string | null;
};
export type CanvasLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width?: number | null;
  color: string;
  fontWeight: string;
  fontFamily?: string | null;
  fontStyle?: string;
  textDecoration?: string;
  pill?: boolean;
  pillBg?: string | null;
  pillRadius?: number;
};

export type DbZone = {
  id: string;
  rackId: string;
  label: string;
  labelPosition?: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  borderRadius?: number;
  borderWidth?: number;
  borderStyle?: string;
  opacity?: number;
  labelFontSize?: number;
  labelFontWeight?: string;
  labelFontStyle?: string;
  labelTextDecoration?: string;
  labelFontFamily?: string | null;
};
export type DbLabel = {
  id: string;
  rackId: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width?: number | null;
  color: string;
  fontWeight: string;
  fontFamily?: string | null;
  fontStyle?: string;
  textDecoration?: string;
};

/**
 * Nature d'une connexion externe.
 *  - `INTER_LIEU` : sortie vers un AUTRE emplacement du projet — la bulle
 *    affiche la cible résolue (`targetLabel`) ou « Non rattaché ».
 *  - `MONDE` : « lien externe » côté UI — sortie hors projet (feed diffuseur,
 *    antenne, prestataire…). La bulle affiche l'étiquette libre (`label`) et un
 *    badge `EXT`. Valeur d'enum inchangée côté DB/API.
 */
export type ExternalPortKind = "INTER_LIEU" | "MONDE";

/** Valeur par défaut (aligne le client sur le `@default(INTER_LIEU)` Prisma). */
export const EXTERNAL_PORT_KIND_DEFAULT: ExternalPortKind = "INTER_LIEU";

// Marqueur "sortie externe" sur un port libre — voir prisma model ExternalPort.
export type ExternalPortData = {
  id: string;
  /** Absent sur un payload antérieur à la phase 3 → `INTER_LIEU`. */
  kind?: ExternalPortKind;
  /**
   * Contenant propriétaire du marqueur. Absent en vue rack focus ; renseigné
   * par les payloads agrégés multi-rack (vue lieu) pour router PATCH/DELETE.
   */
  rackId?: string;
  slotId: string;
  portIndex: number;
  labelX: number | null;
  labelY: number | null;
  label: string | null;
  /**
   * Optionnel — Libellé du rack/équipement cible quand ce port externe est
   * matérialisé par une ProjectConnection inter-rack (résolu côté serveur
   * via la route `/api/tenant/projects/[id]/synoptic/focus/[rackId]`).
   * Format : `"RACK · Équipement · Connecteur"` (parts skippées si absentes).
   * Null = port externe orphelin (pas encore relié à une connexion projet).
   */
  targetLabel?: string | null;
  /**
   * Numérotation câble venant de la ProjectConnection (vue GENERAL) — null
   * si pas encore numéroté. Affiché en priorité sur le label local (`label`).
   */
  targetCableLabel?: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

export const NODE_W = 300;
export const PANEL_NODE_W = 150;
export const PORT_H = 28;
export const NODE_HEADER_H = 80;
export const NODE_MIN_H = NODE_HEADER_H + 16;
export const COL_GAP = 180;
export const ROW_GAP = 40;
export const CANVAS_PAD = 80;
export const SNAP_RADIUS = 30; // canvas-space pixels
export const SVG_W = 8000;
export const SVG_H = 8000;

export const ZONE_COLORS = [
  "#6366f1",
  "#f97316",
  "#22c55e",
  "#ef4444",
  "#eab308",
  "#06b6d4",
  "#a855f7",
  "#ec4899",
];

// Signal category → column order
export const CATEGORY_ORDER: Record<string, number> = {
  VIDEO: 0,
  VIDÉO: 0,
  AUDIO: 1,
  DATA: 2,
  DONNÉES: 2,
  NETWORK: 3,
  RÉSEAU: 3,
  POWER: 4,
  ALIMENTATION: 4,
};

// ─── Utility functions ───────────────────────────────────────────────────────

export function getConnectorCategory(ct: ConnectorTypeInfo | null): string {
  if (!ct) return "OTHER";
  return ct.category?.toUpperCase() ?? "OTHER";
}

// ─── Panel virtual row helpers ────────────────────────────────────────────────

export function isPanelVirtualId(id: string) {
  return id.includes("__row");
}
export function getVirtualRowInfo(virtualId: string) {
  const m = virtualId.match(/^(.+)__row(\d+)$/);
  if (!m) return null;
  return { slotId: m[1], rowIdx: parseInt(m[2]) };
}
export function panelVirtualId(slotId: string, rowIdx: number) {
  return `${slotId}__row${rowIdx}`;
}
export function localToGlobal(localPortIndex: number, rowIdx: number, slotsPerU: number) {
  return rowIdx * slotsPerU * 2 + localPortIndex;
}
export function globalToLocal(globalPortIndex: number, slotsPerU: number) {
  const rowIdx = Math.floor(globalPortIndex / (slotsPerU * 2));
  const localPortIndex = globalPortIndex % (slotsPerU * 2);
  return { rowIdx, localPortIndex };
}

// Convert a virtual panel node (virtualSlotId, localPortIndex) → (realSlotId, globalPortIndex) for DB storage
export function virtualToReal(
  virtualSlotId: string,
  localPortIndex: number,
  slots: RackSlotWithEquipment[],
): { slotId: string; portIndex: number } {
  const info = getVirtualRowInfo(virtualSlotId);
  if (!info) return { slotId: virtualSlotId, portIndex: localPortIndex };
  const realSlot = slots.find((s) => s.id === info.slotId);
  const slotsPerU = realSlot?.panel?.slotsPerU ?? 1;
  return { slotId: info.slotId, portIndex: localToGlobal(localPortIndex, info.rowIdx, slotsPerU) };
}

// Convert a DB connection (realSlotId, globalPortIndex) → virtual panel node ID + local port index, or identity for non-panel slots
export function realToVirtual(
  realSlotId: string,
  globalPortIndex: number,
  slots: RackSlotWithEquipment[],
): { slotId: string; portIndex: number } {
  const slot = slots.find((s) => s.id === realSlotId);
  if (!slot?.panel) return { slotId: realSlotId, portIndex: globalPortIndex };
  if (slot.panel.heightU <= 1)
    return { slotId: panelVirtualId(realSlotId, 0), portIndex: globalPortIndex };
  const slotsPerU = slot.panel.slotsPerU;
  const { rowIdx, localPortIndex } = globalToLocal(globalPortIndex, slotsPerU);
  return { slotId: panelVirtualId(realSlotId, rowIdx), portIndex: localPortIndex };
}

// Expand panel slots into virtual 1-U row entries (all panels, including 1U)
export function expandPanelSlots(slots: RackSlotWithEquipment[]): RackSlotWithEquipment[] {
  const result: RackSlotWithEquipment[] = [];
  for (const s of slots) {
    if (s.panel) {
      for (let rowIdx = 0; rowIdx < s.panel.heightU; rowIdx++) {
        const rowSlots = s.panel.slots.filter((ps) => {
          const psRow = Math.floor((ps.position - 1) / s.panel!.slotsPerU);
          return psRow === rowIdx;
        });
        if (rowSlots.some((ps) => ps.connectorTypeId != null)) {
          result.push({
            ...s,
            id: panelVirtualId(s.id, rowIdx),
            panel: { ...s.panel, heightU: 1, slots: rowSlots },
            synopticX: null,
            synopticY: null,
          });
        }
      }
    } else {
      result.push(s);
    }
  }
  return result;
}

// ─── Auto-layout ─────────────────────────────────────────────────────────────

export function expandedPortCount(connectors: unknown): number {
  if (!Array.isArray(connectors)) return 0;
  const entries = connectors as ConnectorEntry[];
  return entries.reduce((sum, e) => sum + (e.quantity ?? 1), 0);
}

export function autoLayout(
  slots: RackSlotWithEquipment[],
  connectorTypes: ConnectorTypeInfo[],
  existingPositions?: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const ctMap = Object.fromEntries(connectorTypes.map((c) => [c.id, c]));

  // Group slots by dominant connector category
  const colMap: Map<number, RackSlotWithEquipment[]> = new Map();
  for (const slot of slots) {
    if (slot.panel) {
      const col = 6;
      if (!colMap.has(col)) colMap.set(col, []);
      colMap.get(col)!.push(slot);
      continue;
    }
    if (!slot.equipment) continue;
    const entries: ConnectorEntry[] = Array.isArray(slot.equipment.connectors)
      ? (slot.equipment.connectors as ConnectorEntry[])
      : [];
    if (!entries.length) {
      // Equipment with no connectors → put in "OTHER" column
      const col = 5;
      if (!colMap.has(col)) colMap.set(col, []);
      colMap.get(col)!.push(slot);
      continue;
    }

    const cats: Record<number, number> = {};
    for (const e of entries) {
      const ct = e.connectorTypeId ? ctMap[e.connectorTypeId] : null;
      const order = CATEGORY_ORDER[getConnectorCategory(ct)] ?? 5;
      cats[order] = (cats[order] ?? 0) + (e.quantity ?? 1);
    }
    const col = Number(Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 5);
    if (!colMap.has(col)) colMap.set(col, []);
    colMap.get(col)!.push(slot);
  }

  const sortedCols = [...colMap.entries()].sort((a, b) => a[0] - b[0]);

  // Find the rightmost X used by existing positions to avoid overlap
  let startX = CANVAS_PAD;
  if (existingPositions && existingPositions.size > 0) {
    for (const pos of existingPositions.values()) {
      startX = Math.max(startX, pos.x + NODE_W + COL_GAP);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let colX = startX;

  for (const [, colSlots] of sortedCols) {
    // Slots fantômes (startU=null) placés en dernier (ordre stable)
    const sorted = [...colSlots].sort((a, b) => (b.startU ?? 0) - (a.startU ?? 0));
    let rowY = CANVAS_PAD;
    for (const slot of sorted) {
      const total = slot.panel
        ? slot.panel.slots.filter((ps) => ps.connectorTypeId != null).length
        : expandedPortCount(slot.equipment?.connectors ?? null);
      const nodeH = Math.max(NODE_MIN_H, NODE_HEADER_H + total * PORT_H + 16);
      positions.set(slot.id, { x: colX, y: rowY });
      rowY += nodeH + ROW_GAP;
    }
    colX += NODE_W + COL_GAP;
  }

  return positions;
}
