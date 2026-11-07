/**
 * Modèle d'un contenant pour l'inspecteur, le dock bas et la vue Connectique
 * (interface Strata, spec §6.2, lot 3) : données de `canvas-data`, slots à
 * jour et câbles (`GET /api/racks/{rackId}/connections`).
 *
 * Index de port : un câble désigne un port par son index « à plat » dans la
 * connectique de l'équipement (entrées dans l'ordre, chacune développée selon
 * sa quantité, `quantity ?? 1`), comme le synoptique d'arkyo
 * (`use-validation-report.ts`, `expandedPortCount`). Les dessins désignent un
 * port par `"<index de l'entrée>:<n>"` (n à partir de 1).
 *
 * Une seule lecture de la connectique pour tout ce qui suit (face, entrées,
 * occupation, index de câble, contrôles) : `rackConnectors`, qui garde l'index
 * de chaque entrée brute et compte une entrée sans quantité pour 1 port.
 */

import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { Equipment, Slot } from "@/components/synoptique/lib/types";
import { parseConnectors, portFamilies, type CatalogueLookup, type PortFamily } from "../catalogue-model";
import { entryLabel, portCount } from "../drawings/face-layout";
import { portName } from "../drawings/equipment-face";

/** Ligne `RackConnection` (réponse de `GET /api/racks/{rackId}/connections`). */
export type RackConnectionRow = {
  id: string;
  rackId?: string;
  fromSlotId: string | null;
  fromConnectorIndex: number | null;
  fromAdapterId?: string | null;
  fromAdapterSide?: string | null;
  fromAdapterPortIndex?: number | null;
  fromComponentItemId?: string | null;
  toSlotId: string | null;
  toConnectorIndex: number | null;
  toAdapterId?: string | null;
  toAdapterSide?: string | null;
  toAdapterPortIndex?: number | null;
  toComponentItemId?: string | null;
  label: string | null;
  color?: string | null;
};

/** Un contenant affiché : son `canvas-data`, ses slots à jour, ses câbles (`null` au chargement). */
export type RackSource = {
  data: RackCanvasData;
  slots: Slot[];
  connections: RackConnectionRow[] | null;
};

/** Entrée illisible : gardée pour ne pas décaler les index, sans port ni face dessinée. */
const unreadable = (i: number): ConnectorEntry => ({
  id: String(i),
  face: "TOP",
  connectorTypeId: "",
  signalName: "",
  quantity: 0,
  label: "",
  direction: "BOTH",
  gender: "FEMALE",
});

/**
 * Connectique d'un équipement du contenant : `parseConnectors` entrée par
 * entrée (même index que le JSON brut), quantité absente = 1 port (arkyo :
 * `quantity ?? 1`), sinon `portCount`.
 */
export function rackConnectors(raw: unknown): ConnectorEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => {
    const [e] = parseConnectors([c]);
    if (!e) return unreadable(i);
    const q = (c as { quantity?: unknown }).quantity;
    return { ...e, id: typeof (c as { id?: unknown }).id === "string" ? e.id : String(i), quantity: q == null ? 1 : portCount(e) };
  });
}

/** Clé de port (`"<entrée>:<n>"`) d'un index de câble, `null` hors connectique. */
export function portKeyOfIndex(connectors: readonly ConnectorEntry[], index: number | null | undefined): string | null {
  if (index == null || index < 0) return null;
  let flat = 0;
  for (let e = 0; e < connectors.length; e++) {
    const q = portCount(connectors[e]);
    if (index < flat + q) return `${e}:${index - flat + 1}`;
    flat += q;
  }
  return null;
}

/** Tous les slots d'un contenant : premier niveau puis contenu des étagères. */
export function flattenSlots(slots: readonly Slot[]): Slot[] {
  return slots.flatMap((s) => [s, ...(s.children ?? [])]);
}

/** Repère d'un slot : son libellé, à défaut le nom de l'équipement ou du panel. */
export function slotTitle(slot: Pick<Slot, "label" | "equipment" | "panel">): string {
  return slot.label?.trim() || slot.equipment?.name || slot.panel?.name || "Sans nom";
}

