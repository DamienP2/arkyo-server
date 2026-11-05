"use client";

/**
 * BrandsPanel — onglet « Fabricants » de `/admin/parametres` (tenant).
 *
 * Liste **unifiée** (items Arkyo + items du tenant fusionnés) — même pattern
 * que `/admin/catalogue`, avec une **différence majeure** : pas de
 * fork-on-edit ici. Les items Arkyo restent en lecture seule (badge
 * monogramme, pas d'actions, pas d'éditeur) ; les items du tenant gardent le
 * CRUD complet (click = éditeur modal, hover = Dupliquer · Supprimer).
 *
 * Toggle « Catalogue Arkyo » dans la toolbar (avant les contrôles de droite)
 * pour masquer les items Arkyo — état global aux 5 panels paramètres via
 * `useShowArkyoParametres`.
 *
 * Données :
 *   GET /api/tenant/parametres/brands → { arkyo: CatalogBrand[], personal: TenantBrand[] }
 *
 * Persistance localStorage :
 *   arkyo:tenant-parametres:show-arkyo  ← toggle global
 *   tenant.parametres.brands.view       ← "grid" | "list"
 *   tenant.parametres.brands.sort       ← { sortBy, direction }
 *
 * SSE entity `tenant_parametres_brands` (debounce 150ms) pour rafraîchir la
 * vue après mutation distante.
 *
 * Le rendu visuel des cards est délégué à `<BrandCard>` (partagé) ; le
 * formulaire à `<BrandFormDialog>` tenant (thin wrapper du dialog partagé).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Copy, Plus, Search, Trash2 } from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BrandCard } from "@/components/catalogue/brand";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

// arkyo-server: badge de source Arkyo et bascule « Catalogue Arkyo » retirés
// (catalogue unique : l'API ne renvoie jamais d'items Arkyo).

import { BrandFormDialog } from "./brand-form-dialog";
import {
  useParametresSort,
  useParametresView,
  useShowArkyoParametres,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types publics (exportés pour BrandFormDialog) ────────────────────────────

export type ArkyoBrandItem = {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
};

export type TenantBrandItem = {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  isActive?: boolean;
};

type BrandsResponse = {
  arkyo?: ArkyoBrandItem[];
  personal?: TenantBrandItem[];
};

/** Entrée de la liste unifiée — la source pilote badge + actions. */
type BrandEntry =
  | { kind: "tenant"; item: TenantBrandItem }
  | { kind: "arkyo"; item: ArkyoBrandItem };

const SECTION = "brands";

// ── Composant principal ──────────────────────────────────────────────────────

