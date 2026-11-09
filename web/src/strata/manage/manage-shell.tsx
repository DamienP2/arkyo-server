"use client";

/**
 * Espace « Gérer » de l'éditeur projet en interface Strata v2 (spec v2 §4.2,
 * maquette `.gerer`) : sous la topbar projet v2, une colonne de navigation
 * fine (pages de Gérer, raccourcis vers Concevoir, préférence « Toujours
 * afficher les sections avancées »), puis la page : liste et détail.
 *
 * Rendu par `project-editor.tsx` (accroche `// arkyo-server: interface
 * Strata`) quand `?space=gerer`, quel que soit `?tab=` : aucun onglet de
 * Concevoir n'est monté (ni canevas, ni raccourcis ; Ruling 5). Page par
 * `?page=overview|fiche|materiel|cables|reseau|livraison|dossier` (Vue
 * d'ensemble par défaut), objet sélectionné par `?sel=`.
 */

import type { MouseEvent, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { ProjectEditorData } from "@/app/(fullscreen)/project/[id]/_components/project-editor";
import {
  Box as BoxIcon,
  Cable,
  ClipboardList,
  FileStack,
  Gauge,
  Network,
  Server,
  Truck,
  Workflow,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { AdvancedAlwaysToggle } from "../advanced/advanced-section";
import { SHELL_TOP, STRATA_TOPBAR_H } from "../shell/canvas-shell";
import { useInterface } from "../interface-context";
import { spaceOf } from "../shell/space-switch";
import { CablesPage } from "./cables-page";
import { FichePage } from "./fiche-page";
import { SECTION_LABEL } from "./manage-ui";
import { MaterielPage } from "./materiel-page";
import { OverviewPage } from "./overview";
import { ComingSoonPage } from "./stub-page";
import { allCables, computeTodo, unplacedItems, type ManagePage } from "./todo-model";
import { useManageData, useManageNav, type ManageNav, type ManageState } from "./use-manage";

/** Espace Gérer demandé (Strata seulement) : `?space=gerer`. */
export function useStrataManageSpace(): boolean {
  const ui = useInterface();
  const searchParams = useSearchParams();
  return ui === "strata" && spaceOf(searchParams) === "gerer";
}

const PAGES: { id: ManagePage; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: <Gauge /> },
  { id: "fiche", label: "Fiche", icon: <ClipboardList /> },
  { id: "materiel", label: "Matériel", icon: <BoxIcon /> },
  { id: "cables", label: "Câbles", icon: <Cable /> },
  { id: "reseau", label: "Réseau", icon: <Network /> },
  { id: "livraison", label: "Livraison", icon: <Truck /> },
  { id: "dossier", label: "Dossier", icon: <FileStack /> },
];

const NAV_ITEM =
  "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium no-underline transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

const plainClick = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

function Badge({ n, tone }: { n: number; tone: "warn" | "count" }) {
  return (
    <span
      className={cn(
        "rounded-lg px-1.5 py-px font-mono text-[10.5px] font-semibold tabular-nums",
        tone === "warn"
          ? "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning-text)]"
          : "text-[var(--text-tertiary)]",
      )}
    >
      {n}
    </span>
  );
}

function ManageNavColumn({ data, nav }: { data: ManageState; nav: ManageNav }) {
  const todo = data.loading ? null : computeTodo(data).length;
  const unplaced = unplacedItems(data).reduce((n, u) => n + u.missing, 0);
  const cables = allCables(data);
  const badge: Partial<Record<ManagePage, ReactNode>> = {
    overview: todo ? <Badge n={todo} tone="warn" /> : null,
    fiche: data.fiche.counts.tasks > 0 ? <Badge n={data.fiche.counts.tasks} tone="count" /> : null,
    materiel: unplaced > 0 ? <Badge n={unplaced} tone="warn" /> : null,
    cables: cables && cables.length > 0 ? <Badge n={cables.length} tone="count" /> : null,
  };

  const concevoir = (e: MouseEvent<HTMLAnchorElement>, go: () => void) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    go();
  };

  return (
    <nav
      aria-label="Gérer"
      className="flex min-h-0 flex-col gap-0.5 overflow-auto border-r border-[var(--border)] bg-[var(--card)] px-2 pt-3.5 pb-3"
    >
      <span className={cn(SECTION_LABEL, "px-2.5 pb-1.5")}>Gérer le projet</span>
      {PAGES.map((p) => {
        const on = p.id === nav.page;
        return (
          <a
            key={p.id}
            href={nav.href(p.id)}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              if (!on || nav.sel) nav.go(p.id);
            }}
            className={cn(
              NAV_ITEM,
              on
                ? "bg-[var(--muted)] text-[var(--foreground)] [&_svg]:text-[var(--accent-strong)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
            )}
          >
            {p.icon}
            <span className="flex-1">{p.label}</span>
            {badge[p.id]}
          </a>
        );
      })}

      <span className={cn(SECTION_LABEL, "px-2.5 pt-4 pb-1.5")}>Concevoir</span>
      <a
        href="?tab=synoptique"
        onClick={(e) => concevoir(e, () => nav.goToTab("synoptique"))}
        className={cn(NAV_ITEM, "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]")}
      >
        <Workflow />
        <span className="flex-1">Synoptique</span>
      </a>
      <a
        href="?tab=rack"
        onClick={(e) => concevoir(e, () => nav.goToRack(null))}
        className={cn(NAV_ITEM, "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]")}
      >
        <Server />
        <span className="flex-1">Racks</span>
      </a>

      <div className="flex-1" />
      <AdvancedAlwaysToggle className="px-2.5 pt-4" />
    </nav>
  );
}

export function ManageShell({
  project,
  topbar,
  onEditCharacteristics,
  onOpenCatalogue,
}: {
  project: ProjectEditorData;
  /** Topbar projet (v2 en Strata), avec l'état d'enregistrement. */
  topbar: ReactNode;
  /** Ouvre le dialogue des caractéristiques d'arkyo (monté par l'éditeur). */
  onEditCharacteristics: () => void;
  /** Ouvre l'outil Équipements de l'Inventaire (état de l'éditeur). */
  onOpenCatalogue: () => void;
}) {
  const data = useManageData(project);
  const nav = useManageNav(project.header.id);

  let page: ReactNode;
  switch (nav.page) {
    case "fiche":
      page = <FichePage data={data} onEditCharacteristics={onEditCharacteristics} />;
      break;
    case "materiel":
      page = <MaterielPage data={data} nav={nav} onOpenCatalogue={onOpenCatalogue} />;
      break;
    case "cables":
      page = <CablesPage data={data} nav={nav} />;
      break;
    case "reseau":
      page = <ComingSoonPage title="Réseau" />;
      break;
    case "livraison":
      page = <ComingSoonPage title="Livraison" />;
      break;
    case "dossier":
      page = <ComingSoonPage title="Dossier" />;
      break;
    default:
      page = <OverviewPage data={data} nav={nav} />;
  }

  return (
    <div
      data-strata-manage-shell=""
      className="fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      style={{ top: SHELL_TOP }}
    >
      <div data-zone="topbar" style={{ height: STRATA_TOPBAR_H }} className="flex-none border-b border-[var(--border)]">
        {topbar}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[212px_minmax(0,1fr)]">
        <ManageNavColumn data={data} nav={nav} />
        <main className="flex min-h-0 min-w-0 flex-col">
          {page}
        </main>
      </div>
    </div>
  );
}
