"use client";

/**
 * LocationCanvas — vue « emplacement » du synoptique projet.
 *
 * Même approche que `GeneralCanvas` : ZÉRO reproduction de code, on monte le
 * `SynopticView` avec un payload agrégé. La différence majeure est que les
 * nœuds ne sont PAS synthétiques — ce sont les vrais `RackSlot` de tous les
 * contenants du lieu (contenant virtuel du lieu inclus, qui porte les
 * équipements libres).
 *
 * Trois points de mécanique :
 *
 *  1. **Un seul repère.** Le canvas du lieu partage les coordonnées stockées
 *     (`RackSlot.synopticX/Y`, `RackSlotPanelRow`, adaptateurs) avec les vues
 *     focus par contenant. Comme chaque contenant a historiquement été
 *     positionné dans SON repère, les îlots se chevauchent à la première
 *     ouverture → **dé-collision one-shot persistée** (décalage horizontal des
 *     îlots suivants), après quoi les écritures directes du SynopticView
 *     restent valides sans traduction.
 *
 *  2. **Écritures routées par slot.** Le `rackId` scalaire passé au
 *     SynopticView est le contenant VIRTUEL du lieu (« pivot ») : il porte le
 *     décor (zones, libellés, faisceaux). Les écritures ancrées à un slot
 *     (positions, panel-rows, ports externes, adaptateurs) sont routées vers
 *     le contenant réel grâce à `slot.rackId` (cf. `rackFor` dans
 *     `synoptic-view.tsx`).
 *
 *  3. **Câblage routé par extrémités.** Deux extrémités dans le même contenant
 *     → `RackConnection` (`/api/racks/[id]/connections`). Extrémités dans deux
 *     contenants différents → `ProjectConnection`
 *     (`/api/tenant/projects/[id]/synoptic/connections`), virtualisée côté
 *     client avec un id préfixé `pc:`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/client-id";
import { SynopticView, type SynopticViewHandle } from "@/components/synoptique/synoptic-view";
import {
  type CablingApiAdapter,
  type CablingCreatePayload,
  type CablingPatchPayload,
  type CablingRenumberPayload,
} from "@/components/synoptique/lib/cabling-api";
import { parseAdapterSlotId, type DbConnection } from "@/components/synoptique/lib/connection-devirt";
import { LABEL_COLORS } from "@/components/synoptique/lib/constants";
import { getVirtualRowInfo } from "@/components/synoptique/types/synoptic";
import type {
  RackSlotWithEquipment,
  RackConnection,
  ConnectorTypeInfo,
  DbZone,
  DbLabel,
  ExternalPortData,
} from "@/components/synoptique/types/synoptic";
import type { SynopticAdapterInstance } from "@/components/synoptique/components/synoptic-adapter-node";

// ── Types payload ────────────────────────────────────────────────────────────

export type LocationRackInfo = {
  id: string;
  name: string;
  cableCode: string | null;
  cableId: number | null;
  numberingOverride: unknown;
  isVirtual: boolean;
  totalU: number | null;
  rackType: string;
};

/** ProjectConnection brute (forme DB, endpoints cross-rack complets). */
export type ProjectConnectionRaw = {
  id: string;
  fromRackId: string;
  fromSlotId: string | null;
  fromConnectorIndex: number | null;
  fromAdapterId: string | null;
  fromAdapterSide: "left" | "right" | null;
  fromAdapterPortIndex: number | null;
  toRackId: string;
  toSlotId: string | null;
  toConnectorIndex: number | null;
  toAdapterId: string | null;
  toAdapterSide: "left" | "right" | null;
  toAdapterPortIndex: number | null;
  label: string | null;
  color: string | null;
  waypoints: unknown;
  cableStyle: string | null;
  notes?: string | null;
  tags?: unknown;
  bundleId?: string | null;
  catalogCableModelId?: string | null;
};

export type LocationPanelRow = {
  slotId: string;
  rowIndex: number;
  synopticX: number;
  synopticY: number;
  rackId?: string;
};

export type LocationPayload = {
  location: {
    id: string;
    name: string;
    cableCode: string | null;
    virtualRackId: string;
  };
  racks: LocationRackInfo[];
  slots: RackSlotWithEquipment[];
  connections: RackConnection[];
  projectConnections: ProjectConnectionRaw[];
  zones: DbZone[];
  labels: DbLabel[];
  adapters: SynopticAdapterInstance[];
  externalPorts: ExternalPortData[];
  panelRows: LocationPanelRow[];
  bundles?: Array<{ id: string; name: string; color: string }>;
  connectorTypes: ConnectorTypeInfo[];
  signals?: Array<{
    name: string;
    color: string;
    cablePrefix?: string | null;
    cableSuffix?: string | null;
    category?: string | null;
    categoryRef?: { name: string; cablePrefix: string | null; cableSuffix: string | null } | null;
    isIp?: boolean;
  }>;
  signalCategories?: Array<{ name: string; cablePrefix: string | null; cableSuffix: string | null }>;
  equipmentCategories?: Array<{
    id: string;
    name: string;
    color: string;
    children: { id: string; name: string; color: string }[];
  }>;
  appConfig: Record<string, string>;
  project?: { id: string; name: string };
};

