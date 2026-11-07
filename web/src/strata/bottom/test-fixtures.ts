/**
 * Jeu de données d'un contenant pour les tests Strata du lot 3 (inspecteur,
 * dock bas, vue Connectique).
 *
 * Réponse `canvas-data` reprise des tests de la phase 4b
 * (`app/(fullscreen)/project/rack-tab.test.tsx` : `CAMERA`, `SLOT`,
 * `PANEL_SLOT`, `canvasData()`), complétée par de la connectique, un panel
 * équipé, un moniteur, une alimentation et des câbles au format de
 * `GET /api/racks/{rackId}/connections` (lignes `RackConnection`).
 */

import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { Slot } from "@/components/synoptique/lib/types";
import type { RackConnectionRow } from "./rack-model";

const port = (
  label: string,
  signalName: string,
  connectorTypeId: string,
  quantity: number,
  direction: "IN" | "OUT" | "BOTH",
  face: "FRONT" | "REAR" = "REAR",
) => ({ id: label, face, connectorTypeId, signalName, quantity, label, direction, gender: "FEMALE" });

export const CAMERA = {
  id: "eq1",
  name: "Caméra X",
  reference: "CX-1",
  heightU: 2,
  widthFraction: "FULL",
  depthMm: 300,
  isRackable: true,
  connectors: [port("SDI OUT", "12G-SDI", "ct-bnc", 2, "OUT"), port("REF", "12G-SDI", "ct-bnc", 1, "IN", "FRONT")],
  category: "Vidéo",
  brand: { id: "b1", name: "Sony" },
  functions: [],
  weight: 5,
  powerW: 100,
  heatBtuH: 341,
  hasDualPsu: true,
  is2110: false,
};

const MONITOR = {
  ...CAMERA,
  id: "eq2",
  name: "Moniteur 17",
  reference: "MON-17",
  heightU: 1,
  connectors: [port("SDI IN", "12G-SDI", "ct-bnc", 1, "IN"), port("AES", "AES3", "ct-xlr", 1, "IN")],
  brand: { id: "b2", name: "TVLogic" },
  weight: 4,
  powerW: 60,
  heatBtuH: null,
  hasDualPsu: false,
};

const POWER = {
  ...CAMERA,
  id: "eq3",
  name: "Alimentation",
  reference: "PSU-1",
  heightU: 1,
  connectors: [],
  brand: null,
  weight: 2.5,
  powerW: 0,
  heatBtuH: null,
  hasDualPsu: false,
};

/** Slot posé (réponse `canvas-data`, `rack.slots[]`). */
export const SLOT = {
  id: "s1",
  rackId: "r1",
  catalogEquipmentId: "eq1",
  equipmentId: "eq1",
  inventoryItemId: "i1",
  startU: 1,
  heightU: 2,
  view: "FRONT",
  widthFraction: "FULL",
  column: 0,
  label: "CAM 1",
  notes: null,
  panelId: null,
  panel: null,
  equipment: CAMERA,
  components: [],
  children: [],
};

/** Panel de patch posé (8 BNC), comme `PANEL_SLOT` de la 4b, emplacements équipés. */
export const PANEL_SLOT = {
  ...SLOT,
  id: "s2",
  catalogEquipmentId: null,
  equipmentId: null,
  inventoryItemId: null,
  startU: 5,
  heightU: 1,
  label: "PATCH A",
  equipment: null,
  panelId: "pn1",
  panel: {
    id: "pn1",
    name: "Patch BNC 8",
    heightU: 1,
    slotsPerU: 8,
    rearCableDepthMm: null,
    slots: Array.from({ length: 8 }, (_, i) => ({
      position: i + 1,
      connectorTypeId: "ct-bnc",
      connectorType: { iconId: "bnc", color: "#64748b", category: "Vidéo", name: "BNC" },
    })),
  },
  panelLabels: null,
};

export const MONITOR_SLOT = {
  ...SLOT,
  id: "s3",
  catalogEquipmentId: "eq2",
  equipmentId: "eq2",
  inventoryItemId: "i2",
  startU: 10,
  heightU: 1,
  label: "MON 1",
  equipment: MONITOR,
};

export const POWER_SLOT = {
  ...SLOT,
  id: "s4",
  catalogEquipmentId: "eq3",
  equipmentId: "eq3",
  inventoryItemId: "i3",
  startU: 20,
  heightU: 1,
  view: "REAR",
  label: "ALIM",
  equipment: POWER,
};

/** Réponse de `GET /api/tenant/projects/p1/racks/:rackId/canvas-data`. */
export function canvasData(id: string, name: string, slots: unknown[] = []): RackCanvasData {
  return {
    rack: {
      id,
      name,
      totalU: id === "r2" ? 12 : 42,
      depthMm: 600,
      maxWeightKg: null,
      maxPowerW: 1000,
      rackType: "STANDARD",
      rearInteriorGapMm: null,
      rigs: [],
      slots,
    },
    allEquipment: [CAMERA, MONITOR, POWER],
    rackAccessories: [],
    allPanels: [],
    categories: [
      { id: "f1", name: "Vidéo", color: "#3b82f6", children: [] },
      { id: "f2", name: "Audio", color: "#f59e0b", children: [] },
    ],
    connectorTypes: [
      { id: "ct-bnc", name: "BNC", version: null, iconId: "bnc", color: "#64748b", category: "Vidéo", functionId: "f1" },
      { id: "ct-xlr", name: "XLR3", version: null, iconId: "xlr3", color: "#64748b", category: "Audio", functionId: "f2" },
    ],
    signals: [
      { id: "sg1", name: "12G-SDI", color: "#3654ff", cablePrefix: "V", cableSuffix: null, functionId: "f1", isIp: false },
      { id: "sg2", name: "AES3", color: "#f59e0b", cablePrefix: "A", cableSuffix: null, functionId: "f2", isIp: false },
    ],
    signalCategories: [],
    patchPanelDepthMm: 100,
    cableSafetyDepthMm: 100,
  } as unknown as RackCanvasData;
}

const conn = (
  id: string,
  label: string | null,
  from: [string, number],
  to: [string, number],
): RackConnectionRow => ({
  id,
  rackId: "r1",
  fromSlotId: from[0],
  fromConnectorIndex: from[1],
  fromAdapterId: null,
  fromAdapterSide: null,
  fromAdapterPortIndex: null,
  fromComponentItemId: null,
  toSlotId: to[0],
  toConnectorIndex: to[1],
  toAdapterId: null,
  toAdapterSide: null,
  toAdapterPortIndex: null,
  toComponentItemId: null,
  label,
  color: null,
});

/**
 * Câbles du contenant :
 *  - V-0101 : CAM 1 SDI OUT 1 → MON 1 SDI IN (conforme) ;
 *  - sans numéro : CAM 1 SDI OUT 2 → PATCH A, port 1 arrière (un seul côté) ;
 *  - A-0101 : MON 1 AES → CAM 1 SDI OUT 1 (port déjà câblé, familles différentes).
 */
export const CONNECTIONS: RackConnectionRow[] = [
  conn("c1", "V-0101", ["s1", 0], ["s3", 0]),
  conn("c2", null, ["s1", 1], ["s2", 0]),
  conn("c3", "A-0101", ["s3", 1], ["s1", 0]),
];

export const SLOTS = [SLOT, PANEL_SLOT, MONITOR_SLOT, POWER_SLOT] as unknown as Slot[];

export const RACK = canvasData("r1", "Baie 1", SLOTS);
