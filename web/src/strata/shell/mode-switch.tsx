"use client";

/**
 * Sélecteur de mode de Concevoir (spec v2 §4.1), en tête de la barre d'outils
 * flottante : `Synoptique` · `Racks` · `Plan` · `Lumière` · `Schémas`. Chaque
 * mode est un onglet existant de l'éditeur projet (`?tab=`, même logique que
 * `handleTabChange`) ; Plan, Lumière et Schémas restent les bouchons de la
 * phase 5, comme en Classique. Les autres vues restent dans le menu « Vues »
 * de la topbar.
 */

import { useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import { Check, ChevronDown, Lightbulb, Map as MapIcon, PenTool, Server, Workflow } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useGoToProjectTab } from "./tab-nav";

export const CONCEVOIR_MODES: { tab: ProjectTabId; label: string; icon: typeof Workflow }[] = [
  { tab: "synoptique", label: "Synoptique", icon: Workflow },
  { tab: "rack", label: "Racks", icon: Server },
  { tab: "cartographie", label: "Plan", icon: MapIcon },
  { tab: "lumiere", label: "Lumière", icon: Lightbulb },
  { tab: "schema", label: "Schémas", icon: PenTool },
];

/** Mode de Concevoir de l'onglet courant (`?tab=`), `null` hors de ces modes. */
export function useConcevoirMode(): ProjectTabId | null {
  const tab = useSearchParams()?.get("tab");
  return CONCEVOIR_MODES.some((m) => m.tab === tab) ? (tab as ProjectTabId) : null;
}

const ITEM =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--muted-foreground)] outline-none transition-colors data-[highlighted]:bg-[var(--muted)] data-[highlighted]:text-[var(--foreground)]";

export function ModeSwitch({ mode }: { mode: ProjectTabId }) {
  const goToTab = useGoToProjectTab();
  const current = CONCEVOIR_MODES.find((m) => m.tab === mode) ?? CONCEVOIR_MODES[0];
  const Icon = current.icon;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Mode : ${current.label}`}
          title="Mode de Concevoir"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] pr-2 pl-2.5 text-[12.5px] font-semibold whitespace-nowrap text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-[var(--muted)]"
        >
          <Icon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          {current.label}
          <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-[180px] rounded-lg border border-[var(--border-strong)] bg-[var(--popover)] p-1 shadow-xl"
        >
          {CONCEVOIR_MODES.map((m) => {
            const on = m.tab === current.tab;
            const MIcon = m.icon;
            return (
              <DropdownMenu.Item
                key={m.tab}
                onSelect={() => {
                  if (!on) goToTab(m.tab);
                }}
                aria-current={on ? "page" : undefined}
                className={cn(ITEM, on && "font-medium text-[var(--foreground)]")}
              >
                <MIcon className="h-3.5 w-3.5" />
                <span className="flex-1">{m.label}</span>
                {on && <Check className="h-3.5 w-3.5 text-[var(--accent-strong)]" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