/** Connectique lisible de l'équipement d'un slot. */
export function slotConnectors(slot: Pick<Slot, "equipment">): ConnectorEntry[] {
  return rackConnectors(slot.equipment?.connectors);
}

/** Nom d'un port à partir de sa clé (`"SDI 2"`), `null` si la clé est inconnue. */
export function portLabel(connectors: readonly ConnectorEntry[], key: string): string | null {
  const [ei, n] = key.split(":").map(Number);
  const e = connectors[ei];
  if (!e || !Number.isFinite(n)) return null;
  return portName(entryLabel(e) || "Port", portCount(e), n);
}

type Side = "from" | "to";

/** Extrémité d'un câble, telle que la base la stocke. */
function endOf(c: RackConnectionRow, side: Side) {
  return side === "from"
    ? {
        slotId: c.fromSlotId,
        index: c.fromConnectorIndex,
        adapterId: c.fromAdapterId ?? null,
        componentItemId: c.fromComponentItemId ?? null,
      }
    : {
        slotId: c.toSlotId,
        index: c.toConnectorIndex,
        adapterId: c.toAdapterId ?? null,
        componentItemId: c.toComponentItemId ?? null,
      };
}

/**
 * Port d'un slot occupé par une extrémité de câble. Les ports d'un composant
 * (châssis modulaire) appartiennent à la carte, pas à la face de l'hôte : ils
 * ne sont pas rapportés à l'hôte.
 */
function portOnSlot(c: RackConnectionRow, side: Side, slot: Slot): string | null {
  const end = endOf(c, side);
  if (end.slotId !== slot.id || end.adapterId || end.componentItemId) return null;
  return portKeyOfIndex(slotConnectors(slot), end.index);
}

/** Repère affiché d'un câble (`"—"` sans numéro). */
export function cableLabel(c: Pick<RackConnectionRow, "label">): string {
  return c.label?.trim() || "—";
}

/** Ports reliés d'un slot : clé de port → repère du câble. */
export function slotLinks(slot: Slot, connections: readonly RackConnectionRow[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of connections ?? []) {
    for (const side of ["from", "to"] as const) {
      const key = portOnSlot(c, side, slot);
      if (key) out[key] = cableLabel(c);
    }
  }
  return out;
}

/** Câble branché sur un port d'un slot, avec le côté du slot. */
export function cableAt(
  slot: Slot,
  key: string,
  connections: readonly RackConnectionRow[] | null,
): { cable: RackConnectionRow; side: Side } | null {
  for (const c of connections ?? []) {
    for (const side of ["from", "to"] as const) {
      if (portOnSlot(c, side, slot) === key) return { cable: c, side };
    }
  }
  return null;
}

/** Câbles d'un slot sur une face, avec la clé du port de ce slot. */
export function slotCablesOnFace(
  slot: Slot,
  face: "FRONT" | "REAR",
  connections: readonly RackConnectionRow[] | null,
): { cable: RackConnectionRow; side: Side; key: string }[] {
  const entries = slotConnectors(slot);
  const out: { cable: RackConnectionRow; side: Side; key: string }[] = [];
  for (const c of connections ?? []) {
    for (const side of ["from", "to"] as const) {
      const key = portOnSlot(c, side, slot);
      if (!key) continue;
      const e = entries[Number(key.split(":")[0])];
      if (e?.face === face) out.push({ cable: c, side, key });
    }
  }
  return out;
}

/**
 * Nom d'une extrémité de câble (`"CAM 1 · SDI 2"`). Un slot absent des slots
 * connus (autre contenant du lieu, élément supprimé) est nommé sans port.
 */
export function endName(c: RackConnectionRow, side: Side, slotsById: ReadonlyMap<string, Slot>): string {
  const end = endOf(c, side);
  if (end.adapterId) return "Adaptateur";
  const slot = end.slotId ? slotsById.get(end.slotId) : undefined;
  if (!slot) return "Hors contenant";
  if (end.componentItemId) {
    const comp = slot.components?.find((k) => k.itemId === end.componentItemId);
    return `${slotTitle(slot)} · ${comp?.equipment?.name ?? "composant"}`;
  }
  const key = portKeyOfIndex(slotConnectors(slot), end.index);
  const port = key ? portLabel(slotConnectors(slot), key) : null;
  return port ? `${slotTitle(slot)} · ${port}` : slotTitle(slot);
}

