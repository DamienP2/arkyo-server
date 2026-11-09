/**
 * Gérer › Câbles, modèle (interface Strata v2, spec v2 §4.2) : la liste
 * agrégée de tous les câbles du projet, lue par les routes existantes (aucune
 * route nouvelle, spec v2 §5.4).
 *
 * Deux sortes de câbles dans arkyo :
 *   - `RackConnection` : câbles d'un contenant, et ceux du rack virtuel d'un
 *     lieu (entre deux contenants du lieu) ; modifiés par
 *     `PATCH /api/racks/{rackId}/connections/{id}` ;
 *   - `ProjectConnection` : câbles entre deux lieux (vue Générale du
 *     synoptique) ; modifiés par
 *     `PATCH /api/tenant/projects/{id}/synoptic/connections/{id}`.
 *
 * Lectures (`loadProjectCables`), en parallèle :
 *   - `GET …/synoptic/general` : câbles entre lieux, faisceaux du projet ;
 *   - `GET …/synoptic/location/{lieu}` par lieu qui a des contenants : la
 *     lecture du synoptique de lieu, qui porte d'un coup les câbles de tous
 *     ses contenants (rack virtuel compris), leurs slots (pour nommer les
 *     extrémités), adaptateurs et référentiels, et les câbles projet internes
 *     au lieu ;
 *   - pour un contenant sans emplacement (« À affecter »), absent des vues de
 *     lieu : `GET /api/racks/{id}/connections` et son `canvas-data` (slots) ;
 *   - le nom des modèles de câble (`GET /api/tenant/parametres/cable-models`,
 *     la liste du sélecteur de modèle du synoptique), seulement si un câble
 *     en porte un.
 * Un câble vu par deux lectures (vue de lieu et vue Générale, vue de lieu et
 * contenant) n'apparaît qu'une fois.
 *
 * Arkyo ne stocke aucune longueur de câble (Ruling 9) : le mode tableau
 * saisit numéro (`label`), couleur et notes.
 */