// ── Virtualisation ProjectConnection ⇄ RackConnection ────────────────────────

/** Préfixe des ids de connexion projet côté client. */
export const PROJECT_CONNECTION_PREFIX = "pc:";

export function isProjectConnectionId(id: string): boolean {
  return id.startsWith(PROJECT_CONNECTION_PREFIX);
}

function projectConnectionDbId(id: string): string {
  return id.slice(PROJECT_CONNECTION_PREFIX.length);
}

/**
 * ProjectConnection → forme DbConnection consommée par le SynopticView.
 * Les extrémités étant des slots/adaptateurs RÉELS, la conversion est directe :
 * seuls l'id (préfixé) et le `rackId` d'affichage changent.
 */
function virtualizeProjectConnection(pc: ProjectConnectionRaw): DbConnection {
  return {
    id: `${PROJECT_CONNECTION_PREFIX}${pc.id}`,
    rackId: pc.fromRackId,
    fromSlotId: pc.fromSlotId,
    fromConnectorIndex: pc.fromConnectorIndex ?? 0,
    fromAdapterId: pc.fromAdapterId,
    fromAdapterSide: pc.fromAdapterSide,
    fromAdapterPortIndex: pc.fromAdapterPortIndex,
    toSlotId: pc.toSlotId,
    toConnectorIndex: pc.toConnectorIndex ?? 0,
    toAdapterId: pc.toAdapterId,
    toAdapterSide: pc.toAdapterSide,
    toAdapterPortIndex: pc.toAdapterPortIndex,
    label: pc.label,
    color: pc.color,
    waypoints: pc.waypoints,
    cableStyle: pc.cableStyle,
    catalogCableModelId: pc.catalogCableModelId ?? null,
  } as unknown as DbConnection;
}

// ── Dé-collision des îlots ───────────────────────────────────────────────────

/** Largeur de nœud de référence (cf. NODE_W) pour borner un îlot à droite. */
const ISLAND_NODE_W = 300;
/** Écart horizontal constant entre deux îlots de contenants. */
const ISLAND_GAP = 240;

type Island = { rackId: string; minX: number; maxX: number };

function decollisionStorageKey(locationId: string) {
  return `synoptic-loc-decollision:${locationId}`;
}

function readDecollisionFlag(locationId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(decollisionStorageKey(locationId)) === "1";
  } catch {
    return false;
  }
}

function writeDecollisionFlag(locationId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(decollisionStorageKey(locationId), "1");
  } catch {
    /* localStorage indisponible — pas critique */
  }
}

/**
 * Calcule le décalage horizontal à appliquer à chaque contenant pour que les
 * îlots ne se chevauchent plus. Retourne une map rackId → dx (dx ≠ 0
 * uniquement pour les îlots à décaler).
 */
export function computeIslandShifts(payload: LocationPayload): Map<string, number> {
  const bounds = new Map<string, { minX: number; maxX: number }>();
  const push = (rackId: string | undefined, x: number | null | undefined) => {
    if (!rackId || x == null || !Number.isFinite(x)) return;
    const cur = bounds.get(rackId);
    if (!cur) bounds.set(rackId, { minX: x, maxX: x });
    else {
      if (x < cur.minX) cur.minX = x;
      if (x > cur.maxX) cur.maxX = x;
    }
  };

  const walk = (list: RackSlotWithEquipment[]) => {
    for (const s of list) {
      push(s.rackId, s.synopticX);
      const children = (s as { children?: RackSlotWithEquipment[] }).children;
      if (Array.isArray(children)) walk(children);
    }
  };
  walk(payload.slots);
  const slotRack = buildSlotRackMap(payload.slots);
  for (const row of payload.panelRows ?? []) {
    push(row.rackId ?? slotRack.get(row.slotId), row.synopticX);
  }
  for (const ad of payload.adapters ?? []) {
    push(ad.rackId, ad.x);
  }

  const islands: Island[] = [...bounds.entries()]
    .map(([rackId, b]) => ({ rackId, minX: b.minX, maxX: b.maxX + ISLAND_NODE_W }))
    .sort((a, b) => a.minX - b.minX || a.rackId.localeCompare(b.rackId));

  const shifts = new Map<string, number>();
  if (islands.length < 2) return shifts;
  let cursor = islands[0].maxX + ISLAND_GAP;
  for (let i = 1; i < islands.length; i++) {
    const island = islands[i];
    if (island.minX < cursor) {
      const dx = Math.round(cursor - island.minX);
      shifts.set(island.rackId, dx);
      cursor = island.maxX + dx + ISLAND_GAP;
    } else {
      cursor = island.maxX + ISLAND_GAP;
    }
  }
  return shifts;
}

