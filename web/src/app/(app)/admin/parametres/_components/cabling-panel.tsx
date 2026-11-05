"use client";

/**
 * CablingPanel — onglet « Câblage » de `/admin/parametres` (tenant).
 *
 * Aligne le pattern des autres panneaux du Catalogue tenant (Brands /
 * Connectors / Signals / Categories) :
 *   - Liste **unifiée** Arkyo + tenant (pas de fork-on-edit : les items Arkyo
 *     restent en lecture seule, badge monogramme, aucune action). Toggle
 *     « Catalogue Arkyo » dans la toolbar (`useShowArkyoParametres`, global
 *     aux 5 panels).
 *   - Card partagée `<CablingCard>` (cf. components/catalogue/cabling/).
 *   - Dialog partagé `<SharedCablingFormDialog>` via thin wrapper local
 *     (cf. ./cabling-form-dialog.tsx).
 *   - Actions inline items tenant : Dupliquer · Supprimer (pas de
 *     « Proposer »).
 *   - Groupement par fonction conservé (rendu sectionné).
 *   - Barre de recherche **toujours présente** (peu importe le nombre
 *     d'items).
 *
 * Données :
 *   GET /api/tenant/parametres/cabling → { arkyo, personal }
 *   GET /api/tenant/catalogue/lookup    → functions + brands
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cable as CableIcon, Copy, Plus, Search, Trash2 } from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  CablingCard,
  type CablingCardFunction,
  type CablingCardItem,
} from "@/components/catalogue/cabling";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

// arkyo-server: badge de source Arkyo et bascule « Catalogue Arkyo » retirés
// (catalogue unique : l'API ne renvoie jamais d'items Arkyo).

import { CablingFormDialog } from "./cabling-form-dialog";
import {
  useParametresSort,
  useParametresView,
  useShowArkyoParametres,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types publics ──────────────────────────────────────────────────────────

export type FunctionItem = {
  id: string;
  label: string;
  color: string;
};

export type BrandLookupItem = {
  id: string;
  name: string;
};

export type ArkyoCableModelItem = {
  id: string;
  name: string;
  reference: string | null;
  function: { id: string; label: string; color: string } | null;
  brand: { id: string; name: string; logoUrl: string | null } | null;
  impedance: number | null;
  bandwidthMHz: number | null;
  diameterMm: number | null;
  conductor: string | null;
  shielding: string | null;
  jacketMaterial: string | null;
  fireRating: string | null;
  notes: string | null;
};

export type TenantCableModelItem = {
  id: string;
  name: string;
  reference: string | null;
  functionId: string | null;
  brandId: string | null;
  impedance: number | null;
  bandwidthMHz: number | null;
  diameterMm: number | null;
  conductor: string | null;
  shielding: string | null;
  jacketMaterial: string | null;
  fireRating: string | null;
  customFields?: Array<{
    key: string;
    label: string;
    type: "TEXT" | "NUMBER";
    value: string | number;
  }>;
  imageUrl: string | null;
  datasheetUrl: string | null;
  notes: string | null;
  isActive?: boolean;
  sortOrder?: number;
};

type CablingResponse = {
  arkyo?: ArkyoCableModelItem[];
  personal?: TenantCableModelItem[];
};

type LookupResponse = {
  functions?: FunctionItem[];
  brands?: BrandLookupItem[];
};

type AnyCable = ArkyoCableModelItem | TenantCableModelItem;

const SECTION = "cabling";

// ── Helpers ────────────────────────────────────────────────────────────────

function isTenant(c: AnyCable): c is TenantCableModelItem {
  return "functionId" in c;
}

function getFunctionId(c: AnyCable): string | null {
  if (isTenant(c)) return c.functionId;
  return c.function?.id ?? null;
}

function getBrandName(
  c: AnyCable,
  brands: BrandLookupItem[],
): string | null {
  if (isTenant(c)) {
    if (!c.brandId) return null;
    return brands.find((b) => b.id === c.brandId)?.name ?? null;
  }
  return c.brand?.name ?? null;
}

function toCardItem(c: AnyCable, brands: BrandLookupItem[]): CablingCardItem {
  return {
    id: c.id,
    name: c.name,
    reference: c.reference,
    functionId: getFunctionId(c),
    brandName: getBrandName(c, brands),
    impedance: c.impedance,
    diameterMm: c.diameterMm,
    conductor: c.conductor,
    shielding: c.shielding,
    jacketMaterial: c.jacketMaterial,
    fireRating: c.fireRating,
    notes: c.notes,
  };
}

// ── Composant ──────────────────────────────────────────────────────────────

export function CablingPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [arkyo, setArkyo] = useState<ArkyoCableModelItem[]>([]);
  const [personal, setPersonal] = useState<TenantCableModelItem[]>([]);
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [brands, setBrands] = useState<BrandLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const [showArkyo, setShowArkyo] = useShowArkyoParametres();
  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantCableModelItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, lookup] = await Promise.all([
        api.get<CablingResponse>("/api/tenant/parametres/cabling"),
        api
          .get<LookupResponse>("/api/tenant/catalogue/lookup")
          .catch(() => ({}) as LookupResponse),
      ]);
      setArkyo(Array.isArray(data?.arkyo) ? data.arkyo : []);
      setPersonal(Array.isArray(data?.personal) ? data.personal : []);
      setFunctions(Array.isArray(lookup?.functions) ? lookup.functions : []);
      setBrands(Array.isArray(lookup?.brands) ? lookup.brands : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setArkyo([]);
        setPersonal([]);
      } else {
        setError(getApiErrorMessage(e, "Impossible de charger le câblage."));
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

  useParametresSync("tenant_parametres_cabling", () => {
    void reloadRef.current();
  });

  // ── Liste unifiée pré-filtrée par le toggle « Catalogue Arkyo » ─────────
  const visibleList: AnyCable[] = useMemo(() => {
    return showArkyo ? [...personal, ...arkyo] : personal;
  }, [showArkyo, arkyo, personal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.reference ?? "").toLowerCase().includes(q) ||
        (getBrandName(c, brands) ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir, brands]);

  // Groupement par fonction (rendu sectionné).
  const byFunction = useMemo(() => {
    const map: Record<string, AnyCable[]> = {};
    for (const c of filtered) {
      const k = getFunctionId(c) ?? "_unassigned";
      if (!map[k]) map[k] = [];
      map[k].push(c);
    }
    return map;
  }, [filtered]);

  const orderedFunctionKeys = useMemo(() => {
    const keys = functions.map((f) => f.id).filter((id) => byFunction[id]?.length);
    if (byFunction._unassigned?.length) return [...keys, "_unassigned"];
    return keys;
  }, [functions, byFunction]);

  // Référentiel des fonctions au format CablingCardFunction.
  const cardFunctions: CablingCardFunction[] = useMemo(
    () =>
      functions.map((f) => ({
        id: f.id,
        label: f.label,
        color: f.color,
      })),
    [functions],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantCableModelItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantCableModelItem) => {
    try {
      await api.post("/api/tenant/parametres/cabling", {
        name: `${item.name} (copie)`,
        reference: item.reference,
        functionId: item.functionId,
        brandId: item.brandId,
        impedance: item.impedance,
        bandwidthMHz: item.bandwidthMHz,
        diameterMm: item.diameterMm,
        conductor: item.conductor,
        shielding: item.shielding,
        jacketMaterial: item.jacketMaterial,
        fireRating: item.fireRating,
        notes: item.notes,
        customFields: item.customFields ?? [],
        isActive: true,
      });
      toast.success("Modèle de câble dupliqué.");
      void reloadRef.current();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantCableModelItem) => {
    const ok = await confirm({
      title: `Supprimer « ${item.name} » ?`,
      description: (
        <>
          Action irréversible. La suppression est bloquée si le câble est
          utilisé dans des projets personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/cabling/${item.id}`);
      setPersonal((prev) => prev.filter((c) => c.id !== item.id));
      toast.success("Modèle de câble supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce modèle est utilisé par des items du catalogue personnel.",
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

  // ── Empty ──────────────────────────────────────────────────────────────
  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo = !showArkyo && arkyo.length > 0;
  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<CableIcon strokeWidth={1.5} />}
          title="Aucun modèle de câble personnel"
          description="Créez votre premier modèle de câble ou réactivez le catalogue Arkyo."
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
        icon={<CableIcon strokeWidth={1.5} />}
        title="Aucun modèle de câble"
        description="Créez la bibliothèque des produits fabricants disponibles sur le marché (Belden 1694A, Canare L-4E6S, Mogami W2549…)."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter un câblage
          </EmptyStateAction>
        }
      />
    );
  };

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<CableIcon strokeWidth={1.5} />}
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
            placeholder="Nom, référence, fabricant…"
            count={filtered.length}
            total={
              filtered.length !== visibleList.length ? visibleList.length : undefined
            }
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
              <span className="text-xs font-medium">Nouveau modèle</span>
            </button>
          ) : undefined
        }
      >
        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun modèle correspondant"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : (
          <div className="space-y-7">
            {orderedFunctionKeys.map((fnKey) => {
              const list = byFunction[fnKey] ?? [];
              if (list.length === 0) return null;
              const fn =
                fnKey === "_unassigned"
                  ? null
                  : (functions.find((f) => f.id === fnKey) ?? null);
              const headerColor = fn?.color ?? "#a3a3a3";
              const headerLabel = fn?.label ?? "Sans catégorie";
              return (
                <div key={fnKey}>
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: headerColor }}
                    />
                    <h3
                      className="text-xs font-bold tracking-widest uppercase"
                      style={{ color: headerColor }}
                    >
                      {headerLabel}
                    </h3>
                    <div
                      className="h-px flex-1"
                      style={{ backgroundColor: `${headerColor}30` }}
                    />
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {list.length}
                    </span>
                  </div>
                  <div
                    className={cn(view === "grid" ? "grid gap-3" : "space-y-2")}
                    style={
                      view === "grid"
                        ? {
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(320px, 1fr))",
                          }
                        : undefined
                    }
                  >
                    {list.map((c) => {
                      const card = toCardItem(c, brands);
                      if (isTenant(c)) {
                        return (
                          <CablingCard
                            key={c.id}
                            item={card}
                            functions={cardFunctions}
                            color={headerColor}
                            view={view}
                            onClick={() => openEdit(c)}
                            actions={
                              <PersonalCardActions
                                onDuplicate={() => void handleDuplicate(c)}
                                onDelete={() =>
                                  void handleDeleteFromCard(c)
                                }
                              />
                            }
                          />
                        );
                      }
                      return (
                        <CablingCard
                          key={c.id}
                          item={card}
                          functions={cardFunctions}
                          color={headerColor}
                          view={view}
                          // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminTabLayout>

      <CablingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoCableModels={[]}
        functions={functions}
        brands={brands}
        onSaved={() => {
          setFormOpen(false);
          void fetchAll();
        }}
      />
    </>
  );
}

// ── Actions inline réutilisées en mode personal ─────────────────────────────
//
// Pattern aligné sur `brands-panel.tsx` / `signals-panel.tsx` : suite de
// boutons icônes visibles en hover, accolés en haut à droite de la card.
// Pas de bouton « Proposer » — retiré du périmètre.

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