import type { InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import type { Equipment, Slot } from "@/components/synoptique/lib/types";
import { api } from "@/lib/api-client";
import { flattenSlots, portKeyOfIndex, portLabel, rackConnectors, slotTitle } from "../bottom/rack-model";
import type { DrawingConnectorType, DrawingSignal } from "../drawings/face-layout";

// ── Formes lues ─────────────────────────────────────────────────────────────

/** Ligne `RackConnection` (contenant ou vue de lieu). */
export type RawRackConnection = {
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
  notes?: string | null;
  tags?: unknown;
  cableStyle?: string | null;
  waypoints?: unknown;
  bundleId?: string | null;
  /** Vue de lieu : le faisceau du câble. */
  bundle?: { id: string; name: string; color: string } | null;
  catalogCableModelId?: string | null;
};

/** Ligne `ProjectConnection` (câble entre deux lieux). */
export type RawProjectConnection = Omit<RawRackConnection, "rackId" | "fromComponentItemId" | "toComponentItemId" | "bundle"> & {
  fromRackId: string;
  toRackId: string;
};

type CatalogType = { id: string; name: string; iconId?: string | null };
type CatalogSignal = { name: string; color: string };

type AdapterInstance = {
  id: string;
  rackId?: string;
  label: string | null;
  adapter: { id: string; name: string } | null;
};

/** Ce que Câbles lit de `GET …/synoptic/location/{lieu}`. */
export type LocationPayloadLite = {
  location: { id: string; name: string; cableCode?: string | null; virtualRackId?: string | null };
  racks: { id: string; name: string; isVirtual: boolean }[];
  slots: unknown[];
  connections: RawRackConnection[];
  projectConnections: RawProjectConnection[];
  adapters: AdapterInstance[];
  connectorTypes: CatalogType[];
  signals?: CatalogSignal[];
};

/** Ce que Câbles lit de `GET …/synoptic/general`. */
export type GeneralPayloadLite = {
  locations?: { id: string; name: string }[];
  connections: RawProjectConnection[];
  bundles?: { id: string; name: string; color: string }[];
  connectorTypes?: CatalogType[];
  signals?: CatalogSignal[];
};

export type CableRackRef = Pick<InventaireRack, "id" | "name"> & {
  locationId?: string | null;
  isVirtual?: boolean;
};

export type CableSources = {
  racks: readonly CableRackRef[];
  general: GeneralPayloadLite | null;
  locations: readonly LocationPayloadLite[];
  /** Contenants sans emplacement : leurs câbles et leur `canvas-data`. */
  orphans: readonly { rackId: string; connections: RawRackConnection[]; canvas: RackCanvasData | null }[];
  cableModels?: readonly { id: string; name: string }[];
};

// ── Lignes ──────────────────────────────────────────────────────────────────

export type CableKind = "rack" | "project";

export type CableEnd = {
  /** « CAM 1 · SDI OUT 2 ». */
  name: string;
  /** Repère du slot, de l'adaptateur, ou « Hors contenant ». */
  device: string;
  port: string | null;
  rackName: string | null;
  locationName: string | null;
  connectorTypeId: string | null;
  connectorName: string | null;
  iconId: string | null;
  /** Genre du port (`MALE` / `FEMALE`), `null` inconnu. */
  gender: string | null;
  signalName: string | null;
  face: ConnectorEntry["face"] | null;
  /** Équipement et port, pour dessiner la face (`null` hors équipement). */
  equipment: Equipment | null;
  portKey: string | null;
};

/** Référentiels communs aux dessins (une seule instance pour toutes les lignes). */
export type CableCatalog = { connectorTypes: DrawingConnectorType[]; signals: DrawingSignal[] };

export type CableRow = {
  id: string;
  kind: CableKind;
  /** Contenant du câble (`RackConnection.rackId`) ou contenant de départ (câble projet). */
  rackId: string;
  label: string | null;
  /** Couleur métier propre au câble (`null` : celle du signal). */
  color: string | null;
  notes: string | null;
  tags: { color: string; text: string }[];
  cableStyle: string | null;
  bundle: { id: string; name: string | null; color: string | null } | null;
  /** Points de passage dessinés sur le synoptique. */
  waypoints: number;
  catalogCableModelId: string | null;
  /** Modèle de câble, à défaut les types de connecteur des extrémités. */
  type: string;
  signal: { name: string; color: string | null } | null;
  from: CableEnd;
  to: CableEnd;
  /** Lieu du câble (« Régie »), ou des deux lieux (« Régie → Plateau »). */
  scope: string;
  catalog: CableCatalog;
};

export const UNASSIGNED = "À affecter";
const FREE = "Pose libre";

type SlotEntry = { slot: Slot; rackId: string };

type Index = {
  slots: Map<string, SlotEntry>;
  adapters: Map<string, AdapterInstance>;
  types: Map<string, CatalogType>;
  signals: Map<string, CatalogSignal>;
  rackName: Map<string, string>;
  rackLocation: Map<string, string>;
};

const SIDE_LABEL = ["arrière", "avant"];

/** Port d'un panel : emplacement et côté (deux ports par emplacement, arrière puis avant, rangées d'1 U). */
function panelPort(slot: Slot, index: number) {
  const panel = slot.panel as (Slot["panel"] & {
    slotsPerU?: number | null;
    slots?: { position: number; connectorTypeId?: string | null; connectorType?: { name?: string | null; iconId?: string | null } | null }[];
  }) | null;
  if (!panel) return null;
  const perU = Math.max(1, panel.slotsPerU ?? 1);
  const perRow = perU * 2;
  const row = Math.floor(index / perRow);
  const i = index % perRow;
  const position = row * perU + Math.floor(i / 2) + 1;
  const ps = panel.slots?.find((p) => p.position === position);
  return {
    port: `${position} ${SIDE_LABEL[i % 2]}`,
    connectorTypeId: ps?.connectorTypeId ?? null,
    connectorName: ps?.connectorType?.name ?? null,
    iconId: ps?.connectorType?.iconId ?? null,
    face: (i % 2 === 0 ? "REAR" : "FRONT") as ConnectorEntry["face"],
  };
}

type EndRef = {
  rackId: string | null;
  slotId: string | null;
  index: number | null;
  adapterId: string | null;
  adapterPortIndex: number | null;
  componentItemId: string | null;
};

function endRef(c: RawRackConnection | RawProjectConnection, side: "from" | "to", rackId: string | null): EndRef {
  const comp = (c as RawRackConnection)[`${side}ComponentItemId`];
  return {
    rackId,
    slotId: c[`${side}SlotId`] ?? null,
    index: c[`${side}ConnectorIndex`] ?? null,
    adapterId: c[`${side}AdapterId`] ?? null,
    adapterPortIndex: c[`${side}AdapterPortIndex`] ?? null,
    componentItemId: comp ?? null,
  };
}

function resolveEnd(ref: EndRef, ix: Index): CableEnd {
  const base: CableEnd = {
    name: "Hors contenant",
    device: "Hors contenant",
    port: null,
    rackName: null,
    locationName: null,
    connectorTypeId: null,
    connectorName: null,
    iconId: null,
    gender: null,
    signalName: null,
    face: null,
    equipment: null,
    portKey: null,
  };
  if (ref.adapterId) {
    const a = ix.adapters.get(ref.adapterId);
    const device = a?.label?.trim() || a?.adapter?.name || "Adaptateur";
    const port = ref.adapterPortIndex != null ? String(ref.adapterPortIndex + 1) : null;
    const rackId = a?.rackId ?? ref.rackId;
    return {
      ...base,
      name: port ? `${device} · ${port}` : device,
      device,
      port,
      rackName: rackId ? (ix.rackName.get(rackId) ?? null) : null,
      locationName: rackId ? (ix.rackLocation.get(rackId) ?? null) : null,
    };
  }
  const found = ref.slotId ? ix.slots.get(ref.slotId) : undefined;
  if (!found) return base;
  const { slot, rackId } = found;
  const device = slotTitle(slot);
  const where = { rackName: ix.rackName.get(rackId) ?? null, locationName: ix.rackLocation.get(rackId) ?? null };

  if (slot.panel && !ref.componentItemId) {
    const p = ref.index != null && ref.index >= 0 ? panelPort(slot, ref.index) : null;
    const type = p?.connectorTypeId ? ix.types.get(p.connectorTypeId) : undefined;
    return {
      ...base,
      ...where,
      name: p ? `${device} · ${p.port}` : device,
      device,
      port: p?.port ?? null,
      connectorTypeId: p?.connectorTypeId ?? null,
      connectorName: p?.connectorName ?? type?.name ?? null,
      iconId: p?.iconId ?? type?.iconId ?? null,
      face: p?.face ?? null,
    };
  }

  // Port d'un composant (châssis modulaire) : connectique de la carte.
  const comp = ref.componentItemId ? slot.components?.find((k) => k.itemId === ref.componentItemId) : undefined;
  const equipment = ref.componentItemId ? (comp?.equipment ?? null) : slot.equipment;
  const owner = ref.componentItemId ? `${device} · ${comp?.equipment?.name ?? "composant"}` : device;
  const connectors = rackConnectors(equipment?.connectors);
  const key = portKeyOfIndex(connectors, ref.index);
  const entry = key ? connectors[Number(key.split(":")[0])] : undefined;
  const port = key ? portLabel(connectors, key) : null;
  const type = entry?.connectorTypeId ? ix.types.get(entry.connectorTypeId) : undefined;
  return {
    ...base,
    ...where,
    name: port ? `${owner} · ${port}` : owner,
    device: owner,
    port,
    connectorTypeId: entry?.connectorTypeId || null,
    connectorName: type?.name ?? null,
    iconId: type?.iconId ?? null,
    gender: entry?.gender ?? null,
    signalName: entry?.signalName || null,
    face: entry?.face ?? null,
    equipment,
    portKey: key,
  };
}

function parseTags(raw: unknown): { color: string; text: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is { color: string; text: string } =>
      !!t && typeof (t as { text?: unknown }).text === "string" && typeof (t as { color?: unknown }).color === "string",
  );
}