export function BrandsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  // Data
  const [arkyo, setArkyo] = useState<ArkyoBrandItem[]>([]);
  const [personal, setPersonal] = useState<TenantBrandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // Toggle Arkyo / view / sort persistés
  const [showArkyo, setShowArkyo] = useShowArkyoParametres();
  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  // Recherche
  const [search, setSearch] = useState("");

  // Modale form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantBrandItem | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<BrandsResponse>("/api/tenant/parametres/brands");
      setArkyo(Array.isArray(data?.arkyo) ? data.arkyo : []);
      setPersonal(Array.isArray(data?.personal) ? data.personal : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setArkyo([]);
        setPersonal([]);
      } else {
        setError(getApiErrorMessage(e, "Impossible de charger les fabricants."));
        setArkyo([]);
        setPersonal([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadRef.current = fetchAll;
    void fetchAll();
  }, [fetchAll]);

  // SSE — rafraîchit dès qu'une mutation distante touche les TenantBrand
  useParametresSync("tenant_parametres_brands", () => {
    void reloadRef.current();
  });

  // ── Liste unifiée pré-filtrée par le toggle « Catalogue Arkyo » ───────────
  const visibleList = useMemo<BrandEntry[]>(() => {
    const entries: BrandEntry[] = personal.map((item) => ({
      kind: "tenant" as const,
      item,
    }));
    if (showArkyo) {
      entries.push(
        ...arkyo.map((item) => ({ kind: "arkyo" as const, item })),
      );
    }
    return entries;
  }, [personal, arkyo, showArkyo]);

  // ── Filtrage + tri ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter(({ item: b }) => {
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.website ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.item.name.localeCompare(b.item.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: TenantBrandItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantBrandItem) => {
    try {
      await api.post("/api/tenant/parametres/brands", {
        name: `${item.name} (copie)`,
        website: item.website,
        logoUrl: item.logoUrl,
      });
      toast.success("Fabricant dupliqué.");
      void reloadRef.current();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantBrandItem) => {
    const ok = await confirm({
      title: "Supprimer ce fabricant ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le fabricant est utilisé par un
          équipement ou un câble personnel.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/brands/${item.id}`);
      setPersonal((prev) => prev.filter((b) => b.id !== item.id));
      toast.success("Fabricant supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce fabricant est utilisé par des items du catalogue personnel.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  // ── Empty states ──────────────────────────────────────────────────────────
  // 2 cas : liste vraiment vide → CTA création ; tout masqué par le toggle
  // « Catalogue Arkyo » désactivé → suggère de le réactiver.
  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo = !showArkyo && arkyo.length > 0;

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<Building2 strokeWidth={1.5} />}
          title="Aucun fabricant personnel"
          description="Créez votre premier fabricant ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Building2 strokeWidth={1.5} />}
        title="Aucun fabricant"
        // arkyo-server: mention du référentiel Arkyo publié retirée (catalogue unique)
        description="Créez vos propres fabricants."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter un fabricant
          </EmptyStateAction>
        }
      />
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Building2 strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </div>
    );
  }

  return (
    <>
      <AdminTabLayout
        toolbar={
          <AdminListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Nom, site web…"
            count={filtered.length}
            total={filtered.length !== visibleList.length ? visibleList.length : undefined}
            onSort={handleSorted}
            sortDir={sortDir}
            // arkyo-server: bascule « Catalogue Arkyo » retirée (catalogue unique)
            view={view}
            onViewChange={setView}
          />
        }
        addButton={
          !isListEmpty ? (
            <button
              onClick={openCreate}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              style={{ minHeight: "72px" }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-xs font-medium">Nouveau fabricant</span>
            </button>
          ) : undefined
        }
      >
        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun fabricant correspondant"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : (
          <div
            className={view === "grid" ? "grid gap-3" : "space-y-1"}
            style={
              view === "grid"
                ? { gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }
                : undefined
            }
          >
            {filtered.map((entry) =>
              entry.kind === "tenant" ? (
                <BrandCard
                  key={entry.item.id}
                  item={entry.item}
                  view={view}
                  onClick={() => openEdit(entry.item)}
                  showWebsiteLink
                  actions={
                    <PersonalCardActions
                      onDuplicate={() => void handleDuplicate(entry.item)}
                      onDelete={() => void handleDeleteFromCard(entry.item)}
                    />
                  }
                />
              ) : (
                <BrandCard
                  key={entry.item.id}
                  item={entry.item}
                  view={view}
                  // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                  showWebsiteLink
                />
              ),
            )}
          </div>
        )}
      </AdminTabLayout>

      <BrandFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoBrands={[]}
        onSaved={() => {
          setFormOpen(false);
          void fetchAll();
        }}
        onDeleted={() => {
          void fetchAll();
        }}
      />
    </>
  );
}

// ── Actions inline réutilisées en mode personal ─────────────────────────────
//
// Pattern aligné sur `categories-panel.tsx` : suite de boutons icônes visibles
// en hover (`opacity-0 group-hover:opacity-100`) accolés en haut à droite de
// la card. Aucune dropdown — meilleure découvrabilité et cohérence avec le
// supervisor (Trash inline).

function PersonalCardActions({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        title="Dupliquer"
        aria-label="Dupliquer"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Supprimer"
        aria-label="Supprimer"
        // arkyo-server: habillage Strata
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
