"use client";

/**
 * Données et navigation de l'espace Gérer (interface Strata v2) :
 *   - `useManageData` : données de l'éditeur (`ProjectEditorData`, tenues à
 *     jour par `router.refresh()` sur les évènements temps réel), plus le
 *     `canvas-data` des contenants rackables (`useRacksLive`, lectures
 *     partagées et suivies), les câbles du projet (`useProjectCables`, lus
 *     une fois par `ManageShell` pour tout Gérer), l'inventaire
 *     des contenants rackables (`racks/{id}/inventory`, relu sur l'évènement
 *     `rack_inventory`, comme l'onglet Rack), et le rapport de validation
 *     noté pour CE projet (`validation-record.tsx`) ;
 *   - `useManageNav` : page courante (`?page=`, Vue d'ensemble par défaut),
 *     objet sélectionné (`?sel=`), et passage vers une cible (page de Gérer,
 *     ou onglet de Concevoir par la logique de `handleTabChange`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ProjectEditorData } from "@/app/(fullscreen)/project/[id]/_components/project-editor";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { parseLocationViewId } from "@/app/(fullscreen)/project/[id]/synoptique/_components/synoptique-rack-selector";
import { api } from "@/lib/api-client";
import { subscribeAppEvents } from "@/lib/app-events-client";
import { useGuardedRouter } from "@/lib/unsaved-changes";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import { useRacksLive } from "../bottom/use-rack-live";
import { useRackFocusStore } from "../editor/rack-focus";
import { spaceQuery } from "../shell/space-switch";
import { useGoToProjectTab } from "../shell/tab-nav";
import type { InventoryDto } from "./placement";
import type { ProjectCables } from "./use-project-cables";
import { useProjectValidation } from "./validation-record";
import { isManagePage, isRackableContainer, type ManageData, type ManagePage, type TodoTarget } from "./todo-model";

export type ManageState = ManageData & {
  projectId: string;
  /** Un contenant rackable n'est pas encore lu : les « à placer » ne sont pas connus. */
  loading: boolean;
};

type Inventories = { byRack: Record<string, InventoryDto[]>; failed: Record<string, boolean> };

/** Inventaire des contenants rackables, relu quand l'inventaire d'un contenant change. */
function useInventories(projectId: string, rackIds: readonly string[]): Inventories {
  const key = rackIds.join(",");
  const [state, setState] = useState<Inventories>({ byRack: {}, failed: {} });

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let cancelled = false;
    const load = (id: string) =>
      api
        .get<{ items?: InventoryDto[] }>(`/api/tenant/projects/${projectId}/racks/${id}/inventory`)
        .then((r) => {
          if (cancelled) return;
          setState((s) => ({
            byRack: { ...s.byRack, [id]: Array.isArray(r?.items) ? r.items : [] },
            failed: { ...s.failed, [id]: false },
          }));
        })
        .catch(() => {
          if (!cancelled) setState((s) => ({ ...s, failed: { ...s.failed, [id]: true } }));
        });
    ids.forEach(load);
    const unsubscribe = subscribeAppEvents((data) => {
      const e = data as { entity?: string; id?: string } | null;
      if (e?.entity !== "rack_inventory") return;
      if (e.id && ids.includes(e.id)) void load(e.id);
      else if (!e.id) ids.forEach(load);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId, key]);
  return state;
}