const countPoints = (raw: unknown) => (Array.isArray(raw) ? raw.length : 0);

/** Ordre naturel des numéros (`V-0102` avant `V-0110`), câbles sans numéro en dernier. */
const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
function byLabel(a: CableRow, b: CableRow): number {
  const la = a.label?.trim();
  const lb = b.label?.trim();
  if (!la || !lb) return la ? -1 : lb ? 1 : 0;
  return collator.compare(la, lb);
}

/** Lignes agrégées, sans doublon, triées par numéro. */
export function aggregateCables(src: CableSources): CableRow[] {
  const ix: Index = {
    slots: new Map(),
    adapters: new Map(),
    types: new Map(),
    signals: new Map(),
    rackName: new Map(),
    rackLocation: new Map(),
  };
  const locationName = new Map<string, string>();
  for (const l of src.general?.locations ?? []) locationName.set(l.id, l.name);
  for (const p of src.locations) locationName.set(p.location.id, p.location.name);
  for (const r of src.racks) {
    ix.rackName.set(r.id, r.isVirtual ? FREE : r.name);
    ix.rackLocation.set(r.id, (r.locationId && locationName.get(r.locationId)) || UNASSIGNED);
  }

  const addTypes = (types: readonly CatalogType[] | undefined) => {
    for (const t of types ?? []) if (!ix.types.has(t.id)) ix.types.set(t.id, t);
  };
  const addSignals = (signals: readonly CatalogSignal[] | undefined) => {
    for (const s of signals ?? []) if (!ix.signals.has(s.name)) ix.signals.set(s.name, s);
  };
  const addSlots = (slots: readonly unknown[], rackId: (s: Slot & { rackId?: string }) => string) => {
    for (const s of flattenSlots(slots as Slot[])) {
      const withRack = s as Slot & { rackId?: string };
      if (!ix.slots.has(s.id)) ix.slots.set(s.id, { slot: s, rackId: withRack.rackId ?? rackId(withRack) });
    }
  };

  for (const p of src.locations) {
    for (const r of p.racks) {
      if (!ix.rackName.has(r.id)) ix.rackName.set(r.id, r.isVirtual ? FREE : r.name);
      ix.rackLocation.set(r.id, p.location.name);
    }
    addSlots(p.slots, () => p.location.virtualRackId ?? "");
    for (const a of p.adapters ?? []) ix.adapters.set(a.id, a);
    addTypes(p.connectorTypes);
    addSignals(p.signals);
  }
  for (const o of src.orphans) {
    if (!o.canvas) continue;
    addSlots(o.canvas.rack.slots as unknown[], () => o.rackId);
    addTypes(o.canvas.connectorTypes);
    addSignals(o.canvas.signals);
  }
  addTypes(src.general?.connectorTypes);
  addSignals(src.general?.signals);

  const catalog: CableCatalog = {
    connectorTypes: [...ix.types.values()].map((t) => ({ id: t.id, name: t.name, iconId: t.iconId ?? "" })),
    signals: [...ix.signals.values()].map((s) => ({ name: s.name, color: s.color })),
  };
  const models = new Map((src.cableModels ?? []).map((m) => [m.id, m.name]));
  const projectBundles = new Map((src.general?.bundles ?? []).map((b) => [b.id, b]));

  const seen = new Set<string>();
  const rows: CableRow[] = [];

  const push = (
    kind: CableKind,
    c: RawRackConnection | RawProjectConnection,
    rackId: string,
    from: EndRef,
    to: EndRef,
    bundle: CableRow["bundle"],
  ) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const a = resolveEnd(from, ix);
    const b = resolveEnd(to, ix);
    const signalName = a.signalName ?? b.signalName;
    const typeNames = [...new Set([a.connectorName, b.connectorName].filter((n): n is string => !!n))];
    const model = c.catalogCableModelId ? models.get(c.catalogCableModelId) : undefined;
    const scopeA = a.locationName ?? ix.rackLocation.get(from.rackId ?? rackId) ?? UNASSIGNED;
    const scopeB = b.locationName ?? (to.rackId ? (ix.rackLocation.get(to.rackId) ?? UNASSIGNED) : scopeA);
    rows.push({
      id: c.id,
      kind,
      rackId,
      label: c.label ?? null,
      color: c.color || null,
      notes: c.notes ?? null,
      tags: parseTags(c.tags),
      cableStyle: c.cableStyle ?? null,
      bundle,
      waypoints: countPoints(c.waypoints),
      catalogCableModelId: c.catalogCableModelId ?? null,
      type: model ?? (typeNames.length ? typeNames.join(" / ") : "—"),
      signal: signalName ? { name: signalName, color: ix.signals.get(signalName)?.color ?? null } : null,
      from: a,
      to: b,
      scope: kind === "project" && scopeA !== scopeB ? `${scopeA} → ${scopeB}` : scopeA,
      catalog,
    });
  };

  const rackCable = (c: RawRackConnection, fallbackRack: string) => {
    const rackId = c.rackId ?? fallbackRack;
    const bundle = c.bundle
      ? { id: c.bundle.id, name: c.bundle.name, color: c.bundle.color }
      : c.bundleId
        ? { id: c.bundleId, name: null, color: null }
        : null;
    push("rack", c, rackId, endRef(c, "from", rackId), endRef(c, "to", rackId), bundle);
  };
  const projectCable = (c: RawProjectConnection) => {
    const b = c.bundleId ? projectBundles.get(c.bundleId) : undefined;
    const bundle = c.bundleId ? { id: c.bundleId, name: b?.name ?? null, color: b?.color ?? null } : null;
    push("project", c, c.fromRackId, endRef(c, "from", c.fromRackId), endRef(c, "to", c.toRackId), bundle);
  };

  for (const p of src.locations) {
    for (const c of p.connections) rackCable(c, p.location.virtualRackId ?? "");
    for (const c of p.projectConnections ?? []) projectCable(c);
  }
  for (const o of src.orphans) for (const c of o.connections) rackCable(c, o.rackId);
  for (const c of src.general?.connections ?? []) projectCable(c);

  return rows.sort(byLabel);
}

