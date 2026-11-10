"use client";

/**
 * Palette ⌘K de l'interface Strata v2 (spec v2 §4.4) : projets, fiches du
 * catalogue (cordons et adaptateurs compris), utilisateurs et actions ; dans
 * un projet, son matériel, ses câbles et ses actions (`project-sources.tsx`),
 * en tête. Ouverte par ⌘K / Ctrl+K, par `/` (hors champ de saisie) ou par
 * l'évènement `STRATA_PALETTE_EVENT` (bouton des topbars). Les données ne
 * sont lues qu'à l'ouverture, depuis des routes existantes, et seulement
 * quand la page correspondante est permise (catalogue : `catalog:admin` ;
 * utilisateurs : `members:admin`, comme leurs pages).
 *
 * Dialogue modal : combobox + listbox, focus piégé dans le champ ; Échap
 * (un seul gestionnaire, en capture) ferme ; à la fermeture, le focus revient
 * à l'élément qui l'avait avant l'ouverture, avant que l'action ne s'exécute.
 * Les navigations passent par la garde des saisies non enregistrées
 * (`useUnsavedChanges`), comme celles de Gérer.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, FolderOpen, Plus, Search, Settings, Users } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { navFilter, STRATA_NAV, type StrataNavItem } from "@/strata/shell/nav-model";
import { STRATA_PALETTE_EVENT } from "./palette-event";
import {
  lazyOnce,
  matches,
  paletteSources,
  registerPaletteSource,
  type Lazy,
  type PaletteItem,
} from "./palette-sources";
import { projectIdOf, useGuardedRun } from "@/strata/shell/tab-nav";
import { projectLoaders, registerProjectSources, type ProjectPaletteNav } from "./project-sources";

type ProjectRow = { id: string; name: string; clientName?: string | null };
type CatalogueRow = { id: string; name: string; reference?: string | null; brand?: { name: string } | null };
type CatalogueKind = "equipment" | "cables" | "adapters";

const CATALOGUE_KINDS: { kind: CatalogueKind; label: string | null }[] = [
  { kind: "equipment", label: null },
  { kind: "cables", label: "Cordon" },
  { kind: "adapters", label: "Adaptateur" },
];

/** Entrée de la navigation Strata (même permission que la page). */
const navItem = (href: string): StrataNavItem | undefined =>
  STRATA_NAV.flatMap((s) => s.items).find((i) => i.href === href);
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const guarded = useGuardedRun();
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
  const projectId = projectIdOf(pathname);

  /**
   * Navigation des actions, par la garde des saisies non enregistrées (comme
   * `useGuardedRouter`) ; `before` ne s'exécute qu'une fois la garde passée.
   */
  const navigate = (href: string, opts: { replace?: boolean; before?: () => void } = {}) =>
    guarded(() => {
      opts.before?.();
      if (opts.replace) router.replace(href, { scroll: false });
      else router.push(href);
    });
  const nav = useRef({ navigate, canSee, searchParams });
  nav.current = { navigate, canSee, searchParams };

  const caches = useMemo(
    () => ({
      projects: lazyOnce(async () => {
        const r = await api.get<{ projects: ProjectRow[] }>("/api/tenant/projects");
        setProjectRows(r.projects);
        return r.projects;
      }),
      catalogue: Object.fromEntries(
        CATALOGUE_KINDS.map(({ kind }) => [
          kind,
          lazyOnce(async () => {
            const r = await api.get<{ arkyo?: CatalogueRow[]; personal?: CatalogueRow[] }>(
              `/api/tenant/catalogue/${kind}?scope=all`,
            );
            return [...(r.arkyo ?? []), ...(r.personal ?? [])];
          }),
        ]),
      ) as Record<CatalogueKind, Lazy<CatalogueRow[]>>,
      members: lazyOnce(() => api.get<MemberRow[]>("/api/tenant/members")),
    }),
    [],
  );
  const project = useMemo(() => (projectId ? projectLoaders(projectId) : null), [projectId]);

  // Sources : celles du projet ouvert en tête, puis celles du site.
  useEffect(() => {
    const go = (href: string) => () => nav.current.navigate(href);
    const allowed = (href: string) => {
      const item = navItem(href);
      return !!item && nav.current.canSee(item);
    };
    const projectNav = (): ProjectPaletteNav => ({
      go: (href, opts) => nav.current.navigate(href, opts),
      search: () => nav.current.searchParams,
    });
    const offs = [
      ...(project && projectId ? [registerProjectSources(projectId, project, projectNav)] : []),
      registerPaletteSource("projects", async () =>
        (await caches.projects.get()).map((p) => ({
          group: "Projets",
          label: p.name,
          sub: p.clientName || undefined,
          icon: <FolderOpen className={ICON} />,
          run: go(`/project/${p.id}`),
        })),
      ),
      // Fiches du catalogue : la page est réservée à `catalog:admin` (rien n'est lu sans).
      registerPaletteSource("catalogue", async () => {
        if (!allowed("/admin/catalogue")) return [];
        const lists = await Promise.allSettled(CATALOGUE_KINDS.map(({ kind }) => caches.catalogue[kind].get()));
        return CATALOGUE_KINDS.flatMap(({ kind, label }, i) => {
          const res = lists[i];
          if (res.status !== "fulfilled") return [];
          return res.value.map<PaletteItem>((e) => ({
            group: "Catalogue",
            label: e.name,
            sub: [label, e.brand?.name, e.reference].filter(Boolean).join(" · ") || undefined,
            icon: <Box className={ICON} />,
            run: go(`/admin/catalogue?tab=${kind}&id=${encodeURIComponent(e.id)}`),
            secondary: { label: "Modifier", run: go(`/admin/catalogue/${kind}/${encodeURIComponent(e.id)}`) },
          }));
        });
      }),
      // Utilisateurs : comme la page d'administration (`members:admin`).
      registerPaletteSource("members", async () => {
        if (!allowed("/admin/users")) return [];
        return (await caches.members.get()).map((m) => ({
          group: "Utilisateurs",
          label: m.name || m.email,
          sub: m.name ? m.email : undefined,
          icon: <Users className={ICON} />,
          run: go("/admin/users"),
        }));
      }),
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
  }, [caches, project, projectId]);

  /** Ferme ; le focus revient tout de suite à l'élément qui l'avait (avant toute action). */
  const close = useCallback(() => {
    setOpen(false);
    token.current++;
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected && el !== document.body) el.focus();
  }, []);

  const show = useCallback(() => {
    if (!open) returnTo.current = document.activeElement as HTMLElement | null;
    caches.projects.reset();
    for (const c of Object.values(caches.catalogue)) c.reset();
    caches.members.reset();
    project?.reset();
    setQ("");
    setActive(0);
    setOpen(true);
  }, [open, caches, project]);

  // Ouverture : évènement de la topbar et raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
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

  // Échap : un seul gestionnaire, en capture, avant le tiroir et les autres
  // couches de la page (qui voient la touche déjà traitée).
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [open, close]);

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

  const choose = (it: PaletteItem | undefined, secondary = false) => {
    if (!it) return;
    close();
    if (secondary && it.secondary) it.secondary.run();
    else it.run();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[active], e.metaKey || e.ctrlKey);
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
                              "group grid min-h-[38px] cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-1.5",
                              it.secondary ? "grid-cols-[22px_minmax(0,1fr)_auto]" : "grid-cols-[22px_minmax(0,1fr)]",
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
                            {it.secondary && (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={`${it.secondary.label} ${it.label}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  choose(it, true);
                                }}
                                className={cn(
                                  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--muted-foreground)] transition-opacity hover:border-[var(--border-strong)] hover:text-[var(--foreground)]",
                                  on ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                )}
                              >
                                {it.secondary.label}
                              </button>
                            )}
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
                {flat[active]?.secondary && <span>{`⌘Entrée ${flat[active].secondary.label.toLocaleLowerCase("fr-FR")}`}</span>}
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
