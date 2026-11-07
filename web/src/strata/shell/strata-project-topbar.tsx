"use client";

/**
 * Topbar de l'éditeur projet (interface Strata), mêmes props que
 * `ProjectGlobalTopbar` :
 *   - lockup, « PROJET / nom », statut ;
 *   - onglets segmentés Conception · Inventaire · Livraison ;
 *   - présence, `Fiche` (dialogue des caractéristiques), `Dossier` (export du
 *     dossier), fermeture.
 *
 * Mêmes `ProjectTabId`, même `?tab=` et même stockage local que la pill
 * d'arkyo : la topbar lit `active`, `onChange`, `subValue` et `onSubChange`
 * sur l'élément `ProjectTabsPill` reçu en `tabs` (rendu par l'éditeur, pas
 * ici). À défaut (repli), elle lit `?tab=` et écrit comme `handleTabChange` ;
 * les sous-onglets de Lumière et Réseau, propres à la pill, ne sont alors pas
 * proposés.
 *
 * Conception ouvre la barre de lentilles (Rack, Connectique … Réseau, avec
 * les sous-onglets existants de Lumière et Réseau), Livraison la barre
 * Préparation · Recette : les deux s'affichent en tête de la colonne centrale
 * de `StrataEditorShell`. Connectique, propre à Strata, est l'onglet `rack`
 * avec `?lens=connectique` (pas de nouvel identifiant d'onglet) ; quitter la
 * lentille retire le paramètre.
 *
 * À droite, l'état d'enregistrement de l'éditeur (`withStrataSaveStatus`).
 */

import { Fragment, isValidElement, useEffect, type ComponentProps, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Cable,
  Check,
  ChevronDown,
  ClipboardList,
  FileStack,
  Layers,
  Lightbulb,
  List,
  Map as MapIcon,
  Mic,
  Network,
  PenTool,
  Server,
  Truck,
  Video,
  Workflow,
  X,
} from "@/components/ui/icons";
import { StrataBrand } from "@/components/brand/strata-brand";
import { PresenceAvatars } from "@/components/presence/presence-avatars";
import type { ProjectGlobalTopbarProps } from "@/app/(fullscreen)/project/[id]/_editor/project-global-topbar";
import { STATUS_OPTIONS, type ProjectStatus } from "@/app/(fullscreen)/project/[id]/_editor/project-header-block";
import { ProjectTabsPill } from "@/app/(fullscreen)/project/[id]/_editor/project-tabs-pill";
import type { ProjectTabId, TabSubItem } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { cn } from "@/lib/utils";
import { LENS_PARAM, LENS_TAB, lensOf, type StrataLens } from "../lenses/strata-lens";
import { StrataSaveBadge, useStrataSaveStatus } from "./save-status";
import { SEG_BAR, SEG_TAB, SEG_TAB_OFF, SEG_TAB_ON } from "./seg-tabs";
import { useStrataLensSlot } from "./strata-editor-shell";

/** Lentilles de l'onglet Conception, dans l'ordre de la pill d'arkyo. */
export const CONCEPTION_LENSES: ProjectTabId[] = [
  "rack",
  "synoptique",
  "schema",
  "cartographie",
  "video",
  "audio",
  "lumiere",
  "reseau",
];

/** Onglets regroupés sous Livraison. */
export const LIVRAISON_TABS: ProjectTabId[] = ["preparation", "recette"];

const ALL_TAB_IDS: ProjectTabId[] = ["inventaire", ...CONCEPTION_LENSES, ...LIVRAISON_TABS];

/** Clés de stockage de l'éditeur (`project-editor.tsx`) et de la dernière lentille. */
const EDITOR_TAB_KEY = "project-editor-tab";
const LENS_KEY = "strata-project-lens";

/** Libellés de `TABS` (project-editor.tsx), si la pill n'est pas fournie. */
const DEFAULT_LABELS: Record<ProjectTabId, string> = {
  inventaire: "Inventaire",
  rack: "Rack",
  synoptique: "Synoptique",
  schema: "Schémas",
  cartographie: "Plan",
  video: "Vidéo",
  audio: "Audio",
  lumiere: "Lumière",
  reseau: "Réseau",
  preparation: "Préparation",
  recette: "Recette",
};

