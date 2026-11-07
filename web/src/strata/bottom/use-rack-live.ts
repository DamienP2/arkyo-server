"use client";

/**
 * Données vivantes d'un contenant pour l'inspecteur, le dock bas et la vue
 * Connectique (interface Strata) :
 *   - ses câbles (`GET /api/racks/{rackId}/connections`) ;
 *   - au besoin son `canvas-data` (`GET /api/tenant/projects/{id}/racks/
 *     {rackId}/canvas-data`), quand le canevas du rack, qui le charge
 *     d'ordinaire, n'est pas monté (vue Connectique).
 *
 * Une seule lecture et un seul flux temps réel (`/api/racks/{rackId}/events`)
 * par contenant, partagés par tous les abonnés ; un évènement du contenant
 * (câble, slot) relance les lectures.
 */

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import { api } from "@/lib/api-client";
import type { RackConnectionRow } from "./rack-model";

export type RackLive = {
  /** `null` pendant la première lecture. */
  connections: RackConnectionRow[] | null;
  canvas: RackCanvasData | null;
};

const useRackLiveStore = create<{ byRack: Record<string, RackLive> }>(() => ({ byRack: {} }));

type Sub = {
  refs: number;
  /** Abonnés qui ont besoin du `canvas-data` (projet de la lecture). */
  canvasRefs: Map<string, number>;
  es: EventSource | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Fermeture différée : un abonné qui se réabonne dans le même rendu (dépendances changées) garde les données. */
  teardown: ReturnType<typeof setTimeout> | null;
};

const subs = new Map<string, Sub>();

function patch(rackId: string, next: Partial<RackLive>) {
  if (!subs.has(rackId)) return;
  useRackLiveStore.setState((s) => ({
    byRack: {
      ...s.byRack,
      [rackId]: { ...(s.byRack[rackId] ?? { connections: null, canvas: null }), ...next },
    },
  }));
}

function loadConnections(rackId: string) {
  api
    .get<RackConnectionRow[]>(`/api/racks/${rackId}/connections`)
    .then((rows) => patch(rackId, { connections: Array.isArray(rows) ? rows : [] }))
    .catch(() => patch(rackId, { connections: [] }));
}

function loadCanvas(rackId: string, projectId: string) {
  api
    .get<RackCanvasData>(`/api/tenant/projects/${projectId}/racks/${rackId}/canvas-data`)
    .then((data) => patch(rackId, { canvas: data }))
    .catch(() => {
      /* le canevas garde sa dernière valeur */
    });
}

function reload(rackId: string) {
  const sub = subs.get(rackId);
  if (!sub) return;
  loadConnections(rackId);
  for (const projectId of sub.canvasRefs.keys()) loadCanvas(rackId, projectId);
}

function acquire(rackId: string, projectId: string | null, wantCanvas: boolean): () => void {
  let sub = subs.get(rackId);
  if (sub?.teardown) {
    clearTimeout(sub.teardown);
    sub.teardown = null;
  }
  if (!sub) {
    sub = { refs: 0, canvasRefs: new Map(), es: null, timer: null, teardown: null };
    subs.set(rackId, sub);
    patch(rackId, {});
    loadConnections(rackId);
    if (typeof EventSource !== "undefined") {
      const es = new EventSource(`/api/racks/${rackId}/events`);
      const s = sub;
      es.onmessage = (e) => {
        let type = "";
        try {
          type = (JSON.parse(e.data) as { type?: string }).type ?? "";
        } catch {
          return;
        }
        if (type === "ping" || type === "connected") return;
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => {
          s.timer = null;
          reload(rackId);
        }, 150);
      };
      sub.es = es;
    }
  }
  sub.refs += 1;
  const canvasKey = wantCanvas && projectId ? projectId : null;
  if (canvasKey) {
    const n = sub.canvasRefs.get(canvasKey) ?? 0;
    sub.canvasRefs.set(canvasKey, n + 1);
    if (n === 0) loadCanvas(rackId, canvasKey);
  }
  const owned = sub;
  return () => {
    if (canvasKey) {
      const n = (owned.canvasRefs.get(canvasKey) ?? 1) - 1;
      if (n > 0) owned.canvasRefs.set(canvasKey, n);
      else {
        owned.canvasRefs.delete(canvasKey);
        // Plus personne ne le suit : il serait périmé à la prochaine lecture.
        if (owned.canvasRefs.size === 0) patch(rackId, { canvas: null });
      }
    }
    owned.refs -= 1;
    if (owned.refs > 0) return;
    owned.teardown = setTimeout(() => {
      if (owned.refs > 0 || subs.get(rackId) !== owned) return;
      owned.es?.close();
      if (owned.timer) clearTimeout(owned.timer);
      subs.delete(rackId);
      useRackLiveStore.setState((s) => {
        const byRack = { ...s.byRack };
        delete byRack[rackId];
        return { byRack };
      });
    }, 0);
  };
}

/**
 * Câbles (et `canvas-data` si `projectId` est fourni) de contenants, par
 * contenant, tenus à jour. Liste vide : rien n'est lu.
 */
export function useRacksLive(rackIds: readonly string[], projectId: string | null = null): Record<string, RackLive> {
  const key = rackIds.join(",");
  useEffect(() => {
    if (!key) return;
    const releases = key.split(",").map((id) => acquire(id, projectId, projectId != null));
    return () => releases.forEach((r) => r());
  }, [key, projectId]);
  const byRack = useRackLiveStore((s) => s.byRack);
  return useMemo(() => {
    const out: Record<string, RackLive> = {};
    for (const id of key ? key.split(",") : []) out[id] = byRack[id] ?? EMPTY;
    return out;
  }, [byRack, key]);
}

const EMPTY: RackLive = { connections: null, canvas: null };
