"use client";

/**
 * Données et navigation de l'espace Gérer (interface Strata v2) :
 *   - `useManageData` : données de l'éditeur (`ProjectEditorData`, tenues à
 *     jour par `router.refresh()` sur les évènements temps réel), plus le
 *     `canvas-data` des contenants rackables et les câbles de chaque
 *     contenant (`useRacksLive`, lectures partagées et suivies), plus le
 *     rapport de validation publié par le synoptique ;
 *   - `useManageNav` : page courante (`?page=`, Vue d'ensemble par défaut),
 *     objet sélectionné (`?sel=`), et passage vers une cible (page de Gérer,
 *     ou onglet de Concevoir par la logique de `handleTabChange`).
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectEditorData } from "@/app/(fullscreen)/project/[id]/_components/project-editor";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { RackConnectionRow } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { useRackFocusStore } from "../editor/rack-focus";
import { spaceQuery } from "../shell/space-switch";
import { useGoToProjectTab } from "../shell/tab-nav";
import { isManagePage, isRackableContainer, type ManageData, type ManagePage, type TodoTarget } from "./todo-model";

export type ManageState = ManageData & {
  projectId: string;
  /** Un contenant rackable n'est pas encore lu : les « à placer » ne sont pas connus. */
  loading: boolean;
  /** Lecture en échec par contenant (`canvas-data`). */
  canvasError: Readonly<Record<string, boolean>>;
};

export function useManageData(project: ProjectEditorData): ManageState {
  const projectId = project.header.id;
  const racks = project.inventaire.racks;
  const allIds = useMemo(() => racks.map((r) => r.id), [racks]);
  const rackableIds = useMemo(() => racks.filter(isRackableContainer).map((r) => r.id), [racks]);
  // Câbles de tous les contenants ; `canvas-data` des rackables (positions en U).
  const live = useRacksLive(allIds);
  useRacksLive(rackableIds, projectId);
  const validationReport = useTopbarActions((s) => s.validationReport);

  return useMemo(() => {
    const canvas: Record<string, RackCanvasData | null> = {};
    const connections: Record<string, RackConnectionRow[] | null> = {};
    const canvasError: Record<string, boolean> = {};
    for (const id of allIds) {
      canvas[id] = live[id]?.canvas ?? null;
      connections[id] = live[id]?.connections ?? null;
      canvasError[id] = !!live[id]?.canvasError;
    }
    const loading = rackableIds.some((id) => !canvas[id] && !canvasError[id]);
    return {
      projectId,
      fiche: project.fiche,
      racks,
      locations: project.inventaire.locations,
      canvas,
      connections,
      canvasError,
      validationReport,
      loading,
    };
  }, [allIds, rackableIds, live, projectId, project.fiche, project.inventaire.locations, racks, validationReport]);
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
  const router = useRouter();
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
  const href = useCallback((next: ManagePage, nextSel?: string | null) => `?${query(next, nextSel)}`, [query]);
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
