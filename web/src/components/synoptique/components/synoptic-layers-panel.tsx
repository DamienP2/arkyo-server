"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronDown,
  Cable,
  Square,
  Type,
  Plug,
  Server,
  PanelsTopLeft,
  Search,
  X,
  Focus,
  PenLine,
  Trash2,
  ExternalLink,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import {
  useTopbarActions,
  type SynopticLayerItem,
  type SynopticLayerKind,
} from "@/components/editor-shell/topbar-actions-context";
import { FloatingContextMenu, type FloatingMenuItem } from "@/components/editor-shell/floating-context-menu";

const KIND_LABEL: Record<SynopticLayerKind, string> = {
  equipment: "Équipements",
  panel: "Panels",
  adapter: "Adaptateurs",
  cable: "Câbles",
  zone: "Zones",
  label: "Textes",
  external: "Connexions externes",
};

const KIND_ICON: Record<SynopticLayerKind, React.ComponentType<{ className?: string }>> = {
  equipment: Server,
  panel: PanelsTopLeft,
  adapter: Plug,
  cable: Cable,
  zone: Square,
  label: Type,
  external: ExternalLink,
};

const KIND_ORDER: SynopticLayerKind[] = ["equipment", "panel", "adapter", "cable", "zone", "label", "external"];

type Group = { id: string; name: string; color?: string | null; items: SynopticLayerItem[] };

