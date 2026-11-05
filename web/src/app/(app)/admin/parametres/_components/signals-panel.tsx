"use client";

/**
 * SignalsPanel — onglet « Signaux » de `/admin/parametres` (tenant).
 *
 * Aligne le pattern des autres panneaux du Catalogue tenant (Brands /
 * Connectors / Categories) :
 *   - Liste **unifiée** Arkyo + tenant (pas de fork-on-edit : les items Arkyo
 *     restent en lecture seule, badge monogramme, aucune action). Toggle
 *     « Catalogue Arkyo » dans la toolbar (`useShowArkyoParametres`, global
 *     aux 5 panels).
 *   - Card partagée `<SignalCard>` (cf. components/catalogue/signal/).
 *   - Dialog partagé `<SharedSignalFormDialog>` via thin wrapper local
 *     (cf. ./signal-form-dialog.tsx).
 *   - Actions inline items tenant : Dupliquer · Supprimer (pas de
 *     « Proposer »).
 *   - Groupement par fonction conservé (rendu sectionné).
 *
 * Données :
 *   GET /api/tenant/parametres/signals → { arkyo, personal }
 *   GET /api/tenant/catalogue/lookup    → functions
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, Search, Trash2, Waves } from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  SignalCard,
  type SignalCardItem,
  type SignalCardFunction,
} from "@/components/catalogue/signal";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

// arkyo-server: badge de source Arkyo et bascule « Catalogue Arkyo » retirés
// (catalogue unique : l'API ne renvoie jamais d'items Arkyo).

import { SignalFormDialog } from "./signal-form-dialog";
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
  cablePrefix?: string | null;
  cableSuffix?: string | null;
};

/** Item de catalogue Arkyo enrichi côté API (`function` join + `color` résolu). */
export type ArkyoSignalItem = {
  id: string;
  name: string;
  /** Couleur déjà résolue côté API (utilise function.color en fallback). */
  color: string;
  /** Label de la fonction associée (déjà résolu côté API). */
  category: string | null;
  functionId: string | null;
  function: FunctionItem | null;
  cablePrefix: string | null;
  cableSuffix: string | null;
  bandwidth: string | null;
  requiredImpedance: number | null;
  minBandwidthMHz: number | null;
  isIp: boolean;
  supportsRedundancy: boolean;
  redundancyStyle: string | null;
  usesMulticast: boolean;
};

/** Item de catalogue personnel du tenant (TenantSignalType). */
export type TenantSignalItem = {
  id: string;
  name: string;
  color: string | null;
  functionId: string | null;
  cablePrefix: string | null;
  cableSuffix: string | null;
  bandwidth: string | null;
  requiredImpedance: number | null;
  minBandwidthMHz: number | null;
  connectorIds: string[];
  isIp: boolean;
  supportsRedundancy: boolean;
  redundancyStyle: string | null;
  usesMulticast: boolean;
  isActive?: boolean;
};

type SignalsResponse = {
  arkyo?: ArkyoSignalItem[];
  personal?: TenantSignalItem[];
};

type LookupResponse = {
  functions?: FunctionItem[];
};

type AnySignal = ArkyoSignalItem | TenantSignalItem;

const SECTION = "signals";

// ── Helpers ────────────────────────────────────────────────────────────────

function isTenant(s: AnySignal): s is TenantSignalItem {
  return "connectorIds" in s;
}

/** Convertit un signal (Arkyo ou tenant) en SignalCardItem. */
function toCardItem(s: AnySignal): SignalCardItem {
  return {
    id: s.id,
    name: s.name,
    color: s.color ?? null,
    functionId: s.functionId,
    cablePrefix: s.cablePrefix,
    cableSuffix: s.cableSuffix,
    bandwidth: s.bandwidth,
    isIp: s.isIp,
    usesMulticast: s.usesMulticast,
  };
}

// ── Composant ──────────────────────────────────────────────────────────────

