"use client";

/**
 * Navigation entre les onglets de l'éditeur projet depuis l'interface Strata,
 * par la même logique que `handleTabChange` de `project-editor.tsx` : même
 * `?tab=`, même stockage local (`project-editor-tab`), autres paramètres de
 * l'URL conservés. Une vue se montre dans Concevoir (`?space=` retiré).
 */

import { useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useGuardedRouter } from "@/lib/unsaved-changes";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { SPACE_PARAM } from "./space-switch";

/** Projet de l'URL (`/project/:id…`), `null` hors de l'éditeur projet. */
export function projectIdOf(pathname: string | null | undefined): string | null {
  const m = /^\/project\/([^/?#]+)/.exec(pathname ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** Clé de stockage de l'onglet de l'éditeur (`project-editor.tsx`). */
export const EDITOR_TAB_KEY = "project-editor-tab";

/** Onglets de l'éditeur (`TABS` de `project-editor.tsx`) : le `Record` les exige tous. */
const TAB_IDS: Record<ProjectTabId, true> = {
  inventaire: true,
  rack: true,
  synoptique: true,
  schema: true,
  cartographie: true,
  video: true,
  audio: true,
  lumiere: true,
  reseau: true,
  preparation: true,
  recette: true,
};

export const isProjectTabId = (v: unknown): v is ProjectTabId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(TAB_IDS, v);

/** Onglet retenu pour la prochaine ouverture du projet, comme `handleTabChange`. */
export function rememberEditorTab(id: ProjectTabId) {
  try {
    window.localStorage.setItem(EDITOR_TAB_KEY, JSON.stringify(id));
  } catch {
    /* stockage indisponible */
  }
}

/** URL de l'onglet `id` dans Concevoir : `?tab=` posé, `?space=` retiré, le reste conservé. */
export function projectTabHref(
  projectId: string,
  current: { toString(): string } | null | undefined,
  id: ProjectTabId,
): string {
  const query = new URLSearchParams(current?.toString() ?? "");
  query.set("tab", id);
  query.delete(SPACE_PARAM);
  return `/project/${projectId}?${query.toString()}`;
}

export function useGoToProjectTab(): (id: ProjectTabId) => void {
  // Routeur gardé : sans saisie en cours, il navigue comme `useRouter`.
  const router = useGuardedRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  return useCallback(
    (id: ProjectTabId) => {
      rememberEditorTab(id);
      router.replace(projectTabHref(projectId ?? "", searchParams, id), { scroll: false });
    },
    [router, searchParams, projectId],
  );
}
