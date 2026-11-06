"use client";

import { ChevronDown } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ProjectTabId, TabDescriptor } from "./tab-bar";

/**
 * Onglets pill rendus à cheval dans la topbar globale (cf. spec § 5.3 et le
 * pattern `topbar.tsx:577-580`). Reçus via la prop `tabs` de
 * `ProjectGlobalTopbar` puis du `EditorShell`.
 *
 * Un onglet peut porter des `subTabs` → il devient un DROPDOWN (ex. Lumière →
 * Plan de feu / Adressage DMX). Le sous-onglet actif est piloté par le parent
 * (`subValue` + `onSubChange`).
 */
export function ProjectTabsPill({
  tabs,
  active,
  onChange,
  subValue,
  onSubChange,
}: {
  tabs: TabDescriptor[];
  active: ProjectTabId;
  onChange: (id: ProjectTabId) => void;
  /** Sous-onglet actif (pour l'onglet dropdown courant). */
  subValue?: string;
  onSubChange?: (tabId: ProjectTabId, subId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((t) =>
        t.subTabs && t.subTabs.length > 0 ? (
          (() => {
            const isGroup = t.navGroup === true;
            // Groupe : actif si l'onglet courant est un de ses membres.
            const memberActive = isGroup
              ? t.subTabs.some((s) => s.id === active)
              : active === t.id;
            const activeSubId = isGroup
              ? memberActive
                ? active
                : undefined
              : active === t.id
                ? subValue
                : undefined;
            return (
              <TabDropdown
                key={t.id}
                tab={t}
                active={memberActive}
                activeSubId={activeSubId}
                onSelect={(subId) => {
                  if (isGroup) {
                    onChange(subId as ProjectTabId);
                  } else {
                    onChange(t.id);
                    onSubChange?.(t.id, subId);
                  }
                }}
              />
            );
          })()
        ) : (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium whitespace-nowrap transition-all",
              // arkyo-server: habillage Strata (topbar claire ou sombre selon le thème)
              active === t.id
                ? "bg-[var(--muted)] text-[var(--foreground)] font-semibold"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {t.label}
          </button>
        ),
      )}
    </div>
  );
}

function TabDropdown({
  tab,
  active,
  activeSubId,
  onSelect,
}: {
  tab: TabDescriptor;
  /** Le dropdown est-il l'onglet/groupe actif ? */
  active: boolean;
  /** Sous-onglet actif (id) — pour la pastille « · label » et la mise en avant. */
  activeSubId?: string;
  onSelect: (subId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeSub = activeSubId
    ? tab.subTabs?.find((s) => s.id === activeSubId)
    : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1 rounded-full py-1 pr-2 pl-3 text-[12px] font-medium whitespace-nowrap transition-all",
          // arkyo-server: habillage Strata (topbar claire ou sombre selon le thème)
          active
            ? "bg-[var(--muted)] text-[var(--foreground)] font-semibold"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        )}
      >
        {tab.label}
        {activeSub && (
          // arkyo-server: habillage Strata
          <span className="text-[var(--text-tertiary)]">· {activeSub.label}</span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1.5 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
        >
          {tab.subTabs!.map((s) => {
            const isActive = s.id === activeSubId;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  isActive
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 12 % : --accent-strong)
                    ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-semibold text-[var(--accent-strong)]"
                    : "text-[var(--foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