export function useManageData(
  project: ProjectEditorData,
  cables: Pick<ProjectCables, "rows" | "error">,
): ManageState {
  const projectId = project.header.id;
  const racks = project.inventaire.racks;
  const rackableIds = useMemo(() => racks.filter(isRackableContainer).map((r) => r.id), [racks]);
  // `canvas-data` des rackables (positions en U).
  const live = useRacksLive(rackableIds, projectId);
  const inventories = useInventories(projectId, rackableIds);
  const recorded = useProjectValidation(projectId);
  const locations = project.inventaire.locations;

  return useMemo(() => {
    const canvas: Record<string, RackCanvasData | null> = {};
    const inventory: Record<string, InventoryDto[] | null> = {};
    const unavailable: Record<string, boolean> = {};
    for (const id of rackableIds) {
      canvas[id] = live[id]?.canvas ?? null;
      inventory[id] = inventories.byRack[id] ?? null;
      // Une lecture en échec rend le contenant illisible, même avec une valeur plus ancienne.
      unavailable[id] = !!live[id]?.canvasError || !!inventories.failed[id];
    }
    const loading = rackableIds.some((id) => !unavailable[id] && (!canvas[id] || !inventory[id]));
    const locationId = parseLocationViewId(recorded?.viewId ?? null);
    return {
      projectId,
      fiche: project.fiche,
      racks,
      locations,
      canvas,
      cables: cables.rows,
      cablesError: cables.rows == null && cables.error != null,
      inventory,
      unavailable,
      validation: recorded?.report
        ? { report: recorded.report, view: locations.find((l) => l.id === locationId)?.name ?? null }
        : null,
      loading,
    };
  }, [rackableIds, live, inventories, recorded, projectId, project.fiche, locations, racks, cables.rows, cables.error]);
}

export type ManageNav = {
  projectId: string;
  page: ManagePage;
  /** Objet sélectionné de la page (`?sel=`). */
  sel: string | null;
  /** Requête d'une page de Gérer (objet `sel` facultatif). */
  href: (page: ManagePage, sel?: string | null) => string;
  go: (page: ManagePage, sel?: string | null) => void;
  /** Sélection dans la page courante. */
  select: (sel: string | null) => void;
  /** Onglet de Concevoir (même logique que `handleTabChange` d'arkyo). */
  goToTab: (tab: ProjectTabId) => void;
  /** Mode Racks sur un contenant (signal lu par le tiroir du mode Racks). */
  goToRack: (rackId: string | null) => void;
  /** Concevoir, sur l'onglet courant. */
  goToConcevoir: () => void;
  goToTarget: (target: TodoTarget) => void;
};

export function useManageNav(projectId: string): ManageNav {
  // Routeur gardé : une saisie non enregistrée (mode tableau des câbles) est signalée avant de partir.
  const router = useGuardedRouter();
  const searchParams = useSearchParams();
  const goToTab = useGoToProjectTab();
  const raw = searchParams?.get("page");
  const page: ManagePage = isManagePage(raw) ? raw : "overview";
  const sel = searchParams?.get("sel") ?? null;

  const query = useCallback(
    (next: ManagePage, nextSel: string | null | undefined) => {
      const q = new URLSearchParams(searchParams?.toString() ?? "");
      q.set("space", "gerer");
      if (next === "overview") q.delete("page");
      else q.set("page", next);
      if (nextSel) q.set("sel", nextSel);
      else q.delete("sel");
      return q.toString();
    },
    [searchParams],
  );
  // Chemin complet : le garde des saisies non enregistrées résout un `href` depuis la racine du site.
  const href = useCallback(
    (next: ManagePage, nextSel?: string | null) => `/project/${projectId}?${query(next, nextSel)}`,
    [projectId, query],
  );
  const go = useCallback(
    (next: ManagePage, nextSel?: string | null) =>
      router.replace(`/project/${projectId}?${query(next, nextSel)}`, { scroll: false }),
    [router, projectId, query],
  );
  const select = useCallback((nextSel: string | null) => go(page, nextSel), [go, page]);
  const goToRack = useCallback(
    (rackId: string | null) => {
      if (rackId) useRackFocusStore.getState().request({ projectId, rackId });
      goToTab("rack");
    },
    [goToTab, projectId],
  );
  const goToConcevoir = useCallback(
    () => router.replace(`/project/${projectId}?${spaceQuery(searchParams, "concevoir")}`, { scroll: false }),
    [router, projectId, searchParams],
  );
  const goToTarget = useCallback(
    (target: TodoTarget) => {
      if (target.space === "gerer") go(target.page ?? "overview", target.objectId ?? null);
      else if (target.tab === "rack") goToRack(target.objectId ?? null);
      else goToTab(target.tab ?? "synoptique");
    },
    [go, goToRack, goToTab],
  );

  return { projectId, page, sel, href, go, select, goToTab, goToRack, goToConcevoir, goToTarget };
}