/**
 * Tous les câbles du projet (lectures en parallèle, voir l'en-tête). Une
 * lecture en échec fait échouer le tout : une liste partielle serait prise
 * pour la liste complète.
 */
export async function loadProjectCables(projectId: string, racks: readonly CableRackRef[]): Promise<CableRow[]> {
  const base = `/api/tenant/projects/${projectId}`;
  const locationIds = [...new Set(racks.map((r) => r.locationId).filter((id): id is string => !!id))];
  const orphanRacks = racks.filter((r) => !r.locationId && !r.isVirtual);
  const [general, locations, orphans] = await Promise.all([
    api.get<GeneralPayloadLite>(`${base}/synoptic/general`),
    Promise.all(locationIds.map((id) => api.get<LocationPayloadLite>(`${base}/synoptic/location/${id}`))),
    Promise.all(
      orphanRacks.map(async (r) => {
        const [connections, canvas] = await Promise.all([
          api.get<RawRackConnection[]>(`/api/racks/${r.id}/connections`),
          api.get<RackCanvasData>(`${base}/racks/${r.id}/canvas-data`),
        ]);
        return { rackId: r.id, connections: Array.isArray(connections) ? connections : [], canvas };
      }),
    ),
  ]);
  const src: CableSources = {
    racks,
    general: general ?? null,
    locations: locations.map((l) => ({ ...l, projectConnections: l.projectConnections ?? [], adapters: l.adapters ?? [] })),
    orphans,
  };
  const withModel = [
    ...src.locations.flatMap((l) => [...l.connections, ...l.projectConnections]),
    ...orphans.flatMap((o) => o.connections),
    ...(src.general?.connections ?? []),
  ].some((c) => !!c.catalogCableModelId);
  if (withModel) {
    // Noms des modèles : facultatifs (un modèle inconnu laisse les types de connecteur).
    const models = await api
      .get<{ models?: { id: string; name: string }[] }>("/api/tenant/parametres/cable-models")
      .catch(() => null);
    src.cableModels = models?.models ?? [];
  }
  return aggregateCables(src);
}

