"use client";

/**
 * Topbar de l'éditeur projet, interface Strata v2 (46 px, spec v2 §4.1),
 * mêmes props que `ProjectGlobalTopbar` ; de gauche à droite :
 *   - lockup (vers les projets), « PROJET / nom », statut du projet (même
 *     menu et mêmes couleurs que la topbar Classique) ;
 *   - sélecteur d'espace `Concevoir` · `Gérer` (`?space=gerer`) ;
 *   - menu « Vues » : tous les onglets d'arkyo (et les sous-onglets de
 *     Lumière et Réseau), plus les caractéristiques et l'export du dossier,
 *     pour qu'aucune fonction ne soit perdue tant que Gérer n'est pas bâti ;
 *   - état d'enregistrement de l'éditeur (`withStrataSaveStatus`), ⌘K (la
 *     palette est montée ici : l'éditeur plein écran n'a pas la topbar v2),
 *     présence, Fermer.
 *
 * Mêmes `ProjectTabId`, même `?tab=` et même stockage local que la pill
 * d'arkyo : libellés, onglet actif et sous-onglets sont lus sur l'élément
 * `ProjectTabsPill` reçu en `tabs` (rendu par l'éditeur). À défaut, `?tab=`
 * et les libellés d'arkyo. Choisir une vue revient dans Concevoir.
 */

import { isValidElement, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, ClipboardList, Download, Layers, Search, X } from "@/components/ui/icons";
import { StrataBrand } from "@/components/brand/strata-brand";
import { PresenceAvatars } from "@/components/presence/presence-avatars";
import type { ProjectGlobalTopbarProps } from "@/app/(fullscreen)/project/[id]/_editor/project-global-topbar";
import { STATUS_OPTIONS, type ProjectStatus } from "@/app/(fullscreen)/project/[id]/_editor/project-header-block";
import { ProjectTabsPill } from "@/app/(fullscreen)/project/[id]/_editor/project-tabs-pill";
import type { ProjectTabId, TabSubItem } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { cn } from "@/lib/utils";
import { CommandPalette } from "../palette/command-palette";
import { StrataSaveBadge, useStrataSaveStatus } from "./save-status";
import { TOPBAR_ICON_BTN } from "./seg-tabs";
import { SPACE_PARAM, SpaceSwitch } from "./space-switch";
import { openStrataPalette } from "./topbar-v2";

/** Onglets d'arkyo rangés par espace (spec v2 §7). */
export const VIEW_GROUPS: { label: string; tabs: ProjectTabId[] }[] = [
  { label: "Concevoir", tabs: ["synoptique", "rack", "schema", "cartographie", "video", "audio", "lumiere"] },
  { label: "Gérer", tabs: ["inventaire", "reseau", "preparation", "recette"] },
];

const ALL_TAB_IDS = VIEW_GROUPS.flatMap((g) => g.tabs);

/** Clé de stockage de l'onglet de l'éditeur (`project-editor.tsx`). */
const EDITOR_TAB_KEY = "project-editor-tab";

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

const isTabId = (v: unknown): v is ProjectTabId => typeof v === "string" && ALL_TAB_IDS.includes(v as ProjectTabId);

type PillProps = ComponentProps<typeof ProjectTabsPill>;

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

const MENU_ITEM =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--muted-foreground)] outline-none transition-colors data-[highlighted]:bg-[var(--muted)] data-[highlighted]:text-[var(--foreground)]";
const MENU_LABEL = "px-2 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase";

function ViewItem({ label, current, inset, onSelect }: { label: string; current: boolean; inset?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      aria-current={current ? "page" : undefined}
      className={cn(MENU_ITEM, inset && "pl-5", current && "font-medium text-[var(--foreground)]")}
    >
      <span className="flex-1 truncate">{label}</span>
      {current && <Check className="h-3.5 w-3.5 text-[var(--accent-strong)]" />}
    </DropdownMenu.Item>
  );
}