export function SignalsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [arkyo, setArkyo] = useState<ArkyoSignalItem[]>([]);
  const [personal, setPersonal] = useState<TenantSignalItem[]>([]);
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const [showArkyo, setShowArkyo] = useShowArkyoParametres();
  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantSignalItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, lookup] = await Promise.all([
        api.get<SignalsResponse>("/api/tenant/parametres/signals"),
        api
          .get<LookupResponse>("/api/tenant/catalogue/lookup")
          .catch(() => ({}) as LookupResponse),
      ]);
      setArkyo(Array.isArray(data?.arkyo) ? data.arkyo : []);
      setPersonal(Array.isArray(data?.personal) ? data.personal : []);
      setFunctions(Array.isArray(lookup?.functions) ? lookup.functions : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setArkyo([]);
        setPersonal([]);
      } else {
        setError(getApiErrorMessage(e, "Impossible de charger les signaux."));
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

  useParametresSync("tenant_parametres_signals", () => {
    void reloadRef.current();
  });

  // ── Liste unifiée pré-filtrée par le toggle « Catalogue Arkyo » ─────────
  const visibleList: AnySignal[] = useMemo(() => {
    return showArkyo ? [...personal, ...arkyo] : personal;
  }, [showArkyo, arkyo, personal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((s) => {
      if (!q) return true;
      const fn = s.functionId
        ? functions.find((f) => f.id === s.functionId)
        : null;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.bandwidth ?? "").toLowerCase().includes(q) ||
        (s.cablePrefix ?? "").toLowerCase().includes(q) ||
        (fn?.label ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir, functions]);

  // Groupement par fonction (rendu sectionné).
  const byFunction = useMemo(() => {
    const map: Record<string, AnySignal[]> = {};
    for (const sig of filtered) {
      const key = sig.functionId ?? "_unassigned";
      if (!map[key]) map[key] = [];
      map[key].push(sig);
    }
    return map;
  }, [filtered]);

  const orderedFunctionKeys = useMemo(() => {
    const keys = functions.map((f) => f.id).filter((id) => byFunction[id]);
    if (byFunction["_unassigned"]) keys.push("_unassigned");
    return keys;
  }, [functions, byFunction]);

  // Référentiel des fonctions au format SignalCardFunction (inclut prefix/suffix).
  const cardFunctions: SignalCardFunction[] = useMemo(
    () =>
      functions.map((f) => ({
        id: f.id,
        label: f.label,
        color: f.color,
        cablePrefix: f.cablePrefix,
        cableSuffix: f.cableSuffix,
      })),
    [functions],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantSignalItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantSignalItem) => {
    try {
      await api.post("/api/tenant/parametres/signals", {
        name: `${item.name} (copie)`,
        color: item.color,
        functionId: item.functionId,
        cablePrefix: item.cablePrefix,
        cableSuffix: item.cableSuffix,
        bandwidth: item.bandwidth,
        requiredImpedance: item.requiredImpedance,
        minBandwidthMHz: item.minBandwidthMHz,
        connectorIds: item.connectorIds,
        isIp: item.isIp,
        supportsRedundancy: item.supportsRedundancy,
        redundancyStyle: item.redundancyStyle,
        usesMulticast: item.usesMulticast,
      });
      toast.success("Signal dupliqué.");
      void reloadRef.current();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantSignalItem) => {
    const ok = await confirm({
      title: "Supprimer ce signal ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le signal est utilisé par des câbles
          personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/signals/${item.id}`);
      setPersonal((prev) => prev.filter((s) => s.id !== item.id));
      toast.success("Signal supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce signal est utilisé par des items du catalogue personnel.",
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
          icon={<Waves strokeWidth={1.5} />}
          title="Aucun signal personnel"
          description="Créez votre premier signal ou réactivez le catalogue Arkyo."
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
        icon={<Waves strokeWidth={1.5} />}
        title="Aucun signal"
        // arkyo-server: mention du référentiel Arkyo publié retirée (catalogue unique)
        description="Créez vos propres types de signaux."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter un signal
          </EmptyStateAction>
        }
      />
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Waves strokeWidth={1.5} />}
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
            placeholder="Nom, catégorie, préfixe…"
            count={filtered.length}
            total={
              filtered.length !== visibleList.length
                ? visibleList.length
                : undefined
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
              <span className="text-xs font-medium">Nouveau signal</span>
            </button>
          ) : undefined
        }
      >
        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun signal correspondant"
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
                  {view === "grid" ? (
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(280px, 1fr))",
                      }}
                    >
                      {list.map((sig) => {
                        const card = toCardItem(sig);
                        if (isTenant(sig)) {
                          return (
                            <SignalCard
                              key={sig.id}
                              item={card}
                              functions={cardFunctions}
                              view="grid"
                              onClick={() => openEdit(sig)}
                              actions={
                                <PersonalCardActions
                                  onDuplicate={() =>
                                    void handleDuplicate(sig)
                                  }
                                  onDelete={() =>
                                    void handleDeleteFromCard(sig)
                                  }
                                />
                              }
                            />
                          );
                        }
                        return (
                          <SignalCard
                            key={sig.id}
                            item={card}
                            functions={cardFunctions}
                            view="grid"
                            // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {list.map((sig) => {
                        const card = toCardItem(sig);
                        if (isTenant(sig)) {
                          return (
                            <SignalCard
                              key={sig.id}
                              item={card}
                              functions={cardFunctions}
                              view="list"
                              onClick={() => openEdit(sig)}
                              actions={
                                <PersonalCardActions
                                  onDuplicate={() =>
                                    void handleDuplicate(sig)
                                  }
                                  onDelete={() =>
                                    void handleDeleteFromCard(sig)
                                  }
                                />
                              }
                            />
                          );
                        }
                        return (
                          <SignalCard
                            key={sig.id}
                            item={card}
                            functions={cardFunctions}
                            view="list"
                            // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AdminTabLayout>

      <SignalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoSignals={[]}
        functions={functions}
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
// Pattern aligné sur `brands-panel.tsx` / `connectors-panel.tsx` : suite de
// boutons icônes visibles en hover, accolés en haut à droite de la card.

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
