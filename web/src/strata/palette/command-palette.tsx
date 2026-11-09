"use client";

/**
 * Palette ⌘K de l'interface Strata v2 (spec v2 §4.4, lot 1) : projets, fiches
 * du catalogue, utilisateurs et actions. Ouverte par ⌘K / Ctrl+K, par `/`
 * (hors champ de saisie) ou par l'évènement `STRATA_PALETTE_EVENT` (bouton de
 * la topbar). Les données ne sont lues qu'à l'ouverture, depuis des routes
 * existantes. Dialogue modal : combobox + listbox, focus piégé dans le champ,
 * Échap ferme et rend le focus.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Box, FolderOpen, Plus, Search, Settings, Users } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { navFilter, STRATA_NAV } from "@/strata/shell/nav-model";
import { STRATA_PALETTE_EVENT } from "@/strata/shell/topbar-v2";
import {
  lazyOnce,
  matches,
  paletteSources,
  registerPaletteSource,
  type PaletteItem,
} from "./palette-sources";

type ProjectRow = { id: string; name: string; clientName?: string | null };
type EquipmentRow = { id: string; name: string; reference?: string | null; brand?: { name: string } | null };
type MemberRow = { id: string; email: string; name: string | null };

const ICON = "h-4 w-4";
const PER_GROUP = 8;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function CommandPalette() {
  const router = useRouter();
  const perms = useTenantPermissionsOptional();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const token = useRef(0);
  const baseId = useId();
  const canSee = navFilter(perms?.has);

  const nav = useRef({ push: router.push, canSee });
  nav.current = { push: router.push, canSee };
  const caches = useMemo(
    () => ({
      projects: lazyOnce(async () => {
        const r = await api.get<{ projects: ProjectRow[] }>("/api/tenant/projects");
        setProjectRows(r.projects);
        return r.projects;
      }),
      equipment: lazyOnce(async () => {
        const r = await api.get<{ arkyo?: EquipmentRow[]; personal?: EquipmentRow[] }>(
          "/api/tenant/catalogue/equipment?scope=all",
        );
        return [...(r.arkyo ?? []), ...(r.personal ?? [])];
      }),
      members: lazyOnce(() => api.get<MemberRow[]>("/api/tenant/members")),
    }),
    [],
  );

  // Sources du lot 1.
  useEffect(() => {
    const go = (href: string) => () => nav.current.push(href);
    const offs = [
      registerPaletteSource("projects", async () =>
        (await caches.projects.get()).map((p) => ({
          group: "Projets",
          label: p.name,
          sub: p.clientName || undefined,
          icon: <FolderOpen className={ICON} />,
          run: go(`/project/${p.id}`),
        })),
      ),
      registerPaletteSource("catalogue", async () =>
        (await caches.equipment.get()).map((e) => ({
          group: "Catalogue",
          label: e.name,
          sub: [e.brand?.name, e.reference].filter(Boolean).join(" · ") || undefined,
          icon: <Box className={ICON} />,
          run: go(`/admin/catalogue/equipment/${e.id}`),
        })),
      ),
      registerPaletteSource("members", async () =>
        (await caches.members.get()).map((m) => ({
          group: "Utilisateurs",
          label: m.name || m.email,
          sub: m.name ? m.email : undefined,
          icon: <Users className={ICON} />,
          run: go("/admin/users"),
        })),
      ),
      registerPaletteSource("actions", () => {
        const out: PaletteItem[] = [
          {
            group: "Actions",
            label: "Nouveau projet",
            icon: <Plus className={ICON} />,
            run: () => setNewOpen(true),
          },
        ];
        for (const section of STRATA_NAV) {
          if (section.id === "administration") {
            const first = section.items.filter(nav.current.canSee)[0];
            if (first)
              out.push({
                group: "Actions",
                label: "Aller à Administration",
                icon: <Settings className={ICON} />,
                run: go(first.href),
              });
          } else if (section.id === "catalogue") {
            const cat = section.items.find((i) => i.href === "/admin/catalogue" && nav.current.canSee(i));
            if (cat)
              out.push({
                group: "Actions",
                label: "Aller à Catalogue",
                icon: <Box className={ICON} />,
                run: go(cat.href),
              });
          }
        }
        return out;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [caches]);

  const close = useCallback(() => {
    setOpen(false);
    token.current++;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) setTimeout(() => el.focus(), 0);
  }, []);

  const show = useCallback(() => {
    if (!open) returnTo.current = document.activeElement as HTMLElement | null;
    caches.projects.reset();
    caches.equipment.reset();
    caches.members.reset();
    setQ("");
    setActive(0);
    setOpen(true);
  }, [open, caches]);

  // Ouverture : évènement de la topbar et raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !open && !isTyping(e.target)) {
        e.preventDefault();
        show();
      }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener(STRATA_PALETTE_EVENT, show);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(STRATA_PALETTE_EVENT, show);
    };
  }, [open, show, close]);

  // Lecture des sources (à l'ouverture, puis à chaque frappe ; les lectures réseau sont mises en cache).
  useEffect(() => {
    if (!open) return;
    const mine = ++token.current;
    setLoading(true);
    void Promise.allSettled(paletteSources().map((s) => Promise.resolve().then(() => s(q)))).then((res) => {
      if (mine !== token.current) return;
      const all: PaletteItem[] = [];
      for (const r of res) if (r.status === "fulfilled") all.push(...r.value);
      setItems(all);
      setLoading(false);
    });
  }, [open, q]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const shown = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PaletteItem[]>();
    for (const it of items) {
      if (!matches(it, q)) continue;
      if (!byGroup.has(it.group)) {
        byGroup.set(it.group, []);
        order.push(it.group);
      }
      const arr = byGroup.get(it.group)!;
      if (arr.length < PER_GROUP) arr.push(it);
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [items, q]);
  const flat = useMemo(() => shown.flatMap((g) => g.items), [shown]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  const optId = (i: number) => `${baseId}-opt-${i}`;

  const choose = (it: PaletteItem | undefined) => {
    if (!it) return;
    close();
    it.run();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus piégé : le champ est le seul contrôle
    }
  };

  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, flat]);

  const knownClients = useMemo(
    () =>
      Array.from(new Set(projectRows.map((p) => p.clientName?.trim()).filter((c): c is string => !!c))).sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [projectRows],
  );
  const existingNames = useMemo(() => projectRows.map((p) => p.name).filter(Boolean), [projectRows]);

  let idx = -1;
  return (
    <>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-start justify-center bg-black/50 px-4 pt-[9vh]"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Palette de commandes"
              className="flex max-h-[74vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--popover)] shadow-2xl"
            >
              <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5">
                <Search className="h-[18px] w-[18px] shrink-0 text-[var(--text-tertiary)]" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKey}
                  placeholder="Rechercher un objet ou une action"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-label="Rechercher un objet ou une action"
                  aria-expanded="true"
                  aria-controls={`${baseId}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={flat.length ? optId(active) : undefined}
                  className="h-[50px] flex-1 bg-transparent text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
                <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-sans text-[10.5px] text-[var(--muted-foreground)]">
                  Échap
                </kbd>
              </div>
              <div id={`${baseId}-list`} role="listbox" aria-label="Résultats" className="overflow-auto p-1.5">
                {loading && flat.length === 0 ? (
                  <LoadingState label="Recherche…" className="py-8" />
                ) : flat.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[13px] text-[var(--muted-foreground)]">Aucun résultat</p>
                ) : (
                  shown.map((g) => (
                    <div key={g.group} role="group" aria-label={g.group}>
                      <div
                        aria-hidden
                        className="px-2.5 pt-2.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase"
                      >
                        {g.group}
                      </div>
                      {g.items.map((it) => {
                        const i = ++idx;
                        const on = i === active;
                        return (
                          <div
                            key={`${g.group}-${i}`}
                            id={optId(i)}
                            role="option"
                            aria-selected={on}
                            onMouseMove={() => setActive(i)}
                            onClick={() => choose(it)}
                            className={cn(
                              "grid min-h-[38px] cursor-pointer grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 rounded-[7px] px-2.5 py-1.5",
                              on ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--muted)]",
                            )}
                          >
                            <span
                              className={cn(
                                "grid place-items-center",
                                on ? "text-[var(--accent-strong)]" : "text-[var(--text-tertiary)]",
                              )}
                            >
                              {it.icon}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <b className="truncate text-[13.5px] font-medium text-[var(--foreground)]">{it.label}</b>
                              {it.sub && (
                                <small className="truncate text-[11.5px] text-[var(--text-tertiary)]">{it.sub}</small>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-3.5 border-t border-[var(--border)] bg-[var(--muted)] px-3.5 py-2 text-[11.5px] text-[var(--text-tertiary)]">
                <span>↑ ↓ parcourir</span>
                <span>Entrée ouvrir</span>
                <span>Échap fermer</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {newOpen && (
        <NewProjectDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          interventionType="PRESTATION"
          knownClients={knownClients}
          existingNames={existingNames}
        />
      )}
    </>
  );
}
