// Diff/sync d'un snapshot synoptique vers la DB.
// Utilisé par undo/redo pour répercuter en base l'état restauré côté client.
//
// Approche :
//   1. Diff des 4 entités (connections, zones, labels, adapters) entre l'état
//      courant et le snapshot cible (créations / suppressions / modifications).
//   2. Diff des positions (slot.synopticX/Y ou panel-row.x/y).
//   3. Émission des requêtes HTTP vers les endpoints existants (POST accepte un
//      id custom pour recréer à l'identique ; PATCH/DELETE pour le reste).
//
// Phases d'exécution (ordre = intégrité FK) :
//   A. DELETE connections
//   B. DELETE adapters (plus référencés)
//   C. DELETE zones, labels (leaves)
//   D. CREATE adapters (avant connections)
//   E. CREATE zones, labels
//   F. CREATE connections (adapters déjà présents)
//   G. PATCH de tout (idempotent)
//   H. Positions (slots + panel-rows)
//
// Si une requête échoue → throw ; le caller affichera un toast + reload.

import type { SynopticSnapshot } from "@/components/synoptique/hooks/use-synoptic-history";
import { apiFetch } from "@/lib/client-id";

// Transformation d'une connection "virtualisée" (IDs panel-row ou adapter)
// vers le payload DB (fromSlotId+portIndex OU fromAdapterId+side+portIndex).
export type DevirtualizeConnectionFn = (c: Record<string, unknown>) => Record<string, unknown>;

export interface SyncOptions {
  rackId: string;
  isVirtualId: (id: string) => boolean;
  getVirtualRowInfo: (id: string) => { slotId: string; rowIdx: number } | null;
  devirtualizeConnection: DevirtualizeConnectionFn;
}

function shallowJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffById<T extends { id: string }>(
  current: T[],
  target: T[],
): { toCreate: T[]; toUpdate: T[]; toDelete: string[] } {
  const currentById = new Map(current.map((x) => [x.id, x]));
  const targetById = new Map(target.map((x) => [x.id, x]));
  const toCreate: T[] = [];
  const toUpdate: T[] = [];
  const toDelete: string[] = [];
  for (const [id, t] of targetById) {
    const c = currentById.get(id);
    if (!c) toCreate.push(t);
    else if (!shallowJsonEqual(c, t)) toUpdate.push(t);
  }
  for (const [id] of currentById) {
    if (!targetById.has(id)) toDelete.push(id);
  }
  return { toCreate, toUpdate, toDelete };
}

interface WithId {
  id: string;
}
type AnyRecord = WithId & Record<string, unknown>;

function flattenConnections(s: SynopticSnapshot): AnyRecord[] {
  const wp = new Map(s.connWaypoints as [string, unknown][]);
  const st = new Map(s.connStyles as [string, unknown][]);
  return (s.connections as AnyRecord[]).map((c) => ({
    ...c,
    waypoints: wp.get(c.id) ?? null,
    cableStyle: st.get(c.id) ?? null,
  }));
}

