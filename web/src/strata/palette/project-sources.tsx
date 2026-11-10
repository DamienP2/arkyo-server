"use client";

/**
 * Sources de la palette ⌘K pour le projet ouvert (spec v2 §4.4, lot 4) :
 * son matériel, ses câbles, et les actions du projet (Valider, Ajouter du
 * matériel, aller à Concevoir / Gérer).
 *
 * La palette vit dans la topbar : elle n'a ni les données de l'éditeur ni ses
 * rappels. Elle lit donc, à l'ouverture seulement, les routes existantes que
 * lit Gérer (`/editor`, puis les câbles par `loadProjectCables`), et pour les
 * actions qui demandent l'état de l'éditeur, elle pose une demande
 * (`project-requests.ts`) que le composant qui sait la servir consomme :
 *   - Valider : le synoptique de Concevoir ; le bandeau de validation ouvre sa
 *     liste des contrôles dès que le rapport est publié ;
 *   - Ajouter du matériel : Gérer › Matériel, qui ouvre aussitôt l'outil
 *     Équipements de l'Inventaire (même parcours que « Ajouter du catalogue »).
 */

import type { ProjectEditorData } from "@/app/(fullscreen)/project/[id]/_components/project-editor";
import type { InventaireBomItem } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { Box, Cable, ClipboardList, Gauge, Plus, Server, ShieldCheck, Workflow } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { loadProjectCables, type CableRow } from "../manage/cables-model";
import type { ManagePage } from "../manage/todo-model";
import { manageQuery } from "../manage/use-manage";
import { racksOf } from "../manage/use-project-cables";
import { useAddEquipmentRequest, useValidationRequest } from "../shell/project-requests";
import { projectTabHref, rememberEditorTab } from "../shell/tab-nav";
import { lazyOnce, registerPaletteSource, type Lazy, type PaletteItem } from "./palette-sources";

const ICON = "h-4 w-4";

export type ProjectLoaders = {
  editor: Lazy<ProjectEditorData>;
  cables: Lazy<CableRow[]>;
  reset: () => void;
};

/** Lectures du projet, mises en cache pour une ouverture de la palette. */
export function projectLoaders(projectId: string): ProjectLoaders {
  const editor = lazyOnce(() =>
    api.get<ProjectEditorData>(`/api/tenant/projects/${encodeURIComponent(projectId)}/editor`),
  );
  const cables = lazyOnce(async () => loadProjectCables(projectId, racksOf((await editor.get()).inventaire.racks)));
  return {
    editor,
    cables,
    reset: () => {
      editor.reset();
      cables.reset();
    },
  };
}

export type ProjectPaletteNav = {
  /** Navigation gardée (saisies non enregistrées) ; `before` s'exécute une fois la garde passée. */
  go: (href: string, opts?: { replace?: boolean; before?: () => void }) => void;
  /** Requête de l'URL courante (paramètres conservés). */
  search: () => { toString(): string } | null;
};

const KIND: Record<InventaireBomItem["kind"], string | null> = {
  equipment: null,
  panel: "Panel",
  adapter: "Adaptateur",
  accessory: "Accessoire",
};

const MANAGE_PAGES: { page: ManagePage; label: string; icon: PaletteItem["icon"] }[] = [
  { page: "overview", label: "Vue d'ensemble", icon: <Gauge className={ICON} /> },
  { page: "fiche", label: "Fiche", icon: <ClipboardList className={ICON} /> },
  { page: "materiel", label: "Matériel", icon: <Box className={ICON} /> },
  { page: "cables", label: "Câbles", icon: <Cable className={ICON} /> },
];

const CONCEVOIR: { tab: ProjectTabId; label: string; icon: PaletteItem["icon"] }[] = [
  { tab: "synoptique", label: "Synoptique", icon: <Workflow className={ICON} /> },
  { tab: "rack", label: "Racks", icon: <Server className={ICON} /> },
];

/** Enregistre les sources du projet `projectId` ; renvoie la fonction qui les retire. */
export function registerProjectSources(
  projectId: string,
  loaders: ProjectLoaders,
  nav: () => ProjectPaletteNav,
): () => void {
  const base = `/project/${projectId}`;
  const manage = (page: ManagePage, sel?: string | null) => `${base}?${manageQuery(nav().search(), page, sel)}`;
  const inPlace = { replace: true };

  const offs = [
    registerPaletteSource("project-materiel", async () => {
      const { inventaire } = await loaders.editor.get();
      const locationName = new Map(inventaire.locations.map((l) => [l.id, l.name]));
      return inventaire.racks.flatMap((rack) => {
        const place = rack.isVirtual
          ? (rack.locationId ? locationName.get(rack.locationId) : null) ?? null
          : rack.name || null;
        return rack.bom.map<PaletteItem>((item) => ({
          group: "Matériel",
          label: item.name,
          sub: [KIND[item.kind], item.brandName, place].filter(Boolean).join(" · ") || undefined,
          icon: <Box className={ICON} />,
          run: () => nav().go(manage("materiel", item.id), inPlace),
        }));
      });
    }),
    registerPaletteSource("project-cables", async () =>
      (await loaders.cables.get()).map<PaletteItem>((row) => ({
        group: "Câbles",
        label: row.label ?? "Sans numéro",
        sub: `${row.from.name} → ${row.to.name}`,
        icon: <Cable className={ICON} />,
        run: () => nav().go(manage("cables", row.id), inPlace),
      })),
    ),
    registerPaletteSource("project-actions", () => {
      const tab = (id: ProjectTabId, before?: () => void) => () =>
        nav().go(projectTabHref(projectId, nav().search(), id), {
          replace: true,
          before: () => {
            before?.();
            rememberEditorTab(id);
          },
        });
      return [
        {
          group: "Projet",
          label: "Valider",
          sub: "Contrôles du synoptique",
          icon: <ShieldCheck className={ICON} />,
          run: tab("synoptique", () => useValidationRequest.getState().request(projectId)),
        },
        {
          group: "Projet",
          label: "Ajouter du matériel",
          sub: "Catalogue de l'inventaire",
          icon: <Plus className={ICON} />,
          run: () =>
            nav().go(manage("materiel"), {
              replace: true,
              before: () => useAddEquipmentRequest.getState().request(projectId),
            }),
        },
        ...CONCEVOIR.map<PaletteItem>((c) => ({
          group: "Projet",
          label: `Aller à Concevoir · ${c.label}`,
          icon: c.icon,
          run: tab(c.tab),
        })),
        ...MANAGE_PAGES.map<PaletteItem>((p) => ({
          group: "Projet",
          label: `Aller à Gérer · ${p.label}`,
          icon: p.icon,
          run: () => nav().go(manage(p.page), inPlace),
        })),
      ];
    }),
  ];
  return () => offs.forEach((off) => off());
}