type IconType = ComponentType<{ className?: string }>;

const LENS_ICONS: Partial<Record<ProjectTabId, IconType>> = {
  rack: Server,
  synoptique: Workflow,
  schema: PenTool,
  cartographie: MapIcon,
  video: Video,
  audio: Mic,
  lumiere: Lightbulb,
  reseau: Network,
};

type Section = "conception" | "inventaire" | "livraison";

const sectionOf = (id: ProjectTabId): Section =>
  CONCEPTION_LENSES.includes(id) ? "conception" : LIVRAISON_TABS.includes(id) ? "livraison" : "inventaire";

const isTabId = (v: unknown): v is ProjectTabId => typeof v === "string" && ALL_TAB_IDS.includes(v as ProjectTabId);

function readLens(): ProjectTabId {
  try {
    const raw = window.localStorage.getItem(LENS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (isTabId(v) && CONCEPTION_LENSES.includes(v)) return v;
  } catch {
    /* stockage indisponible */
  }
  return CONCEPTION_LENSES[0];
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

type PillProps = ComponentProps<typeof ProjectTabsPill>;

type TabNav = {
  active: ProjectTabId;
  /** Lentille Strata ouverte sur l'onglet actif (`?lens=`). */
  lens: StrataLens | null;
  go: (id: ProjectTabId) => void;
  /** Ouvre une lentille Strata (ou la quitte, `null`) sur l'onglet `id`. */
  goLens: (id: ProjectTabId, lens: StrataLens | null) => void;
  label: (id: ProjectTabId) => string;
  subTabs: (id: ProjectTabId) => TabSubItem[] | undefined;
  subValue?: string;
  onSubChange?: (id: ProjectTabId, subId: string) => void;
};

/**
 * Navigation entre onglets : celle de la pill de l'éditeur quand elle est
 * fournie, sinon `?tab=` et le stockage local comme `handleTabChange`.
 */
function useTabNav(tabs: ReactNode): TabNav {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const pill = isValidElement(tabs) && tabs.type === ProjectTabsPill ? (tabs.props as PillProps) : null;

  const labels: Partial<Record<ProjectTabId, string>> = {};
  const subs: Partial<Record<ProjectTabId, TabSubItem[]>> = {};
  for (const t of pill?.tabs ?? []) {
    labels[t.id] = t.label;
    if (t.navGroup) for (const s of t.subTabs ?? []) labels[s.id as ProjectTabId] = s.label;
    else if (t.subTabs?.length) subs[t.id] = t.subTabs;
  }
  const label = (id: ProjectTabId) => labels[id] ?? DEFAULT_LABELS[id];
  const subTabs = (id: ProjectTabId) => subs[id];
  // `?lens=` tel qu'il est dans l'URL ; il ne vaut que sur l'onglet qui porte la lentille.
  const rawLens = lensOf(searchParams);
  const lensOn = (active: ProjectTabId) => (rawLens && LENS_TAB[rawLens] === active ? rawLens : null);

  // `?tab=` et stockage local comme `handleTabChange`, `?lens=` en plus.
  const goLens = (id: ProjectTabId, next: StrataLens | null) => {
    writeStorage(EDITOR_TAB_KEY, id);
    const query = new URLSearchParams(searchParams?.toString() ?? "");
    query.set("tab", id);
    if (next) query.set(LENS_PARAM, next);
    else query.delete(LENS_PARAM);
    router.replace(`/project/${params?.id}?${query.toString()}`, { scroll: false });
  };
  // Changer d'onglet quitte la lentille Strata (retire `?lens=`) ; rester sur l'onglet la garde.
  const leaving = (go: (id: ProjectTabId) => void, active: ProjectTabId) => (id: ProjectTabId) => {
    if (!rawLens) go(id);
    else if (id !== active || !lensOn(active)) goLens(id, null);
  };

  if (pill) {
    return {
      active: pill.active,
      lens: lensOn(pill.active),
      go: leaving(pill.onChange, pill.active),
      goLens,
      label,
      subTabs,
      subValue: pill.subValue,
      onSubChange: pill.onSubChange,
    };
  }
  // Repli explicite : navigation par `?tab=`, sans les sous-onglets de la pill.
  const queryTab = searchParams?.get("tab");
  const active = isTabId(queryTab) ? queryTab : "inventaire";
  return {
    active,
    lens: lensOn(active),
    go: leaving((id) => goLens(id, null), active),
    goLens,
    label,
    subTabs,
  };
}

/** Lien d'onglet : `?tab=` (ouverture dans un nouvel onglet), navigation via `go`. */
function TabLink({
  id,
  lens = null,
  on,
  go,
  className,
  children,
}: {
  id: ProjectTabId;
  /** Lentille Strata de l'onglet (`?lens=`). */
  lens?: StrataLens | null;
  on: boolean;
  go: (id: ProjectTabId) => void;
  className: string;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go(id);
  };
  const href = lens ? `?tab=${id}&${LENS_PARAM}=${lens}` : `?tab=${id}`;
  return (
    <a href={href} onClick={onClick} aria-current={on ? "page" : undefined} className={className}>
      {children}
    </a>
  );
}

const TAB =
  "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-[5px] text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const TAB_ON = "bg-[var(--muted)] text-[var(--foreground)]";
const TAB_OFF = "text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
const BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--muted-foreground)] outline-none transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]";

