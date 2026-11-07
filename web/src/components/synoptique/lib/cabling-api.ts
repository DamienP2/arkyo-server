/**
 * Cabling API adapter — injection point pour le SynopticView.
 *
 * Le SynopticView fait ~22 appels réseau pour muter des connexions :
 *   - POST   /api/racks/[id]/connections        (create single + batch)
 *   - PATCH  /api/racks/[id]/connections/[cid]  (update style/notes/tags/label/waypoints/endpoint)
 *   - DELETE /api/racks/[id]/connections        (batch delete)
 *   - DELETE /api/racks/[id]/connections/[cid]  (delete single)
 *   - POST   /api/racks/[id]/renumber           (renumber / clearOnly / clearIds)
 *   - PATCH  /api/racks/[id]                    (numberingOverride)
 *
 * Pour permettre au SynopticView d'être monté dans une vue Générale projet
 * (où les connexions sont des ProjectConnection et non des RackConnection),
 * on extrait ces appels derrière une interface unique.
 *
 * Le mode rack focus utilise `defaultRackCablingAdapter(rackId)` qui reproduit
 * exactement le comportement actuel — zéro régression.
 *
 * Le mode général utilise un adapter sur mesure défini dans `general-canvas.tsx`
 * qui mappe les endpoints rack vers les routes ProjectConnection projet-scopées.
 */

import { apiFetch } from "@/lib/client-id";
import type { DbConnection } from "@/components/synoptique/lib/connection-devirt";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Payload de création d'une connexion (forme rack — déjà utilisée par l'UI).
 *
 * Endpoints (from/to) :
 *   - slot : `slotId` + `connectorIndex`
 *   - adapter : `adapterId` + `adapterSide` + `adapterPortIndex` (slot* = null)
 */
export type CablingCreatePayload = {
  fromSlotId?: string | null;
  fromConnectorIndex?: number | null;
  fromAdapterId?: string | null;
  fromAdapterSide?: "left" | "right" | null;
  fromAdapterPortIndex?: number | null;
  toSlotId?: string | null;
  toConnectorIndex?: number | null;
  toAdapterId?: string | null;
  toAdapterSide?: "left" | "right" | null;
  toAdapterPortIndex?: number | null;
  /** Non-null ⇒ port from d'un composant ; connectorIndex relatif au composant. */
  fromComponentItemId?: string | null;
  /** Non-null ⇒ port to d'un composant ; connectorIndex relatif au composant. */
  toComponentItemId?: string | null;
  label?: string | null;
  color?: string | null;
  cableStyle?: string | null;
  waypoints?: Array<{ x: number; y: number }> | null;
  bundleId?: string | null;
  notes?: string | null;
  tags?: unknown;
  /** Soft-FK cross-DB → main.CableModel.id (modèle physique du câble). */
  catalogCableModelId?: string | null;
};

/** Patch d'une connexion (PATCH /connections/[id]). */
export type CablingPatchPayload = Partial<CablingCreatePayload>;

/**
 * Payload du POST /renumber.
 *
 * Trois modes :
 *   - `clearOnly: true`           → vide tous les labels
 *   - `clearIds: [...]`           → vide les labels des ids fournis
 *   - `orderedIds` + `sideMap`    → renumérote dans cet ordre
 */
export type CablingRenumberPayload = {
  clearOnly?: boolean;
  clearIds?: string[];
  orderedIds?: string[];
  sideMap?: Record<string, "left" | "right">;
  onlyUnlabelled?: boolean;
  partial?: boolean;
  override?: unknown;
};

/**
 * Adapter d'API câblage — abstraction des mutations connexion.
 *
 * Toutes les méthodes retournent des `DbConnection[]` ou `DbConnection`
 * (forme DB avant virtualisation client). Le caller doit appliquer
 * `virtualizeConnection` après réception.
 */
export interface CablingApiAdapter {
  /** Crée une connexion. POST /connections. */
  createOne: (payload: CablingCreatePayload) => Promise<DbConnection>;

  /** Crée plusieurs connexions en batch. POST /connections { connections: [...] }. */
  createBatch: (payloads: CablingCreatePayload[]) => Promise<DbConnection[]>;

  /** Met à jour une connexion. PATCH /connections/[id]. */
  patchOne: (id: string, patch: CablingPatchPayload) => Promise<DbConnection | null>;

  /** Supprime une connexion. DELETE /connections/[id]. */
  deleteOne: (id: string) => Promise<void>;

  /** Supprime plusieurs connexions en batch. DELETE /connections { ids: [...] }. */
  deleteBatch: (ids: string[]) => Promise<void>;

  /** Renumérote / efface les labels. POST /renumber. */
  renumber: (payload: CablingRenumberPayload) => Promise<DbConnection[]>;

  /**
   * Met à jour la configuration de numérotation du rack (override). PATCH /racks/[id].
   * En mode général, peut être un no-op (pas de notion d'override).
   */
  patchRackConfig: (patch: { numberingOverride?: unknown }) => Promise<void>;

  /**
   * Persiste la position synoptique d'un slot (drag node).
   *
   * En mode rack focus : PATCH /api/racks/[id]/slots/[slotId] { synopticX, synopticY }.
   * En mode général : la cible est en fait un rack — PATCH /api/racks/[rackId]/canvas-position.
   */
  persistSlotPosition: (slotId: string, x: number, y: number) => Promise<void>;
}

// ── Default rack adapter (parité exacte avec l'existant) ────────────────────

export function defaultRackCablingAdapter(rackId: string): CablingApiAdapter {
  return {
    async createOne(payload) {
      const res = await apiFetch(`/api/racks/${rackId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`createOne failed: ${res.status}`);
      return (await res.json()) as DbConnection;
    },

    async createBatch(payloads) {
      const res = await apiFetch(`/api/racks/${rackId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connections: payloads }),
      });
      if (!res.ok) throw new Error(`createBatch failed: ${res.status}`);
      return (await res.json()) as DbConnection[];
    },

    async patchOne(id, patch) {
      const res = await apiFetch(`/api/racks/${rackId}/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      return (await res.json()) as DbConnection;
    },

    async deleteOne(id) {
      await apiFetch(`/api/racks/${rackId}/connections/${id}`, {
        method: "DELETE",
      });
    },

    async deleteBatch(ids) {
      await apiFetch(`/api/racks/${rackId}/connections`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    },

    async renumber(payload) {
      const res = await apiFetch(`/api/racks/${rackId}/renumber`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`renumber failed: ${res.status}`);
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? (data as DbConnection[]) : [];
    },

    async patchRackConfig(patch) {
      await apiFetch(`/api/racks/${rackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },

    async persistSlotPosition(slotId, x, y) {
      await apiFetch(`/api/racks/${rackId}/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synopticX: x, synopticY: y }),
      });
    },
  };
}