function groupByMode(
  items: SynopticLayerItem[],
  mode: "type" | "category" | "signal",
  categoryColors: Record<string, string>,
): Group[] {
  if (mode === "type") {
    const by: Record<SynopticLayerKind, SynopticLayerItem[]> = {
      equipment: [],
      panel: [],
      adapter: [],
      cable: [],
      zone: [],
      label: [],
      external: [],
    };
    for (const it of items) by[it.kind].push(it);
    return KIND_ORDER.filter((k) => by[k].length > 0).map((k) => ({
      id: `kind-${k}`,
      name: KIND_LABEL[k],
      items: by[k],
    }));
  }
  if (mode === "category") {
    // Équipements groupés par catégorie métier (Caméra, Mélangeur, …) ;
    // câbles par catégorie signal ; panels / adaptateurs / zones / textes : groupe type.
    const groups: Group[] = [];
    // 1) Équipements par catégorie
    const equipMap = new Map<string, Group>();
    for (const it of items) {
      if (it.kind !== "equipment") continue;
      const cat = it.equipmentCategory || "Autres";
      const id = `eq-${cat}`;
      if (!equipMap.has(id))
        equipMap.set(id, { id, name: cat, color: categoryColors[cat], items: [] });
      equipMap.get(id)!.items.push(it);
    }
    const equipGroups = Array.from(equipMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    groups.push(...equipGroups);

    // 2) Panels (toujours ensemble)
    const panels = items.filter((i) => i.kind === "panel");
    if (panels.length > 0) groups.push({ id: "panels", name: KIND_LABEL.panel, items: panels });

    // 3) Adaptateurs
    const adapters = items.filter((i) => i.kind === "adapter");
    if (adapters.length > 0)
      groups.push({ id: "adapters", name: KIND_LABEL.adapter, items: adapters });

    // 4) Câbles par catégorie signal
    const cableCatMap = new Map<string, Group>();
    const cablesNoCat: SynopticLayerItem[] = [];
    for (const it of items) {
      if (it.kind !== "cable") continue;
      if (it.signalCategoryName) {
        const id = `sigcat-${it.signalCategoryName}`;
        if (!cableCatMap.has(id))
          cableCatMap.set(id, { id, name: it.signalCategoryName, items: [] });
        cableCatMap.get(id)!.items.push(it);
      } else {
        cablesNoCat.push(it);
      }
    }
    groups.push(...Array.from(cableCatMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
    if (cablesNoCat.length > 0)
      groups.push({ id: "cables-uncat", name: "Câbles sans catégorie", items: cablesNoCat });

    // 5) Zones / Textes
    const zones = items.filter((i) => i.kind === "zone");
    if (zones.length > 0) groups.push({ id: "zones", name: KIND_LABEL.zone, items: zones });
    const labels = items.filter((i) => i.kind === "label");
    if (labels.length > 0) groups.push({ id: "labels", name: KIND_LABEL.label, items: labels });
    // 6) Connexions externes
    const externals = items.filter((i) => i.kind === "external");
    if (externals.length > 0)
      groups.push({ id: "externals", name: KIND_LABEL.external, items: externals });
    return groups;
  }
  // signal : uniquement les câbles, groupés par signalName
  const sigMap = new Map<string, Group>();
  const cablesNoSig: SynopticLayerItem[] = [];
  for (const it of items) {
    if (it.kind !== "cable") continue;
    if (it.signalName) {
      const id = `sig-${it.signalName}`;
      if (!sigMap.has(id)) sigMap.set(id, { id, name: it.signalName, color: it.color, items: [] });
      sigMap.get(id)!.items.push(it);
    } else {
      cablesNoSig.push(it);
    }
  }
  const groups = Array.from(sigMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (cablesNoSig.length > 0)
    groups.push({ id: "sig-uncat", name: "Sans signal", items: cablesNoSig });
  return groups;
}

export function SynopticLayersPanel({
  categoryColors = {},
}: { categoryColors?: Record<string, string> } = {}) {
  const items = useTopbarActions((s) => s.synopticLayerItems);
  const mode = useTopbarActions((s) => s.layerGroupMode);
  const setMode = useTopbarActions((s) => s.setLayerGroupMode);
  const hidden = useTopbarActions((s) => s.hiddenLayerIds);
  const locked = useTopbarActions((s) => s.lockedLayerIds);
  const toggleHidden = useTopbarActions((s) => s.toggleLayerHidden);
  const toggleLocked = useTopbarActions((s) => s.toggleLayerLocked);
  const setManyHidden = useTopbarActions((s) => s.setManyLayersHidden);
  const setManyLocked = useTopbarActions((s) => s.setManyLayersLocked);
  const selectedIds = useTopbarActions((s) => s.selectedSynopticIds);
  const requestSelection = useTopbarActions((s) => s.requestLayerSelection);
  const multiSelectIds = useTopbarActions((s) => s.layerMultiSelectIds);
  const setMultiSelectIds = useTopbarActions((s) => s.setLayerMultiSelectIds);
  const onRenameLayerItem = useTopbarActions((s) => s.onRenameLayerItem);
  const onBulkDeleteLayerItems = useTopbarActions((s) => s.onBulkDeleteLayerItems);
  const bulkDelete = (its: SynopticLayerItem[]) => {
    onBulkDeleteLayerItems?.(its);
  };

  // Filtre rapide
  const [filter, setFilter] = useState("");
  const filterNorm = filter.trim().toLowerCase();

  // Ancre multi-sélection pour le shift-click (range)
  const lastAnchorRef = useRef<string | null>(null);

  // Rename inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.select();
  }, [editingId]);

  const groups = useMemo(() => {
    const raw = groupByMode(items, mode, categoryColors);
    if (!filterNorm) return raw;
    return raw
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.name.toLowerCase().includes(filterNorm)),
      }))
      .filter((g) => g.items.length > 0);
  }, [items, mode, categoryColors, filterNorm]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Ordre à plat pour le range-select shift-click
  const flatIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);

  const handleRowClick = (it: SynopticLayerItem, e: React.MouseEvent) => {
    const isAdditive = e.metaKey || e.ctrlKey;
    const isRange = e.shiftKey;
    if (isRange && lastAnchorRef.current) {
      const anchor = lastAnchorRef.current;
      const a = flatIds.indexOf(anchor);
      const b = flatIds.indexOf(it.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const range = flatIds.slice(lo, hi + 1);
        setMultiSelectIds(new Set(range));
      }
      return;
    }
    if (isAdditive) {
      const next = new Set(multiSelectIds);
      if (next.has(it.id)) next.delete(it.id);
      else next.add(it.id);
      setMultiSelectIds(next);
      lastAnchorRef.current = it.id;
      return;
    }
    // Clic simple : sélection canvas + reset multi à {id}
    setMultiSelectIds(new Set([it.id]));
    lastAnchorRef.current = it.id;
    requestSelection(it.id, it.kind);
  };

  // Menu contextuel (clic droit)
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; scope: "item"; item: SynopticLayerItem }
    | { x: number; y: number; scope: "group"; group: { name: string; items: SynopticLayerItem[] } }
    | null
  >(null);

  // Isoler : ne garder visible que `visibleIds`, masquer tout le reste des items du synoptique
  const isolate = (visibleIds: string[]) => {
    const visibleSet = new Set(visibleIds);
    const toHide = items.filter((i) => !visibleSet.has(i.id)).map((i) => i.id);
    const toShow = [...visibleIds];
    setManyHidden(toHide, true);
    setManyHidden(toShow, false);
  };

  const commitRename = (it: SynopticLayerItem) => {
    const v = editingValue.trim();
    if (v && v !== it.name) onRenameLayerItem?.(it.id, it.kind, v);
    setEditingId(null);
    setEditingValue("");
  };
  const cancelRename = () => {
    setEditingId(null);
    setEditingValue("");
  };

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-3 text-xs italic">
        Aucun élément dans le synoptique.
      </p>
    );
  }

  // Portée des actions globales = items actuellement affichés dans les groupes
  // (en mode "signal", seuls les câbles sont listés).
  const visibleItems = groups.flatMap((g) => g.items);
  const allIds = visibleItems.map((i) => i.id);
  const allHidden = visibleItems.length > 0 && visibleItems.every((i) => hidden.has(i.id));
  const allLocked = visibleItems.length > 0 && visibleItems.every((i) => locked.has(i.id));

  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* Filtre rapide */}
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Rechercher…"
          className="border-border bg-background h-7 w-full rounded-md border pr-6 pl-7 text-[11px] focus:border-[var(--accent)] focus:outline-none"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter("")}
            title="Effacer la recherche"
            aria-label="Effacer la recherche"
            className="hover:bg-muted text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Sélecteur de mode */}
      <div className="bg-muted grid grid-cols-3 gap-0.5 rounded-md p-0.5">
        {(["type", "category", "signal"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded px-2 py-1 text-[11px] transition-colors",
              mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "type" ? "Type" : m === "category" ? "Catégorie" : "Signal"}
          </button>
        ))}
      </div>

      {/* Actions globales */}
      <div className="flex items-center justify-between px-0.5">
        <div className="text-muted-foreground text-[10px]">
          {visibleItems.length} élément{visibleItems.length > 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setManyHidden(allIds, !allHidden)}
            className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            title={allHidden ? "Tout afficher" : "Tout masquer"}
          >
            {allHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setManyLocked(allIds, !allLocked)}
            className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            title={allLocked ? "Tout déverrouiller" : "Tout verrouiller"}
          >
            {allLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Liste des groupes */}
      <div className="flex flex-col gap-1">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.id);
          const groupIds = g.items.map((i) => i.id);
          const groupHidden = g.items.every((i) => hidden.has(i.id));
          const groupLocked = g.items.every((i) => locked.has(i.id));
          return (
            <div key={g.id}>
              {/* Header groupe */}
              <div
                className="hover:bg-muted/50 flex items-center gap-1 rounded-md px-1 py-1 transition-colors"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    scope: "group",
                    group: { name: g.name, items: g.items },
                  });
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    })
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")}
                  />
                </button>
                {g.color && (
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ background: g.color }}
                  />
                )}
                <div className="text-foreground flex-1 truncate text-[11px] font-semibold">
                  {g.name}
                </div>
                <span
                  className="text-muted-foreground text-[10px]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {g.items.length}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManyHidden(groupIds, !groupHidden);
                  }}
                  className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
                  title={groupHidden ? "Afficher le groupe" : "Masquer le groupe"}
                >
                  {groupHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManyLocked(groupIds, !groupLocked);
                  }}
                  className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
                  title={groupLocked ? "Déverrouiller le groupe" : "Verrouiller le groupe"}
                >
                  {groupLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
              </div>

              {/* Items */}
              {!isCollapsed && (
                <div className="flex flex-col">
                  {g.items.map((it) => {
                    const Icon = KIND_ICON[it.kind];
                    const isHidden = hidden.has(it.id);
                    const isLocked = locked.has(it.id);
                    const isSelected = selectedIds.has(it.id) || multiSelectIds.has(it.id);
                    const isRenamable = it.kind === "zone" || it.kind === "label";
                    const isEditing = editingId === it.id;
                    return (
                      <div
                        key={it.id}
                        onClick={(e) => {
                          if (!isEditing) handleRowClick(it, e);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, scope: "item", item: it });
                        }}
                        onDoubleClick={(e) => {
                          if (!isRenamable) return;
                          e.stopPropagation();
                          setEditingId(it.id);
                          setEditingValue(it.name);
                        }}
                        className={cn(
                          "group flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 pl-5 transition-colors",
                          isHidden && "opacity-40",
                          isSelected
                            ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ring-1 ring-[var(--accent)]/40 ring-inset"
                            : "hover:bg-muted/50",
                          // arkyo-server: habillage Strata (verrouillé : --warning)
                          isLocked && !isSelected && "bg-[var(--warning)]/5",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-3 w-3 flex-shrink-0",
                            isSelected ? "text-[var(--accent)]" : "text-muted-foreground",
                          )}
                        />
                        {(() => {
                          const col =
                            it.color ??
                            (it.kind === "equipment" && it.equipmentCategory
                              ? categoryColors[it.equipmentCategory]
                              : null) ??
                            null;
                          return col ? (
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full ring-1 ring-black/10"
                              style={{ background: col }}
                            />
                          ) : null;
                        })()}
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitRename(it)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRename(it);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-background h-5 flex-1 rounded border border-[var(--accent)] px-1 text-[11px] focus:outline-none"
                          />
                        ) : (
                          <div
                            className={cn(
                              "flex-1 truncate text-[11px]",
                              isSelected && "text-foreground font-semibold",
                            )}
                            title={isRenamable ? "Double-clic pour renommer" : it.name}
                          >
                            {it.name}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHidden(it.id);
                          }}
                          className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
                          title={isHidden ? "Afficher" : "Masquer"}
                        >
                          {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        {it.kind !== "cable" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLocked(it.id);
                            }}
                            // arkyo-server: habillage Strata (verrouillé : --warning, icône en --warning-text)
                            className={cn(
                              "rounded p-0.5 transition-colors",
                              isLocked
                                ? "bg-[var(--warning)]/20 text-[var(--warning-text)] hover:bg-[var(--warning)]/30"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                            title={isLocked ? "Déverrouiller" : "Verrouiller"}
                          >
                            {isLocked ? (
                              <Lock className="h-3 w-3" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {contextMenu &&
        (() => {
          const close = () => setContextMenu(null);
          const menuItems: FloatingMenuItem[] = [];
          if (contextMenu.scope === "item") {
            const it = contextMenu.item;
            const isHidden = hidden.has(it.id);
            const isLocked = locked.has(it.id);
            const hasMulti = multiSelectIds.size > 1 && multiSelectIds.has(it.id);
            menuItems.push({
              id: "isolate",
              label: hasMulti ? `Isoler la sélection (${multiSelectIds.size})` : "Isoler ce calque",
              icon: <Focus className="h-3.5 w-3.5" />,
              onSelect: () => {
                isolate(hasMulti ? [...multiSelectIds] : [it.id]);
                close();
              },
              separatorAfter: true,
            });
            if (hasMulti) {
              // Actions groupées sur multi-sélection
              const selIds = [...multiSelectIds];
              const selItems = items.filter((i) => multiSelectIds.has(i.id));
              const lockableIds = selItems.filter((i) => i.kind !== "cable").map((i) => i.id);
              const allHidden = selItems.every((i) => hidden.has(i.id));
              const allLocked = lockableIds.length > 0 && lockableIds.every((id) => locked.has(id));
              const deletableItems = selItems.filter(
                (i) => i.kind !== "equipment" && i.kind !== "panel",
              );
              menuItems.push({
                id: "multi-vis",
                label: allHidden ? `Afficher (${selIds.length})` : `Masquer (${selIds.length})`,
                icon: allHidden ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                ),
                onSelect: () => {
                  setManyHidden(selIds, !allHidden);
                  close();
                },
              });
              if (lockableIds.length > 0) {
                menuItems.push({
                  id: "multi-lock",
                  label: allLocked
                    ? `Déverrouiller (${lockableIds.length})`
                    : `Verrouiller (${lockableIds.length})`,
                  icon: allLocked ? (
                    <Unlock className="h-3.5 w-3.5" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  ),
                  onSelect: () => {
                    setManyLocked(lockableIds, !allLocked);
                    close();
                  },
                });
              }
              if (deletableItems.length > 0) {
                menuItems.push({
                  id: "multi-del",
                  label: `Supprimer (${deletableItems.length})`,
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  danger: true,
                  onSelect: () => {
                    if (
                      !window.confirm(
                        `Supprimer ${deletableItems.length} élément${deletableItems.length > 1 ? "s" : ""} ?`,
                      )
                    ) {
                      close();
                      return;
                    }
                    bulkDelete(deletableItems);
                    close();
                  },
                });
              }
            } else {
              menuItems.push({
                id: "vis",
                label: isHidden ? "Afficher" : "Masquer",
                icon: isHidden ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                ),
                onSelect: () => {
                  toggleHidden(it.id);
                  close();
                },
              });
              if (it.kind !== "cable") {
                menuItems.push({
                  id: "lock",
                  label: isLocked ? "Déverrouiller" : "Verrouiller",
                  icon: isLocked ? (
                    <Unlock className="h-3.5 w-3.5" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  ),
                  onSelect: () => {
                    toggleLocked(it.id);
                    close();
                  },
                  separatorAfter: it.kind === "zone" || it.kind === "label",
                });
              }
              if (it.kind === "zone" || it.kind === "label") {
                menuItems.push({
                  id: "rename",
                  label: "Renommer…",
                  icon: <PenLine className="h-3.5 w-3.5" />,
                  onSelect: () => {
                    setEditingId(it.id);
                    setEditingValue(it.name);
                    close();
                  },
                });
              }
            }
          } else {
            const g = contextMenu.group;
            const groupIds = g.items.map((i) => i.id);
            const allHidden = g.items.every((i) => hidden.has(i.id));
            const allLocked = g.items.every((i) => locked.has(i.id));
            menuItems.push({
              id: "isolate-group",
              label: `Isoler ce groupe (${g.items.length})`,
              icon: <Focus className="h-3.5 w-3.5" />,
              onSelect: () => {
                isolate(groupIds);
                close();
              },
              separatorAfter: true,
            });
            menuItems.push({
              id: "vis-group",
              label: allHidden ? "Afficher le groupe" : "Masquer le groupe",
              icon: allHidden ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              ),
              onSelect: () => {
                setManyHidden(groupIds, !allHidden);
                close();
              },
            });
            // Filtre les câbles (non verrouillables) pour le bouton lock groupe
            const lockableIds = g.items.filter((i) => i.kind !== "cable").map((i) => i.id);
            if (lockableIds.length > 0) {
              menuItems.push({
                id: "lock-group",
                label: allLocked ? "Déverrouiller le groupe" : "Verrouiller le groupe",
                icon: allLocked ? (
                  <Unlock className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                ),
                onSelect: () => {
                  setManyLocked(lockableIds, !allLocked);
                  close();
                },
              });
            }
          }
          return (
            <FloatingContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={menuItems}
              onClose={close}
            />
          );
        })()}
    </div>
  );
}