function buildSlotRackMap(slots: RackSlotWithEquipment[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (list: RackSlotWithEquipment[]) => {
    for (const s of list) {
      if (s.rackId) map.set(s.id, s.rackId);
      const children = (s as { children?: RackSlotWithEquipment[] }).children;
      if (Array.isArray(children)) walk(children);
    }
  };
  walk(slots);
  return map;
}

/** Décale en x une liste de waypoints `{x,y}[]` (champ Json natif). */
function shiftWaypoints(waypoints: unknown, dx: number): unknown {
  if (dx === 0 || !Array.isArray(waypoints)) return waypoints;
  return waypoints.map((wp) =>
    wp && typeof wp === "object" && typeof (wp as { x?: unknown }).x === "number"
      ? { ...(wp as { x: number; y: number }), x: (wp as { x: number }).x + dx }
      : wp,
  );
}

/** Applique les décalages calculés au payload (copie, jamais de mutation). */
function applyShifts(payload: LocationPayload, shifts: Map<string, number>): LocationPayload {
  if (shifts.size === 0) return payload;
  const slotRack = buildSlotRackMap(payload.slots);
  const shiftSlot = (s: RackSlotWithEquipment): RackSlotWithEquipment => {
    const dx = s.rackId ? (shifts.get(s.rackId) ?? 0) : 0;
    const children = (s as { children?: RackSlotWithEquipment[] }).children;
    const nextChildren = Array.isArray(children) ? children.map(shiftSlot) : children;
    if (dx === 0 && nextChildren === children) return s;
    return {
      ...s,
      synopticX: s.synopticX != null && dx !== 0 ? s.synopticX + dx : s.synopticX,
      ...(nextChildren ? { children: nextChildren } : {}),
    } as RackSlotWithEquipment;
  };
  return {
    ...payload,
    slots: payload.slots.map(shiftSlot),
    // Les tracés manuels intra-contenant suivent leur îlot (les liaisons
    // inter-contenants ne sont pas décalées : leurs extrémités bougent
    // différemment, le recalcul auto reprend la main).
    connections: (payload.connections ?? []).map((c) => {
      const dx = shifts.get(c.rackId) ?? 0;
      return dx === 0 ? c : { ...c, waypoints: shiftWaypoints(c.waypoints, dx) };
    }),
    panelRows: (payload.panelRows ?? []).map((row) => {
      const rid = row.rackId ?? slotRack.get(row.slotId);
      const dx = rid ? (shifts.get(rid) ?? 0) : 0;
      return dx === 0 ? row : { ...row, synopticX: row.synopticX + dx };
    }),
    adapters: (payload.adapters ?? []).map((ad) => {
      const dx = shifts.get(ad.rackId) ?? 0;
      return dx === 0 ? ad : { ...ad, x: ad.x + dx };
    }),
    externalPorts: (payload.externalPorts ?? []).map((ext) => {
      const rid = ext.rackId ?? slotRack.get(ext.slotId);
      const dx = rid ? (shifts.get(rid) ?? 0) : 0;
      return dx === 0 || ext.labelX == null ? ext : { ...ext, labelX: ext.labelX + dx };
    }),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

// Références STABLES pour les props `initial*` : une nouvelle référence à
// chaque render ferait tirer les `useEffect` de re-sync du SynopticView
// (setAdapters(initialAdapters)…) → boucle de rendu.
const EMPTY_ARRAY: never[] = [];
const EMPTY_SIGNALS: never[] = [];
const EMPTY_SIGNAL_CATEGORIES: never[] = [];

export const LocationCanvas = forwardRef<
  SynopticViewHandle,
  {
    projectId: string;
    payload: LocationPayload;
    /**
     * Vue de LECTURE seule — sur-modal d'export, hôte de génération. Elle ne
     * publie rien vers le shell, ne capte pas le clavier global, n'ouvre ni
     * WebSocket de curseurs ni flux SSE, et surtout **n'écrit jamais en base**.
     *
     * Ce dernier point est le motif de la prop. La dé-collision des îlots est
     * persistée au PREMIER montage d'un lieu : sans ce garde, générer un
     * dossier sur un projet dont le synoptique n'a jamais été ouvert
     * repositionnerait les équipements en base, sans geste de l'utilisateur.
     * Les décalages restent CALCULÉS et appliqués à l'affichage — le document
     * doit montrer ce que l'onglet montrera — mais rien ne part au serveur.
     */
    readOnly?: boolean;
    /** Demande un refetch après une mutation non gérée en optimiste. */
    onRefresh?: () => void;
    onCableDetailsChange?: Parameters<typeof SynopticView>[0]["onCableDetailsChange"];
    onNodeDetailsChange?: Parameters<typeof SynopticView>[0]["onNodeDetailsChange"];
    onAdapterDetailsChange?: Parameters<typeof SynopticView>[0]["onAdapterDetailsChange"];
    onZoneDetailsChange?: Parameters<typeof SynopticView>[0]["onZoneDetailsChange"];
    onLabelDetailsChange?: Parameters<typeof SynopticView>[0]["onLabelDetailsChange"];
    onExternalDetailsChange?: Parameters<typeof SynopticView>[0]["onExternalDetailsChange"];
    onMultiCableSelectionChange?: Parameters<
      typeof SynopticView
    >[0]["onMultiCableSelectionChange"];
    onMultiNodeSelectionChange?: Parameters<typeof SynopticView>[0]["onMultiNodeSelectionChange"];
    onMultiExternalSelectionChange?: Parameters<
      typeof SynopticView
    >[0]["onMultiExternalSelectionChange"];
    onConnectionsChange?: Parameters<typeof SynopticView>[0]["onConnectionsChange"];
    onToolChange?: (toolId: string) => void;
    onZoomChange?: (zoom: number) => void;
    onRenumberPanelChange?: (node: ReactNode | null) => void;
    onManualPanelChange?: (node: ReactNode | null) => void;
    cableNumbering?: Parameters<typeof SynopticView>[0]["cableNumbering"];
  }
>(function LocationCanvasInner(
  {
    projectId,
    payload,
    readOnly = false,
    onRefresh: _onRefresh,
    onCableDetailsChange,
    onNodeDetailsChange,
    onAdapterDetailsChange,
    onZoneDetailsChange,
    onLabelDetailsChange,
    onExternalDetailsChange,
    onMultiCableSelectionChange,
    onMultiNodeSelectionChange,
    onMultiExternalSelectionChange,
    onConnectionsChange,
    onToolChange,
    onZoomChange,
    onRenumberPanelChange,
    onManualPanelChange,
    cableNumbering,
  },
  forwardedRef,
) {
  const locationId = payload.location.id;
  const pivotRackId = payload.location.virtualRackId;

  // ── Dé-collision one-shot ────────────────────────────────────────────────
  // Calculée au montage, sur le PREMIER payload uniquement : une fois
  // persistée, les payloads suivants portent déjà les coordonnées corrigées.
  const firstPayloadRef = useRef(payload);
  const [shifts] = useState<Map<string, number>>(() =>
    readDecollisionFlag(locationId)
      ? new Map<string, number>()
      : computeIslandShifts(payload),
  );
  const effective = useMemo(
    () => (payload === firstPayloadRef.current ? applyShifts(payload, shifts) : payload),
    [payload, shifts],
  );

  // Persistance silencieuse des positions décalées — une seule fois.
  const persistedRef = useRef(false);
  useEffect(() => {
    // Une vue de lecture n'écrit RIEN : ni le drapeau, ni les positions. Elle
    // affiche les décalages, elle ne les grave pas.
    if (readOnly) return;
    if (persistedRef.current) return;
    persistedRef.current = true;
    writeDecollisionFlag(locationId);
    if (shifts.size === 0) return;
    const src = firstPayloadRef.current;
    const slotRack = buildSlotRackMap(src.slots);
    const tasks: Promise<unknown>[] = [];
    const walk = (list: RackSlotWithEquipment[]) => {
      for (const s of list) {
        const dx = s.rackId ? (shifts.get(s.rackId) ?? 0) : 0;
        if (dx !== 0 && s.synopticX != null && s.synopticY != null && !s.panel) {
          tasks.push(
            apiFetch(`/api/racks/${s.rackId}/slots/${s.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ synopticX: s.synopticX + dx, synopticY: s.synopticY }),
            }).catch(() => null),
          );
        }
        const children = (s as { children?: RackSlotWithEquipment[] }).children;
        if (Array.isArray(children)) walk(children);
      }
    };
    walk(src.slots);
    for (const row of src.panelRows ?? []) {
      const rid = row.rackId ?? slotRack.get(row.slotId);
      const dx = rid ? (shifts.get(rid) ?? 0) : 0;
      if (dx === 0 || !rid) continue;
      tasks.push(
        apiFetch(`/api/racks/${rid}/panel-rows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotId: row.slotId,
            rowIndex: row.rowIndex,
            x: row.synopticX + dx,
            y: row.synopticY,
          }),
        }).catch(() => null),
      );
    }
    for (const ad of src.adapters ?? []) {
      const dx = shifts.get(ad.rackId) ?? 0;
      if (dx === 0) continue;
      tasks.push(
        apiFetch(`/api/racks/${ad.rackId}/adapters/${ad.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: ad.x + dx, y: ad.y }),
        }).catch(() => null),
      );
    }
    for (const ext of src.externalPorts ?? []) {
      const rid = ext.rackId ?? slotRack.get(ext.slotId);
      const dx = rid ? (shifts.get(rid) ?? 0) : 0;
      if (dx === 0 || !rid || ext.labelX == null) continue;
      tasks.push(
        apiFetch(`/api/racks/${rid}/external-ports/${ext.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelX: ext.labelX + dx, labelY: ext.labelY }),
        }).catch(() => null),
      );
    }
    for (const conn of src.connections ?? []) {
      const dx = shifts.get(conn.rackId) ?? 0;
      if (dx === 0 || !Array.isArray(conn.waypoints) || conn.waypoints.length === 0) continue;
      tasks.push(
        apiFetch(`/api/racks/${conn.rackId}/connections/${conn.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: shiftWaypoints(conn.waypoints, dx) }),
        }).catch(() => null),
      );
    }
    void Promise.all(tasks);
  }, [locationId, shifts, readOnly]);

  // ── Index de routage ─────────────────────────────────────────────────────
  const slotRackMap = useMemo(() => buildSlotRackMap(effective.slots), [effective.slots]);
  const adapterRackMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ad of effective.adapters ?? []) map.set(ad.id, ad.rackId);
    return map;
  }, [effective.adapters]);
  const rackIds = useMemo(() => effective.racks.map((r) => r.id), [effective.racks]);
  const rackIdsKey = rackIds.join(",");
  // Pastille « contenant » sur les nœuds : uniquement les contenants réels.
  // Le rack virtuel du lieu est exclu → les équipements libres n'en portent pas.
  // Couleur stable par contenant (hash de l'id → palette LABEL_COLORS) pour
  // repérer d'un coup d'œil les nœuds d'un même contenant.
  const rackLabels = useMemo(() => {
    const hash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    };
    const map: Record<string, { name: string; color: string }> = {};
    for (const r of effective.racks) {
      if (r.isVirtual || r.id === pivotRackId) continue;
      map[r.id] = {
        name: r.name,
        color: LABEL_COLORS[hash(r.id) % LABEL_COLORS.length],
      };
    }
    return map;
  }, [effective.racks, pivotRackId]);

  /**
   * Contenant d'un slot (réel, panel row virtuel ou adaptateur virtuel).
   * `null` = non résolu (le caller décide du repli sur le pivot).
   */
  const rackOfSlotOrNull = useCallback(
    (slotId: string | null | undefined): string | null => {
      if (!slotId) return null;
      const direct = slotRackMap.get(slotId);
      if (direct) return direct;
      const ad = parseAdapterSlotId(slotId);
      if (ad) return adapterRackMap.get(ad.adapterId) ?? null;
      const info = getVirtualRowInfo(slotId);
      if (info) return slotRackMap.get(info.slotId) ?? null;
      return null;
    },
    [slotRackMap, adapterRackMap],
  );
  const rackOfSlot = useCallback(
    (slotId: string | null | undefined): string => rackOfSlotOrNull(slotId) ?? pivotRackId,
    [rackOfSlotOrNull, pivotRackId],
  );

  /**
   * Contenant d'une extrémité déjà dévirtualisée par le SynopticView
   * (le payload reçu par le cablingApi est en forme DB).
   */
  const rackOfEndpoint = useCallback(
    (slotId: string | null | undefined, adapterId: string | null | undefined): string | null => {
      if (adapterId) return adapterRackMap.get(adapterId) ?? null;
      if (slotId) return slotRackMap.get(slotId) ?? null;
      return null;
    },
    [slotRackMap, adapterRackMap],
  );

  // ── Connexions initiales : RackConnection + ProjectConnection virtualisées ─
  const initialConnections = useMemo<RackConnection[]>(() => {
    const out: RackConnection[] = [...(effective.connections ?? [])];
    for (const pc of effective.projectConnections ?? []) {
      out.push(virtualizeProjectConnection(pc) as unknown as RackConnection);
    }
    return out;
  }, [effective.connections, effective.projectConnections]);

  // ── Suivi des connexions vivantes (routage des PATCH/DELETE par id) ───────
  const connectionsRef = useRef<RackConnection[]>(initialConnections);
  useEffect(() => {
    connectionsRef.current = initialConnections;
  }, [initialConnections]);
  const handleConnectionsChange = useCallback(
    (conns: RackConnection[]) => {
      connectionsRef.current = conns;
      onConnectionsChange?.(conns);
    },
    [onConnectionsChange],
  );

  // ── Cabling API de lieu — routage par extrémités ──────────────────────────
  const cablingApi = useMemo<CablingApiAdapter>(() => {
    const locationUrl = `/api/tenant/projects/${projectId}/synoptic/location/${locationId}`;

    const endpointBody = (
      payloadIn: CablingCreatePayload,
      side: "from" | "to",
      rackId: string,
    ) => ({
      rackId,
      ...(side === "from"
        ? payloadIn.fromAdapterId
          ? {
              adapterId: payloadIn.fromAdapterId,
              adapterSide: payloadIn.fromAdapterSide ?? undefined,
              adapterPortIndex: payloadIn.fromAdapterPortIndex ?? undefined,
            }
          : {
              slotId: payloadIn.fromSlotId ?? undefined,
              connectorIndex: payloadIn.fromConnectorIndex ?? undefined,
            }
        : payloadIn.toAdapterId
          ? {
              adapterId: payloadIn.toAdapterId,
              adapterSide: payloadIn.toAdapterSide ?? undefined,
              adapterPortIndex: payloadIn.toAdapterPortIndex ?? undefined,
            }
          : {
              slotId: payloadIn.toSlotId ?? undefined,
              connectorIndex: payloadIn.toConnectorIndex ?? undefined,
            }),
    });

    /** Résout les deux contenants d'un payload de création. */
    const resolveRacks = (p: CablingCreatePayload) => {
      const fromRack = rackOfEndpoint(p.fromSlotId, p.fromAdapterId);
      const toRack = rackOfEndpoint(p.toSlotId, p.toAdapterId);
      return { fromRack, toRack };
    };

    async function createInRack(rackId: string, p: CablingCreatePayload): Promise<DbConnection> {
      const res = await apiFetch(`/api/racks/${rackId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!res.ok) throw new Error(`createOne failed: ${res.status}`);
      return (await res.json()) as DbConnection;
    }

    async function createInProject(
      p: CablingCreatePayload,
      fromRack: string,
      toRack: string,
    ): Promise<DbConnection> {
      const res = await apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: endpointBody(p, "from", fromRack),
          to: endpointBody(p, "to", toRack),
          label: p.label ?? undefined,
          color: p.color ?? undefined,
          cableStyle: p.cableStyle ?? undefined,
          waypoints: p.waypoints ?? undefined,
          bundleId: p.bundleId ?? undefined,
          notes: p.notes ?? undefined,
          tags: p.tags ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`POST ProjectConnection failed: ${res.status}`);
      return virtualizeProjectConnection((await res.json()) as ProjectConnectionRaw);
    }

    async function createOne(p: CablingCreatePayload): Promise<DbConnection> {
      const { fromRack, toRack } = resolveRacks(p);
      if (fromRack && toRack && fromRack !== toRack) {
        // arkyo-server: correction d'un défaut d'arkyo — deux contenants d'un même lieu : la route projet refuse (400 « même emplacement ») ; le câble direct est une RackConnection du rack virtuel du lieu (garde phase 3 d'arkyo)
        return createInRack(pivotRackId, p);
      }
      return createInRack(fromRack ?? toRack ?? pivotRackId, p);
    }

    /** Champs mutables acceptés par la route ProjectConnection. */
    const projectPatchFields = (patch: CablingPatchPayload) => {
      const allowed: Record<string, unknown> = {};
      if ("label" in patch) allowed.label = patch.label;
      if ("color" in patch) allowed.color = patch.color;
      if ("cableStyle" in patch) allowed.cableStyle = patch.cableStyle;
      if ("waypoints" in patch) allowed.waypoints = patch.waypoints;
      if ("notes" in patch) allowed.notes = patch.notes;
      if ("tags" in patch) allowed.tags = patch.tags;
      if ("bundleId" in patch) allowed.bundleId = patch.bundleId;
      if ("catalogCableModelId" in patch)
        allowed.catalogCableModelId = patch.catalogCableModelId;
      return allowed;
    };

    /** Contenant portant une RackConnection (via son rack ou ses extrémités). */
    const knownRacks = new Set(rackIds);
    const rackOfConnectionId = (id: string): string => {
      const conn = connectionsRef.current.find((c) => c.id === id);
      if (!conn) return pivotRackId;
      if (conn.rackId && knownRacks.has(conn.rackId)) return conn.rackId;
      return (
        rackOfSlotOrNull(conn.fromSlotId) ?? rackOfSlotOrNull(conn.toSlotId) ?? pivotRackId
      );
    };

    return {
      createOne,
      async createBatch(payloads) {
        // Les batchs du SynopticView (multi-câbles) ciblent un même couple de
        // nœuds : on regroupe par contenant quand c'est intra-rack, et on
        // parallélise les POST ProjectConnection sinon.
        const intra = new Map<string, CablingCreatePayload[]>();
        const cross: CablingCreatePayload[] = [];
        for (const p of payloads) {
          const { fromRack, toRack } = resolveRacks(p);
          if (fromRack && toRack && fromRack !== toRack) {
            // arkyo-server: correction d'un défaut d'arkyo — deux contenants d'un même lieu : la route projet refuse (400 « même emplacement ») ; le câble direct est une RackConnection du rack virtuel du lieu (garde phase 3 d'arkyo)
            const pivotList = intra.get(pivotRackId);
            if (pivotList) pivotList.push(p);
            else intra.set(pivotRackId, [p]);
            continue;
          }
          const rid = fromRack ?? toRack ?? pivotRackId;
          const list = intra.get(rid);
          if (list) list.push(p);
          else intra.set(rid, [p]);
        }
        const results: DbConnection[] = [];
        for (const [rid, list] of intra) {
          const res = await apiFetch(`/api/racks/${rid}/connections`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connections: list }),
          });
          if (!res.ok) throw new Error(`createBatch failed: ${res.status}`);
          const data = (await res.json()) as DbConnection[];
          if (Array.isArray(data)) results.push(...data);
        }
        if (cross.length > 0) {
          const created = await Promise.all(cross.map((p) => createOne(p)));
          results.push(...created);
        }
        return results;
      },
      async patchOne(id, patch) {
        if (isProjectConnectionId(id)) {
          const allowed = projectPatchFields(patch);
          // Un déplacement d'extrémité n'est pas exprimable sur la route
          // ProjectConnection → on n'écrit rien (le câble reste en place).
          if (Object.keys(allowed).length === 0) return null;
          const res = await apiFetch(
            `/api/tenant/projects/${projectId}/synoptic/connections/${projectConnectionDbId(id)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(allowed),
            },
          );
          if (!res.ok) return null;
          return virtualizeProjectConnection((await res.json()) as ProjectConnectionRaw);
        }
        const res = await apiFetch(`/api/racks/${rackOfConnectionId(id)}/connections/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return null;
        return (await res.json()) as DbConnection;
      },
      async deleteOne(id) {
        if (isProjectConnectionId(id)) {
          await apiFetch(
            `/api/tenant/projects/${projectId}/synoptic/connections/${projectConnectionDbId(id)}`,
            { method: "DELETE" },
          );
          return;
        }
        await apiFetch(`/api/racks/${rackOfConnectionId(id)}/connections/${id}`, {
          method: "DELETE",
        });
      },
      async deleteBatch(ids) {
        const byRack = new Map<string, string[]>();
        const projectIds: string[] = [];
        for (const id of ids) {
          if (isProjectConnectionId(id)) {
            projectIds.push(projectConnectionDbId(id));
            continue;
          }
          const rid = rackOfConnectionId(id);
          const list = byRack.get(rid);
          if (list) list.push(id);
          else byRack.set(rid, [id]);
        }
        await Promise.all([
          ...[...byRack.entries()].map(([rid, list]) =>
            apiFetch(`/api/racks/${rid}/connections`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: list }),
            }).catch(() => null),
          ),
          ...projectIds.map((pid) =>
            apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${pid}`, {
              method: "DELETE",
            }).catch(() => null),
          ),
        ]);
      },
      async renumber(rnPayload) {
        const rn: CablingRenumberPayload = rnPayload ?? {};
        const known = connectionsRef.current;
        const idsOfRack = (rid: string) =>
          new Set(known.filter((c) => !isProjectConnectionId(c.id) && rackOfConnectionId(c.id) === rid).map((c) => c.id));
        const projectDbIds = (ids: string[]) =>
          ids.filter(isProjectConnectionId).map(projectConnectionDbId);

        const clearProjectLabels = async (dbIds: string[]) => {
          await Promise.all(
            dbIds.map((pid) =>
              apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${pid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: null }),
              }).catch(() => null),
            ),
          );
        };

        const clearIds = Array.isArray(rn.clearIds) ? rn.clearIds : [];
        if (rn.clearOnly === true) {
          await Promise.all(
            rackIds.map((rid) =>
              apiFetch(`/api/racks/${rid}/renumber`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clearOnly: true }),
              }).catch(() => null),
            ),
          );
          await clearProjectLabels(
            (known ?? []).filter((c) => isProjectConnectionId(c.id)).map((c) => projectConnectionDbId(c.id)),
          );
        } else if (clearIds.length > 0) {
          const ids = clearIds;
          await Promise.all(
            rackIds.map((rid) => {
              const scope = idsOfRack(rid);
              const subset = ids.filter((id) => scope.has(id));
              if (subset.length === 0) return Promise.resolve(null);
              return apiFetch(`/api/racks/${rid}/renumber`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clearIds: subset }),
              }).catch(() => null);
            }),
          );
          await clearProjectLabels(projectDbIds(ids));
        } else {
          // Renumérotation auto : une passe par contenant (sur le sous-ensemble
          // de câbles qui lui appartient), puis une passe projet pour les
          // liaisons inter-contenants du lieu.
          for (const rid of rackIds) {
            const scope = idsOfRack(rid);
            const ordered = rn.orderedIds?.filter((id) => scope.has(id));
            if (rn.orderedIds && (!ordered || ordered.length === 0)) continue;
            const sideMap = rn.sideMap
              ? Object.fromEntries(
                  Object.entries(rn.sideMap).filter(([id]) => scope.has(id)),
                )
              : undefined;
            await apiFetch(`/api/racks/${rid}/renumber`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...rn,
                ...(ordered ? { orderedIds: ordered } : {}),
                ...(sideMap ? { sideMap } : {}),
              }),
            }).catch(() => null);
          }
          await apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/renumber`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }).catch(() => null);
        }

        // Refetch complet : le SynopticView remplace sa liste avec le retour.
        const res = await apiFetch(locationUrl, { method: "GET" });
        if (!res.ok) return [];
        const fresh = (await res.json()) as LocationPayload;
        const out: DbConnection[] = [
          ...((fresh.connections ?? []) as unknown as DbConnection[]),
          ...(fresh.projectConnections ?? []).map(virtualizeProjectConnection),
        ];
        return out;
      },
      async patchRackConfig(patch) {
        // L'override de numérotation du lieu vit sur le contenant pivot.
        await apiFetch(`/api/racks/${pivotRackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      },
      async persistSlotPosition(slotId, x, y) {
        await apiFetch(`/api/racks/${rackOfSlot(slotId)}/slots/${slotId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ synopticX: x, synopticY: y }),
        }).catch(() => {});
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    locationId,
    pivotRackId,
    rackIdsKey,
    rackOfEndpoint,
    rackOfSlot,
    rackOfSlotOrNull,
  ]);

  // ── Refs / handles ───────────────────────────────────────────────────────
  const synopticRef = useRef<SynopticViewHandle>(null);
  useImperativeHandle(forwardedRef, () => synopticRef.current as SynopticViewHandle, []);

  // Note : contrairement à `GeneralCanvas`, on ne republie PAS les bridges du
  // store topbar (zoom, writers câble/label/zone, numérotation, effacement,
  // picker d'adaptateur) ni le bridge d'outil actif. Le `synoptique-tab-client`
  // les publie déjà pour toute vue non-générale, en visant CE handle via la ref
  // qu'il nous transmet — republier ici créerait deux écritures concurrentes
  // sur les mêmes clés du store.

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SynopticView
      ref={synopticRef}
      mode="location"
      // Pivot : porte le décor (zones / libellés / faisceaux) et la config de
      // numérotation du lieu.
      rackId={pivotRackId}
      rackName={effective.location.name}
      rackCableCode={effective.location.cableCode}
      viewKey={`loc:${locationId}`}
      sseRackIds={rackIds}
      rackLabels={rackLabels}
      // Vue de lecture : ni salle de curseurs, ni publication vers le shell,
      // ni capture du clavier global, ni flux SSE (coupés par `publishToShell`
      // côté SynopticView — une liste vide n'aurait rien coupé, elle retombe
      // sur le contenant pivot).
      liveRoom={readOnly ? null : `synoptic:loc:${locationId}`}
      publishToShell={!readOnly}
      slots={effective.slots}
      connectorTypes={effective.connectorTypes}
      initialConnections={initialConnections}
      initialZones={effective.zones ?? EMPTY_ARRAY}
      initialLabels={effective.labels ?? EMPTY_ARRAY}
      initialAdapters={effective.adapters ?? EMPTY_ARRAY}
      initialExternalPorts={effective.externalPorts ?? EMPTY_ARRAY}
      initialPanelRows={effective.panelRows ?? EMPTY_ARRAY}
      signals={effective.signals ?? EMPTY_SIGNALS}
      signalCategories={effective.signalCategories ?? EMPTY_SIGNAL_CATEGORIES}
      cableNumbering={cableNumbering}
      isVisible
      cablingApi={cablingApi}
      onConnectionsChange={handleConnectionsChange}
      onCableDetailsChange={onCableDetailsChange}
      onNodeDetailsChange={onNodeDetailsChange}
      onAdapterDetailsChange={onAdapterDetailsChange}
      onZoneDetailsChange={onZoneDetailsChange}
      onLabelDetailsChange={onLabelDetailsChange}
      onExternalDetailsChange={onExternalDetailsChange}
      onMultiCableSelectionChange={onMultiCableSelectionChange}
      onMultiNodeSelectionChange={onMultiNodeSelectionChange}
      onMultiExternalSelectionChange={onMultiExternalSelectionChange}
      onToolChange={onToolChange}
      onZoomChange={onZoomChange}
      onRenumberPanelChange={onRenumberPanelChange}
      onManualPanelChange={onManualPanelChange}
    />
  );
});
