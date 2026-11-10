"use client";

/**
 * Données vivantes d'un contenant pour les tiroirs de Concevoir et les pages
 * de Gérer (interface Strata v2) :
 *   - ses câbles (`GET /api/racks/{rackId}/connections`) ;
 *   - au besoin son `canvas-data` (`GET /api/tenant/projects/{id}/racks/
 *     {rackId}/canvas-data`), quand le canevas du rack, qui le charge
 *     d'ordinaire, n'est pas monté (tiroir du synoptique, Gérer).
 *
 * Une seule lecture par contenant, partagée par tous les abonnés ; les câbles
 * ne sont lus que si un abonné au moins les demande (Gérer ne lit que le
 * `canvas-data` : option `{ connections: false }`). Le suivi
 * passe par le flux applicatif déjà ouvert (`/api/events`, singleton
 * `subscribeAppEvents`) : un évènement qui porte le `rackId` d'un contenant
 * suivi (câble, slot, adaptateur…) relance ses lectures. Aucun flux
 * `/api/racks/{rackId}/events` n'est ouvert ici : le serveur est en HTTP/1.1
 * (6 connexions par origine) et chaque canevas de rack en tient déjà un
 * (`use-rack-sync.ts`) ; doubler les flux bloquerait les requêtes suivantes
 * (voir `lib/app-events-client.ts`).
 */

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import { api } from "@/lib/api-client";
import { subscribeAppEvents } from "@/lib/app-events-client";
import type { RackConnectionRow } from "./rack-model";

export type RackLive = {
  /** `null` pendant la première lecture. */
  connections: RackConnectionRow[] | null;
  canvas: RackCanvasData | null;
  /** La dernière lecture du `canvas-data` a échoué (`canvas` reste la dernière valeur connue). */
  canvasError?: boolean;
};

const useRackLiveStore = create<{ byRack: Record<string, RackLive> }>(() => ({ byRack: {} }));

type Sub = {
  refs: number;
  /** Abonnés qui ont besoin des câbles. */
  connRefs: number;
  /** Abonnés qui ont besoin du `canvas-data` (projet de la lecture). */
  canvasRefs: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Fermeture différée : un abonné qui se réabonne dans le même rendu (dépendances changées) garde les données. */
  teardown: ReturnType<typeof setTimeout> | null;
};

const subs = new Map<string, Sub>();

/** Abonnement au flux applicatif, tant qu'un contenant est suivi. */
let unsubscribeApp: (() => void) | null = null;

function onAppEvent(data: unknown) {
  const rackId = (data as { type?: unknown; rackId?: unknown } | null)?.rackId;
  if ((data as { type?: unknown } | null)?.type !== "update" || typeof rackId !== "string") return;
  const sub = subs.get(rackId);
  if (!sub) return;
  if (sub.timer) clearTimeout(sub.timer);
  sub.timer = setTimeout(() => {
    sub.timer = null;
    reload(rackId);
  }, 150);
}

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
    .then((data) => patch(rackId, { canvas: data, canvasError: false }))
    // Le canevas garde sa dernière valeur ; l'échec est signalé aux abonnés.
    .catch(() => patch(rackId, { canvasError: true }));
}

function reload(rackId: string) {
  const sub = subs.get(rackId);
  if (!sub) return;
  if (sub.connRefs > 0) loadConnections(rackId);
  for (const projectId of sub.canvasRefs.keys()) loadCanvas(rackId, projectId);
}

function acquire(rackId: string, projectId: string | null, wantCanvas: boolean, wantConnections: boolean): () => void {
  let sub = subs.get(rackId);
  if (sub?.teardown) {
    clearTimeout(sub.teardown);
    sub.teardown = null;
  }
  if (!sub) {
    sub = { refs: 0, connRefs: 0, canvasRefs: new Map(), timer: null, teardown: null };
    subs.set(rackId, sub);
    patch(rackId, {});
    unsubscribeApp ??= subscribeAppEvents(onAppEvent);
  }
  sub.refs += 1;
  if (wantConnections) {
    sub.connRefs += 1;
    if (sub.connRefs === 1) loadConnections(rackId);
  }
  const canvasKey = wantCanvas && projectId ? projectId : null;
  if (canvasKey) {
    const n = sub.canvasRefs.get(canvasKey) ?? 0;
    sub.canvasRefs.set(canvasKey, n + 1);
    if (n === 0) loadCanvas(rackId, canvasKey);
  }
  const owned = sub;
  return () => {
    if (wantConnections) owned.connRefs -= 1;
    if (canvasKey) {
      const n = (owned.canvasRefs.get(canvasKey) ?? 1) - 1;
      if (n > 0) owned.canvasRefs.set(canvasKey, n);
      else {
        owned.canvasRefs.delete(canvasKey);
        // Plus personne ne le suit : il serait périmé à la prochaine lecture.
        if (owned.canvasRefs.size === 0) patch(rackId, { canvas: null, canvasError: false });
      }
    }
    owned.refs -= 1;
    if (owned.refs > 0) return;
    owned.teardown = setTimeout(() => {
      if (owned.refs > 0 || subs.get(rackId) !== owned) return;
      if (owned.timer) clearTimeout(owned.timer);
      subs.delete(rackId);
      if (subs.size === 0) {
        unsubscribeApp?.();
        unsubscribeApp = null;
      }
      useRackLiveStore.setState((s) => {
        const byRack = { ...s.byRack };
        delete byRack[rackId];
        return { byRack };
      });
    }, 0);
  };
}

/**
 * Câbles (sauf `{ connections: false }`) et `canvas-data` (si `projectId` est
 * fourni) de contenants, par contenant, tenus à jour. Liste vide : rien n'est
 * lu.
 */
export function useRacksLive(
  rackIds: readonly string[],
  projectId: string | null = null,
  { connections = true }: { connections?: boolean } = {},
): Record<string, RackLive> {
  const key = rackIds.join(",");
  useEffect(() => {
    if (!key) return;
    const releases = key.split(",").map((id) => acquire(id, projectId, projectId != null, connections));
    return () => releases.forEach((r) => r());
  }, [key, projectId, connections]);
  const byRack = useRackLiveStore((s) => s.byRack);
  return useMemo(() => {
    const out: Record<string, RackLive> = {};
    for (const id of key ? key.split(",") : []) out[id] = byRack[id] ?? EMPTY;
    return out;
  }, [byRack, key]);
}

const EMPTY: RackLive = { connections: null, canvas: null };