/** Index des slots (premier niveau et étagères) par id. */
export function slotsIndex(slots: readonly Slot[]): Map<string, Slot> {
  return new Map(flattenSlots(slots).map((s) => [s.id, s]));
}

/** Ordre naturel des repères (`V-0102` avant `V-0110`), sans numéro en dernier. */
const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
export function byCableLabel(a: RackConnectionRow, b: RackConnectionRow): number {
  const la = a.label?.trim();
  const lb = b.label?.trim();
  if (!la || !lb) return la ? -1 : lb ? 1 : 0;
  return collator.compare(la, lb);
}

/** Référentiels du catalogue tels que `canvas-data` les fournit (familles = fonctions). */
export function canvasLookup(data: RackCanvasData): CatalogueLookup {
  return {
    connectorTypes: data.connectorTypes.map((t) => ({ id: t.id, name: t.name, iconId: t.iconId })),
    signals: data.signals.map((s) => ({
      name: s.name,
      color: s.color,
      functionId: (s as { functionId?: string | null }).functionId ?? null,
    })),
    functions: data.categories.map((c) => ({ id: c.id, label: c.name, color: c.color })),
  };
}

/** Dissipation d'un équipement : `heatBtuH` du catalogue, sinon 1 W ≈ 3,412 BTU/h (fiche équipement). */
export function heatOf(eq: Equipment): number {
  const heat = (eq as { heatBtuH?: number | null }).heatBtuH;
  if (typeof heat === "number" && Number.isFinite(heat) && heat > 0) return heat;
  return (eq.powerW ?? 0) * 3.412;
}

/** Équipements d'un contenant : slots, contenu des étagères et composants des châssis. */
function equipmentOf(slots: readonly Slot[]): Equipment[] {
  return flattenSlots(slots).flatMap((s) => [
    ...(s.equipment ? [s.equipment] : []),
    ...(s.components ?? []).flatMap((k) => (k.equipment ? [k.equipment] : [])),
  ]);
}

export type RackBilan = {
  usedU: number;
  totalU: number;
  powerW: number;
  /** Capacité électrique du contenant (`Rack.maxPowerW`), `null` si non renseignée. */
  capacityW: number | null;
  weightKg: number;
  btu: number;
  ports: number;
  families: PortFamily[];
  /** Connectique de tous les équipements (barre des familles). */
  connectors: ConnectorEntry[];
};

/**
 * Bilan d'un contenant : U occupés (faces avant, arrière et arrière
 * intérieure, un U compté une fois), puissance et poids des équipements,
 * dissipation, ports par famille de signal.
 */
export function rackBilan(data: RackCanvasData, slots: readonly Slot[]): RackBilan {
  const used = new Set<number>();
  for (const s of slots) {
    if (s.parentSlotId || s.view === "SIDE" || s.startU == null || s.heightU == null) continue;
    for (let u = s.startU; u < s.startU + s.heightU && u <= data.rack.totalU; u++) used.add(u);
  }
  const eqs = equipmentOf(slots);
  const connectors = eqs.flatMap((e) => rackConnectors(e.connectors));
  const families = portFamilies(connectors, canvasLookup(data));
  const cap = data.rack.maxPowerW;
  return {
    usedU: used.size,
    totalU: data.rack.totalU,
    powerW: eqs.reduce((a, e) => a + (e.powerW ?? 0), 0),
    capacityW: typeof cap === "number" && cap > 0 ? cap : null,
    weightKg: eqs.reduce((a, e) => a + (e.weight ?? 0), 0),
    btu: Math.round(eqs.reduce((a, e) => a + heatOf(e), 0)),
    ports: families.reduce((a, f) => a + f.count, 0),
    families,
    connectors,
  };
}
