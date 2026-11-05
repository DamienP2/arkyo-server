"use client";

/**
 * NotificationsTab (tenant) — historique complet des notifications.
 *
 * Calquée sur `app/supervisor/profile/_components/notifications-tab.tsx`,
 * adaptée au contexte tenant :
 *  - les hrefs sont résolus par `getTenantNotificationHref(n)` (routes /support,
 *    /admin/espace, etc.) — pas de routes /supervisor/*
 *  - sinon l'UI (liste + détail, multi-sélection, recherche, tri, filtres
 *    Toutes/Non lues/Lues, pagination) est strictement identique
 *
 * Backend : réutilise `/api/notifications` (partagé — filtre déjà par
 * `recipientId = session.user.id`). Aucun nouveau endpoint nécessaire.
 *
 * Note : il n'existe pas de table `NotificationPreference` côté schéma —
 * cet onglet liste donc les notifications reçues, pas un panneau de préférences.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  Eye,
  Loader2,
  Search,
  Trash2,
  X,
} from "@/components/ui/icons";

import { api } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ─────────────────────────────────────────────────────────────────

export type Notif = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type ReadFilter = "all" | "unread" | "read";

const READ_FILTERS: { id: ReadFilter; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "unread", label: "Non lues" },
  { id: "read", label: "Lues" },
];

const PAGE_SIZE = 100;

// ── Routes tenant pour les notifications les plus courantes ──────────────

/**
 * Calcule la cible de navigation tenant d'une notification.
 * Les types non listés renvoient `null` (clic = simple mark-as-read).
 */
export function getTenantNotificationHref(n: Notif): string | null {
  // arkyo-server: les notifications SaaS (propositions au catalogue Arkyo,
  // support, roadmap, plan et crédits, mises à jour du catalogue Arkyo) et
  // leurs routes (/support, /settings/catalog-updates…) sont retirées : aucune
  // notification locale n'a de cible, le clic marque comme lu.
  switch (n.type) {
    default:
      return null;
  }
}

// ── Composant ─────────────────────────────────────────────────────────────