// ── Temps réel ──────────────────────────────────────────────────────────────

/**
 * Entités du flux applicatif qui changent la liste : câbles (contenant,
 * projet, renumérotation), et ce qui nomme leurs extrémités (slots,
 * adaptateurs, ports externes, faisceaux, contenants, lieux).
 */
const CABLE_ENTITIES = new Set([
  "rackConnection",
  "project_synoptic_connection",
  "slot",
  "synopticAdapter",
  "external_port",
  "cableBundle",
  "rack",
  "location",
]);

/** Évènement `/api/events` qui touche les câbles de ce projet. */
export function isCableEvent(data: unknown, projectId: string, rackIds: readonly string[]): boolean {
  const e = data as { type?: unknown; entity?: unknown; projectId?: unknown; rackId?: unknown; id?: unknown } | null;
  if (e?.type !== "update" || typeof e.entity !== "string" || !CABLE_ENTITIES.has(e.entity)) return false;
  if (e.projectId === projectId) return true;
  const rack = typeof e.rackId === "string" ? e.rackId : null;
  return rack != null && rackIds.includes(rack);
}

// ── Mode tableau ────────────────────────────────────────────────────────────

/** Champs saisis en mode tableau. */
export type CableField = "label" | "color" | "notes";
export type CableDraft = Partial<Record<CableField, string>>;