/** Barre de lentilles (Conception) ou de Livraison, en tête de la colonne centrale. */
function SectionBar({ nav, section }: { nav: TabNav; section: Section }) {
  const ids = section === "conception" ? CONCEPTION_LENSES : LIVRAISON_TABS;
  const subTabs = section === "conception" ? nav.subTabs(nav.active) : undefined;
  return (
    <nav aria-label={section === "conception" ? "Lentilles" : "Livraison"} className={cn(SEG_BAR, "px-3")}>
      {ids.map((id) => {
        const Icon = LENS_ICONS[id];
        const on = id === nav.active && !nav.lens;
        return (
          <Fragment key={id}>
            <TabLink
              id={id}
              on={on}
              go={(t) => (nav.lens && t === nav.active ? nav.goLens(t, null) : nav.go(t))}
              className={cn(SEG_TAB, on ? SEG_TAB_ON : SEG_TAB_OFF)}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {nav.label(id)}
            </TabLink>
            {/* Lentille propre à Strata : l'onglet Rack, vue Connectique. */}
            {id === "rack" && (
              <TabLink
                id="rack"
                lens="connectique"
                on={nav.active === "rack" && nav.lens === "connectique"}
                go={() => nav.goLens("rack", "connectique")}
                className={cn(SEG_TAB, nav.active === "rack" && nav.lens === "connectique" ? SEG_TAB_ON : SEG_TAB_OFF)}
              >
                <Cable className="h-3.5 w-3.5" />
                Connectique
              </TabLink>
            )}
          </Fragment>
        );
      })}
      {subTabs && (
        <>
          <div className="flex-1" />
          <div
            role="group"
            aria-label={nav.label(nav.active)}
            className="mb-1 inline-flex shrink-0 self-center rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5"
          >
            {subTabs.map((s) => {
              const on = s.id === nav.subValue;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => nav.onSubChange?.(nav.active, s.id)}
                  className={cn(
                    "rounded px-2.5 py-[3px] text-[12px] whitespace-nowrap transition-colors",
                    on
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </nav>
  );
}

/** Statut du projet : même menu que la topbar Classique (couleurs de statut inchangées). */
function StatusMenu({
  status,
  meta,
  onStatusChange,
}: {
  status: ProjectStatus;
  meta: Record<ProjectStatus, { label: string; color: string }>;
  onStatusChange: (next: ProjectStatus) => Promise<void> | void;
}) {
  const current = meta[status];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase outline-none transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label={`Statut : ${current.label} — modifier`}
          style={{ fontFamily: "var(--font-mono)", background: current.color }}
        >
          {current.label}
          <ChevronDown className="ml-0.5 h-3 w-3" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-md"
        >
          {STATUS_OPTIONS.map((opt) => {
            const isCurrent = opt.value === status;
            return (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={(e) => {
                  e.preventDefault();
                  if (isCurrent) return;
                  void onStatusChange(opt.value);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                  "data-[highlighted]:bg-[var(--secondary)]/60 data-[highlighted]:text-[var(--foreground)]",
                  isCurrent && "font-medium",
                )}
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: meta[opt.value].color }}
                />
                <span className="flex-1 truncate">{opt.label}</span>
                {isCurrent && <Check className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export type StrataProjectTopbarProps = ProjectGlobalTopbarProps & {
  /** Libellés et couleurs des statuts (ceux de la topbar Classique). */
  statusMeta: Record<ProjectStatus, { label: string; color: string }>;
};

export function StrataProjectTopbar({
  projectName,
  tenantName,
  status,
  onStatusChange,
  onEditCharacteristics,
  onExport,
  tabs,
  onClose,
  statusMeta,
}: StrataProjectTopbarProps) {
  const nav = useTabNav(tabs);
  const lensSlot = useStrataLensSlot();
  const saveStatus = useStrataSaveStatus();
  const section = sectionOf(nav.active);

  // Conception rouvre la dernière lentille consultée.
  useEffect(() => {
    if (sectionOf(nav.active) === "conception") writeStorage(LENS_KEY, nav.active);
  }, [nav.active]);

  const targetOf = (s: Section): ProjectTabId =>
    s === section ? nav.active : s === "conception" ? readLens() : s === "livraison" ? LIVRAISON_TABS[0] : "inventaire";

  const SECTIONS: { id: Section; label: string; icon: IconType }[] = [
    { id: "conception", label: "Conception", icon: Layers },
    { id: "inventaire", label: nav.label("inventaire"), icon: List },
    { id: "livraison", label: "Livraison", icon: Truck },
  ];

  return (
    <header className="flex h-full items-center gap-[18px] bg-[var(--surface)] px-3.5 text-[13px] text-[var(--muted-foreground)]">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center"
        title={tenantName ? `Espace ${tenantName}` : "Accueil"}
      >
        <StrataBrand />
      </Link>

      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 max-w-[260px] flex-col leading-[1.15]">
          <small className="text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">Projet</small>
          <strong className="truncate font-semibold text-[var(--foreground)]">{projectName}</strong>
        </div>
        {status && onStatusChange && <StatusMenu status={status} meta={statusMeta} onStatusChange={onStatusChange} />}
      </div>

      <nav
        aria-label="Onglets du projet"
        className="flex shrink-0 items-center gap-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]"
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const on = id === section;
          return (
            <TabLink key={id} id={targetOf(id)} on={on} go={nav.go} className={cn(TAB, on ? TAB_ON : TAB_OFF)}>
              <Icon className="h-4 w-4" />
              {label}
            </TabLink>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        {/* État d'enregistrement visible : le repère masque le badge de la barre contextuelle. */}
        {saveStatus !== undefined && saveStatus !== "idle" && (
          <span data-strata-save="" className="mr-1.5 inline-flex">
            <StrataSaveBadge status={saveStatus} />
          </span>
        )}
        <PresenceAvatars className="mr-1" />
        {onEditCharacteristics && (
          <button type="button" onClick={onEditCharacteristics} title="Caractéristiques du projet" className={BTN}>
            <ClipboardList className="h-3.5 w-3.5" />
            Fiche
          </button>
        )}
        {onExport && (
          <button type="button" onClick={onExport} title="Exporter un dossier" className={BTN}>
            <FileStack className="h-3.5 w-3.5" />
            Dossier
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Fermer l'édition"
          aria-label="Fermer l'édition"
          className={cn(ICON_BTN, "ml-1")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {lensSlot && section !== "inventaire" && createPortal(<SectionBar nav={nav} section={section} />, lensSlot)}
    </header>
  );
}