export function NotificationsTab() {
  const router = useRouter();
  const confirm = useConfirm();

  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");

  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await api.get<{
        items: Notif[];
        count: number;
        total: number;
        page: number;
        pages: number;
      }>(`/api/notifications?limit=${PAGE_SIZE}&page=${p}`);
      setItems(r.items ?? []);
      setUnread(r.count ?? 0);
      setTotal(r.total ?? 0);
      setPages(Math.max(1, r.pages ?? 1));
      setPage(r.page ?? 1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  // ── Filtrage / recherche / tri ────────────────────────────────────────
  const filtered = useMemo(() => {
    let list: Notif[] = [...items];

    if (readFilter === "unread") list = list.filter((n) => !n.readAt);
    else if (readFilter === "read") list = list.filter((n) => !!n.readAt);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) => {
        const haystack = [n.title, n.message ?? "", n.type].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    return [...list].sort((a, b) =>
      sortDir === "desc"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
  }, [items, readFilter, search, sortDir]);

  // Auto-sélection de la première notif si rien n'est sélectionné.
  useEffect(() => {
    if (selectedId && filtered.some((n) => n.id === selectedId)) return;
    if (filtered.length > 0) setSelectedId(filtered[0].id);
    else setSelectedId(null);
  }, [filtered, selectedId]);

  const selectedItem = useMemo(
    () => items.find((n) => n.id === selectedId) ?? null,
    [items, selectedId],
  );

  // Groupage par jour pour la liste.
  const byDay = useMemo(() => {
    const acc: Record<string, Notif[]> = {};
    for (const n of filtered) {
      const day = n.createdAt.slice(0, 10);
      (acc[day] ??= []).push(n);
    }
    return acc;
  }, [filtered]);
  const days = useMemo(
    () =>
      Object.keys(byDay).sort((a, b) => (sortDir === "desc" ? (a < b ? 1 : -1) : a < b ? -1 : 1)),
    [byDay, sortDir],
  );

  // ── Actions unitaires ─────────────────────────────────────────────────
  const markOneRead = async (n: Notif) => {
    if (n.readAt) return;
    try {
      await api.patch(`/api/notifications/${n.id}`, {});
      const stamp = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: stamp } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      /* silencieux */
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch("/api/notifications", { action: "read-all" });
      const stamp = new Date().toISOString();
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? stamp })));
      setUnread(0);
    } catch {
      /* silencieux */
    }
  };

  const deleteOne = async (n: Notif) => {
    const ok = await confirm({
      title: "Supprimer cette notification ?",
      description: "Action irréversible.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/notifications/${n.id}`);
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      setSelectedIds((prev) => {
        if (!prev.has(n.id)) return prev;
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
      if (!n.readAt) setUnread((u) => Math.max(0, u - 1));
      setTotal((t) => Math.max(0, t - 1));
      if (selectedId === n.id) setSelectedId(null);
    } catch {
      /* silencieux */
    }
  };

  const openTarget = (n: Notif) => {
    void markOneRead(n);
    const href = getTenantNotificationHref(n);
    if (href) router.push(href);
  };

  // ── Sélection multiple ────────────────────────────────────────────────
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((n) => selectedIds.has(n.id));

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const n of filtered) next.delete(n.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const n of filtered) next.add(n.id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ok = await confirm({
      title: `Supprimer ${count} notification${count > 1 ? "s" : ""} ?`,
      description: "Action irréversible.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const targets = items.filter((n) => selectedIds.has(n.id));
      const unreadDeleted = targets.filter((n) => !n.readAt).length;
      await Promise.allSettled(ids.map((id) => api.delete(`/api/notifications/${id}`)));
      setItems((prev) => prev.filter((n) => !selectedIds.has(n.id)));
      setUnread((u) => Math.max(0, u - unreadDeleted));
      setTotal((t) => Math.max(0, t - ids.length));
      if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
      setSelectedIds(new Set());
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="grid h-[calc(100vh-18rem)] grid-cols-1 gap-6 lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.4fr)]">
      {/* ── Colonne gauche ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
        {/* Toolbar inline : search + chips filtres + tri + count */}
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une notification…"
              className="flex h-8 w-full rounded-lg bg-transparent px-3 pl-8 text-sm focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--border)]"
              >
                <X className="h-3 w-3 text-[var(--muted-foreground)]" />
              </button>
            )}
          </div>

          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />

          <div className="flex shrink-0 items-center gap-1">
            {READ_FILTERS.map((f) => {
              const active = readFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setReadFilter(f.id)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-lg px-2.5 text-[11px] font-medium transition-all",
                    active
                      ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />

          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)]"
            title={sortDir === "desc" ? "Plus récents d'abord" : "Plus anciens d'abord"}
          >
            {sortDir === "desc" ? (
              <ArrowDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>

          <span className="ml-auto inline-flex h-7 shrink-0 items-center rounded-lg bg-[var(--card)] px-2.5 text-[11px] font-semibold text-[var(--foreground)] tabular-nums shadow-sm">
            {filtered.length}
          </span>
        </div>

        {/* Action bar : multi-sélection / marquer tout lu */}
        {selectedIds.size > 0 ? (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] px-3 py-2 shadow-sm">
            <div className="flex min-w-0 items-center gap-2">
              {/* arkyo-server: habillage Strata */}
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-foreground)] tabular-nums">
                {selectedIds.size}
              </span>
              <span className="truncate text-xs font-medium">
                notification{selectedIds.size > 1 ? "s" : ""} sélectionnée
                {selectedIds.size > 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkDeleting}
                className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)] disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                disabled={bulkDeleting}
                // arkyo-server: habillage Strata
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-2.5 text-[11px] font-semibold text-[var(--danger-text)] transition-colors hover:bg-[var(--danger)]/20 disabled:opacity-50"
              >
                {bulkDeleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Supprimer la sélection
              </button>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-2 px-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
                disabled={filtered.length === 0}
                className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              <span>{allFilteredSelected ? `Tout désélectionner` : `Tout sélectionner`}</span>
              <span className="tabular-nums opacity-60">({total} au total)</span>
            </label>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
              >
                <CheckCheck className="h-3 w-3" />
                Tout marquer lu
              </button>
            )}
          </div>
        )}

        {/* Liste */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)]/60 bg-[var(--card)]">
          {loading && items.length === 0 ? (
            <LoadingState className="py-16" />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--secondary)]">
                <Bell className="h-6 w-6 text-[var(--muted-foreground)]" />
              </div>
              <p className="text-sm font-medium">Aucune notification</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {readFilter === "unread"
                  ? "Toutes vos notifications sont lues."
                  : readFilter === "read"
                    ? "Aucune notification lue."
                    : search.trim()
                      ? "Aucun résultat pour cette recherche."
                      : "Vous n'avez encore rien reçu."}
              </p>
            </div>
          ) : (
            days.map((day) => (
              <div key={day}>
                <div className="sticky top-0 z-10 border-b border-[var(--border)]/60 bg-[var(--background)]/95 px-3 py-2 backdrop-blur">
                  <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                    {formatDayLabel(day)}
                  </p>
                </div>
                <div className="divide-y divide-[var(--border)]/40">
                  {byDay[day].map((n) => (
                    <NotificationRow
                      key={n.id}
                      notif={n}
                      selected={selectedId === n.id}
                      checked={selectedIds.has(n.id)}
                      onSelect={() => setSelectedId(n.id)}
                      onToggleCheck={() => toggleOne(n.id)}
                      onOpenTarget={() => openTarget(n)}
                      onDelete={() => void deleteOne(n)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}

          <div ref={sentinelRef} className="py-4 text-center">
            {loading && items.length > 0 && (
              <Loader2 className="inline-block h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
            )}
          </div>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void load(Math.max(1, page - 1))}
              disabled={page === 1 || loading}
              className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)] disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
              Page {page} / {pages}
            </span>
            <button
              type="button"
              onClick={() => void load(Math.min(pages, page + 1))}
              disabled={page === pages || loading}
              className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)] disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        )}
      </div>

      {/* ── Colonne droite : détail ────────────────────────────────────── */}
      <div className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border)]/60 bg-[var(--card)]">
        {selectedItem ? (
          <NotificationDetails
            notif={selectedItem}
            onMarkRead={() => void markOneRead(selectedItem)}
            onOpenTarget={() => openTarget(selectedItem)}
            onDelete={() => void deleteOne(selectedItem)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-[var(--muted-foreground)]">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary)]">
              <Bell className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Sélectionnez une notification</p>
            <p className="mt-1 text-[11px] opacity-80">Le détail apparaîtra ici.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sous-composants ─────────────────────────────────────────────────────

function NotificationRow({
  notif,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  onOpenTarget,
  onDelete,
}: {
  notif: Notif;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onOpenTarget: () => void;
  onDelete: () => void;
}) {
  const isUnread = !notif.readAt;
  const hasHref = getTenantNotificationHref(notif) !== null;

  const borderCls = selected
    ? "border-l-2 border-l-[var(--accent)]"
    : isUnread
      ? "border-l-2 border-l-[var(--accent)]/40"
      : "border-l-2 border-l-transparent";

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors",
        borderCls,
        selected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--secondary)]/40",
      )}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--accent)]"
        aria-label="Sélectionner cette notification"
      />

      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          isUnread ? "bg-[var(--accent)]" : "bg-transparent",
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-xs leading-tight",
              isUnread ? "font-semibold text-[var(--foreground)]" : "text-[var(--foreground)]",
              selected && "text-[var(--accent)]",
            )}
          >
            {notif.title}
          </p>
        </div>
        {notif.message && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--muted-foreground)]">
            {notif.message}
          </p>
        )}
      </div>

      <span className="shrink-0 text-[10px] text-[var(--muted-foreground)] tabular-nums">
        {new Date(notif.createdAt).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTarget();
          }}
          disabled={!hasHref}
          title={hasHref ? "Voir la page concernée" : "Aucune page liée à cette notification"}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
        >
          <Eye className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Supprimer"
          // arkyo-server: habillage Strata
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function NotificationDetails({
  notif,
  onMarkRead,
  onOpenTarget,
  onDelete,
}: {
  notif: Notif;
  onMarkRead: () => void;
  onOpenTarget: () => void;
  onDelete: () => void;
}) {
  const isUnread = !notif.readAt;
  const hasHref = getTenantNotificationHref(notif) !== null;
  const date = new Date(notif.createdAt);
  const meta = (notif.data ?? null) as Record<string, unknown> | null;
  const hasMeta = meta && Object.keys(meta).length > 0;

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10">
          <Bell className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base leading-tight font-semibold">{notif.title}</h3>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase",
                isUnread
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "bg-[var(--secondary)]/60 text-[var(--muted-foreground)]",
              )}
            >
              {isUnread ? "Non lu" : "Lu"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-[var(--muted-foreground)]">{notif.type}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          // arkyo-server: habillage Strata
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 text-[11px] font-medium text-[var(--danger-text)] transition-colors hover:bg-[var(--danger)]/10"
          title="Supprimer"
        >
          <Trash2 className="h-3 w-3" />
          Supprimer
        </button>
      </div>

      <DetailRow label="Reçue le">
        <span className="text-sm">
          {date.toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          <span className="ml-2 text-[var(--muted-foreground)]">
            à{" "}
            {date.toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </span>
      </DetailRow>

      {notif.readAt && (
        <DetailRow label="Lue le">
          <span className="text-sm text-[var(--muted-foreground)]">
            {new Date(notif.readAt).toLocaleString("fr-FR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </DetailRow>
      )}

      {notif.message && (
        <DetailRow label="Message">
          <p className="rounded-lg bg-[var(--secondary)]/40 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-[var(--foreground)]">
            {notif.message}
          </p>
        </DetailRow>
      )}

      {hasMeta && (
        <DetailRow label="Données">
          <pre className="rounded-lg bg-[var(--secondary)]/40 p-3 font-mono text-[11px] break-words whitespace-pre-wrap text-[var(--foreground)]">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </DetailRow>
      )}

      <DetailRow label="ID">
        <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{notif.id}</span>
      </DetailRow>

      <div className="flex items-center gap-2 border-t border-[var(--border)]/60 pt-3">
        {isUnread && (
          <button
            type="button"
            onClick={onMarkRead}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]/40"
          >
            <Check className="h-3.5 w-3.5" />
            Marquer comme lu
          </button>
        )}
        <button
          type="button"
          onClick={onOpenTarget}
          disabled={!hasHref}
          className={cn(
            "ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
            hasHref
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90" // arkyo-server: habillage Strata
              : "cursor-not-allowed bg-[var(--secondary)]/60 text-[var(--muted-foreground)]",
          )}
          title={
            hasHref ? "Naviguer vers la page concernée" : "Aucune page liée à cette notification"
          }
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Voir la page concernée
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDayLabel(day: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayStr = toDayKey(today);
  const yesterdayStr = toDayKey(yesterday);

  if (day === todayStr) return "Aujourd'hui";
  if (day === yesterdayStr) return "Hier";

  return new Date(day).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