export async function syncSnapshotToDb(
  current: SynopticSnapshot,
  target: SynopticSnapshot,
  opts: SyncOptions,
): Promise<void> {
  const { rackId, isVirtualId, getVirtualRowInfo, devirtualizeConnection } = opts;

  // ── Diffs ────────────────────────────────────────────────────────────────
  const conns = diffById(flattenConnections(current), flattenConnections(target));
  const zones = diffById(current.zones as AnyRecord[], target.zones as AnyRecord[]);
  const labels = diffById(current.canvasLabels as AnyRecord[], target.canvasLabels as AnyRecord[]);
  const adapters = diffById(current.adapters as AnyRecord[], target.adapters as AnyRecord[]);

  // ── A. DELETE connections (batch) ────────────────────────────────────────
  if (conns.toDelete.length > 0) {
    const res = await apiFetch(`/api/racks/${rackId}/connections`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: conns.toDelete }),
    });
    if (!res.ok) throw new Error(`delete connections: ${res.status}`);
  }

  // ── B. DELETE adapters ───────────────────────────────────────────────────
  for (const id of adapters.toDelete) {
    const res = await apiFetch(`/api/racks/${rackId}/adapters/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete adapter ${id}: ${res.status}`);
  }

  // ── C. DELETE zones + labels ─────────────────────────────────────────────
  for (const id of zones.toDelete) {
    const res = await apiFetch(`/api/racks/${rackId}/zones/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete zone ${id}: ${res.status}`);
  }
  for (const id of labels.toDelete) {
    const res = await apiFetch(`/api/racks/${rackId}/labels/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete label ${id}: ${res.status}`);
  }

  // ── D. CREATE adapters ───────────────────────────────────────────────────
  for (const a of adapters.toCreate) {
    const adapterId =
      (a as AnyRecord & { adapter?: { id?: string } }).adapter?.id ?? (a as AnyRecord).adapterId;
    const payload = { ...a, adapterId };
    const res = await apiFetch(`/api/racks/${rackId}/adapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`create adapter: ${res.status}`);
  }

  // ── E. CREATE zones + labels ─────────────────────────────────────────────
  for (const z of zones.toCreate) {
    const res = await apiFetch(`/api/racks/${rackId}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(z),
    });
    if (!res.ok) throw new Error(`create zone: ${res.status}`);
  }
  for (const l of labels.toCreate) {
    const res = await apiFetch(`/api/racks/${rackId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(l),
    });
    if (!res.ok) throw new Error(`create label: ${res.status}`);
  }

  // ── F. CREATE connections (batch, endpoints dé-virtualisés) ──────────────
  if (conns.toCreate.length > 0) {
    const payloads = conns.toCreate.map((c) => devirtualizeConnection(c));
    const res = await apiFetch(`/api/racks/${rackId}/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections: payloads }),
    });
    if (!res.ok) throw new Error(`create connections: ${res.status}`);
  }

  // ── G. PATCH (adapters, zones, labels, connections) ──────────────────────
  for (const a of adapters.toUpdate) {
    const res = await apiFetch(`/api/racks/${rackId}/adapters/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    if (!res.ok) throw new Error(`update adapter ${a.id}: ${res.status}`);
  }
  for (const z of zones.toUpdate) {
    const res = await apiFetch(`/api/racks/${rackId}/zones/${z.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(z),
    });
    if (!res.ok) throw new Error(`update zone ${z.id}: ${res.status}`);
  }
  for (const l of labels.toUpdate) {
    const res = await apiFetch(`/api/racks/${rackId}/labels/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(l),
    });
    if (!res.ok) throw new Error(`update label ${l.id}: ${res.status}`);
  }
  for (const c of conns.toUpdate) {
    const payload = devirtualizeConnection(c);
    const res = await apiFetch(`/api/racks/${rackId}/connections/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`update connection ${c.id}: ${res.status}`);
  }

  // ── H. Positions ─────────────────────────────────────────────────────────
  const curPos = new Map(current.positions as [string, { x: number; y: number }][]);
  const tgtPos = new Map(target.positions as [string, { x: number; y: number }][]);
  for (const [id, pos] of tgtPos) {
    const prev = curPos.get(id);
    if (prev && prev.x === pos.x && prev.y === pos.y) continue;
    if (isVirtualId(id)) {
      const info = getVirtualRowInfo(id);
      if (!info) continue;
      const res = await apiFetch(`/api/racks/${rackId}/panel-rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: info.slotId, rowIndex: info.rowIdx, x: pos.x, y: pos.y }),
      });
      if (!res.ok) throw new Error(`update panel-row ${id}: ${res.status}`);
    } else {
      const res = await apiFetch(`/api/racks/${rackId}/slots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synopticX: pos.x, synopticY: pos.y }),
      });
      if (!res.ok) throw new Error(`update slot ${id}: ${res.status}`);
    }
  }
}
