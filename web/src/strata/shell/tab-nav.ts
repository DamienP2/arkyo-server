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

/** Clé de stockage de l'onglet de l'éditeur (`project-editor.tsx`). */
export const EDITOR_TAB_KEY = "project-editor-tab";

export function useGoToProjectTab(): (id: ProjectTabId) => void {
  // Routeur gardé : sans saisie en cours, il navigue comme `useRouter`.
  const router = useGuardedRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  return useCallback(
    (id: ProjectTabId) => {
      try {
        window.localStorage.setItem(EDITOR_TAB_KEY, JSON.stringify(id));
      } catch {
        /* stockage indisponible */
      }
      const query = new URLSearchParams(searchParams?.toString() ?? "");
      query.set("tab", id);
      query.delete(SPACE_PARAM);
      router.replace(`/project/${projectId}?${query.toString()}`, { scroll: false });
    },
    [router, searchParams, projectId],
  );
}