export const CABLE_FIELDS: readonly CableField[] = ["label", "color", "notes"];

/** Valeur d'un champ, telle que la cellule l'affiche. */
export function cableValue(row: CableRow, field: CableField): string {
  return (row[field] ?? "").toString();
}

/** Couleur saisie : `#rgb` ou `#rrggbb`. */
export const isHexColor = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

/**
 * Erreur d'une saisie, `null` si elle est valable. Une couleur ne s'efface
 * pas sur un câble de contenant : la route n'efface pas (`null` = inchangé).
 */
export function cableCellError(row: CableRow, field: CableField, value: string): string | null {
  const v = value.trim();
  if (field === "color") {
    if (!v) return row.kind === "rack" && row.color ? "La couleur d'un câble de contenant ne s'efface pas" : null;
    return isHexColor(v) ? null : "Couleur invalide (#rrggbb)";
  }
  if (field === "notes" && value.length > 2000) return "2 000 caractères au plus";
  return null;
}

export type CableWrite = {
  method: "PATCH" | "POST";
  url: string;
  body: Record<string, unknown>;
  /** Câbles concernés. */
  ids: string[];
};

/**
 * Requêtes d'enregistrement : un `PATCH` par ligne modifiée, sur la route du
 * câble (contenant ou projet), avec les seuls champs changés. Un numéro
 * effacé sur un câble de contenant passe par la route d'effacement d'arkyo
 * (`POST /api/racks/{id}/renumber {clearIds}`, une par contenant), le `PATCH`
 * lisant `null` comme « inchangé ».
 */
export function cableWrites(edits: readonly { row: CableRow; draft: CableDraft }[], projectId: string): CableWrite[] {
  const out: CableWrite[] = [];
  const clears = new Map<string, CableWrite>();
  for (const { row, draft } of edits) {
    const body: Record<string, unknown> = {};
    let clear = false;
    for (const f of CABLE_FIELDS) {
      const next = draft[f];
      if (next === undefined) continue;
      const value = f === "notes" ? next : next.trim();
      if (value === cableValue(row, f)) continue;
      if (row.kind === "project") body[f] = value === "" ? null : value;
      else if (f === "label" && value === "") clear = true;
      else body[f] = value;
    }
    if (Object.keys(body).length > 0)
      out.push({
        method: "PATCH",
        url:
          row.kind === "project"
            ? `/api/tenant/projects/${projectId}/synoptic/connections/${row.id}`
            : `/api/racks/${row.rackId}/connections/${row.id}`,
        body,
        ids: [row.id],
      });
    if (clear) {
      const pending = clears.get(row.rackId);
      if (pending) {
        (pending.body.clearIds as string[]).push(row.id);
        pending.ids.push(row.id);
      } else {
        const w: CableWrite = { method: "POST", url: `/api/racks/${row.rackId}/renumber`, body: { clearIds: [row.id] }, ids: [row.id] };
        clears.set(row.rackId, w);
        out.push(w);
      }
    }
  }
  return out;
}