/** Menu « Vues » : tous les onglets d'arkyo, tant que Gérer n'est pas bâti. */
function ViewsMenu({
  tabs,
  onEditCharacteristics,
  onExport,
}: {
  tabs: ReactNode;
  onEditCharacteristics?: () => void;
  onExport?: () => void;
}) {
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
  const queryTab = searchParams?.get("tab");
  const active: ProjectTabId | null = pill?.active ?? (isTabId(queryTab) ? queryTab : null);

  // `?tab=` et stockage local comme `handleTabChange` ; une vue se montre dans Concevoir.
  const go = (id: ProjectTabId, sub?: string) => {
    try {
      window.localStorage.setItem(EDITOR_TAB_KEY, JSON.stringify(id));
    } catch {
      /* stockage indisponible */
    }
    if (sub) pill?.onSubChange?.(id, sub);
    const query = new URLSearchParams(searchParams?.toString() ?? "");
    query.set("tab", id);
    query.delete(SPACE_PARAM);
    router.replace(`/project/${params?.id}?${query.toString()}`, { scroll: false });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium text-[var(--muted-foreground)] transition-colors outline-none hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-[var(--muted)] data-[state=open]:text-[var(--foreground)]"
        >
          <Layers className="h-3.5 w-3.5" />
          Vues
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[calc(100vh-80px)] min-w-[220px] overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--popover)] p-1 shadow-xl"
        >
          {VIEW_GROUPS.map((group) => (
            <DropdownMenu.Group key={group.label}>
              <DropdownMenu.Label className={MENU_LABEL}>{group.label}</DropdownMenu.Label>
              {group.tabs.map((id) => {
                const subTabs = subs[id];
                if (!subTabs) {
                  return <ViewItem key={id} label={label(id)} current={active === id} onSelect={() => go(id)} />;
                }
                return (
                  <DropdownMenu.Group key={id} aria-label={label(id)}>
                    <div className="px-2 pt-1.5 pb-0.5 text-[12px] font-medium text-[var(--text-tertiary)]">{label(id)}</div>
                    {subTabs.map((s) => (
                      <ViewItem
                        key={s.id}
                        inset
                        label={s.label}
                        current={active === id && pill?.subValue === s.id}
                        onSelect={() => go(id, s.id)}
                      />
                    ))}
                  </DropdownMenu.Group>
                );
              })}
            </DropdownMenu.Group>
          ))}
          {(onEditCharacteristics || onExport) && (
            <>
              <DropdownMenu.Separator className="mx-1 my-1 h-px bg-[var(--border)]" />
              <DropdownMenu.Label className={MENU_LABEL}>Projet</DropdownMenu.Label>
              {onEditCharacteristics && (
                <DropdownMenu.Item onSelect={onEditCharacteristics} className={MENU_ITEM}>
                  <ClipboardList className="h-3.5 w-3.5" />
                  Caractéristiques du projet
                </DropdownMenu.Item>
              )}
              {onExport && (
                <DropdownMenu.Item onSelect={onExport} className={MENU_ITEM}>
                  <Download className="h-3.5 w-3.5" />
                  Exporter un dossier
                </DropdownMenu.Item>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export type ProjectTopbarV2Props = ProjectGlobalTopbarProps & {
  /** Libellés et couleurs des statuts (ceux de la topbar Classique). */
  statusMeta: Record<ProjectStatus, { label: string; color: string }>;
};

export function ProjectTopbarV2({
  projectName,
  tenantName,
  status,
  onStatusChange,
  onEditCharacteristics,
  onExport,
  tabs,
  onClose,
  statusMeta,
}: ProjectTopbarV2Props) {
  const saveStatus = useStrataSaveStatus();

  return (
    <header className="flex h-full items-center gap-3.5 bg-[var(--surface)] px-3.5 text-[13px] text-[var(--muted-foreground)]">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center"
        title={tenantName ? `Espace ${tenantName}` : "Projets"}
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

      <div className="min-w-0 flex-1" />

      <SpaceSwitch />
      <ViewsMenu tabs={tabs} onEditCharacteristics={onEditCharacteristics} onExport={onExport} />

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        {/* État d'enregistrement visible : le repère masque le badge de la barre contextuelle. */}
        {saveStatus !== undefined && saveStatus !== "idle" && (
          <span data-strata-save="" className="mr-1.5 inline-flex">
            <StrataSaveBadge status={saveStatus} />
          </span>
        )}
        <button
          type="button"
          onClick={openStrataPalette}
          aria-label="Rechercher ou agir (⌘K)"
          title="Rechercher ou agir (⌘K)"
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--muted)] px-2 text-[12.5px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--muted-foreground)]"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-sans text-[10.5px] text-[var(--muted-foreground)]">
            ⌘K
          </kbd>
        </button>
        <PresenceAvatars className="mr-1" />
        <button
          type="button"
          onClick={onClose}
          title="Fermer l'édition"
          aria-label="Fermer l'édition"
          className={cn(TOPBAR_ICON_BTN, "ml-1")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <CommandPalette />
    </header>
  );
}
