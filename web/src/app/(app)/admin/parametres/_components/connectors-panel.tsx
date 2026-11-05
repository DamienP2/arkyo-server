"use client";

/**
 * ConnectorsPanel — onglet « Connecteurs » de `/admin/parametres` (tenant).
 *
 * Aligne le pattern des autres panneaux du Catalogue tenant (Brands /
 * Categories) :
 *   - Liste **unifiée** Arkyo + tenant (pas de fork-on-edit : les items Arkyo
 *     restent en lecture seule, badge monogramme, aucune action). Toggle
 *     « Catalogue Arkyo » dans la toolbar (`useShowArkyoParametres`, global
 *     aux 5 panels).
 *   - Card partagée `<ConnectorCard>` (cf. components/catalogue/connector/).
 *   - Dialog partagé `<SharedConnectorFormDialog>` via thin wrapper local
 *     (cf. ./connector-form-dialog.tsx).
 *   - Actions inline items tenant : Dupliquer · Supprimer (pas de
 *     « Proposer »).
 *
 * Données :
 *   GET /api/tenant/parametres/connectors → { arkyo, personal }
 *   GET /api/tenant/catalogue/lookup       → functions (référentiel Arkyo)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plug, Plus, Search, Trash2 } from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  ConnectorCard,
  type ConnectorCardFunction,
  type ConnectorCardItem,
} from "@/components/catalogue/connector";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

// arkyo-server: badge de source Arkyo et bascule « Catalogue Arkyo » retirés
// (catalogue unique : l'API ne renvoie jamais d'items Arkyo).

import { ConnectorFormDialog } from "./connector-form-dialog";
import {
  useParametresSort,
  useParametresView,
  useShowArkyoParametres,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types publics (exportés pour le wrapper de dialog) ─────────────────────

export type FunctionItem = {
  id: string;
  label: string;
  color: string;
};

/**
 * Item de catalogue Arkyo : la junction `functions[]` est exposée brute par
 * l'API (`include: { functions: { include: { function: true } } }`).
 */
export type ArkyoConnectorItem = {
  id: string;
  name: string;
  color: string | null;
  versions: string[];
  iconId: string | null;
  svgUrl: string | null;
  hasNeutrikD: boolean;
  dTypeSvgUrl?: string | null;
  functions?: Array<{ function: FunctionItem }>;
};

/**
 * Item de catalogue personnel du tenant : `functionIds` est une soft-FK en
 * Json côté DB ; on l'expose en tant que `string[]` côté client.
 */
export type TenantConnectorItem = {
  id: string;
  name: string;
  color: string | null;
  versions: string[];
  iconId: string | null;
  svgUrl: string | null;
  hasNeutrikD: boolean;
  dTypeSvgUrl?: string | null;
  functionIds: string[];
  isActive?: boolean;
};

type ConnectorsResponse = {
  arkyo?: ArkyoConnectorItem[];
  personal?: TenantConnectorItem[];
};

type LookupResponse = {
  functions?: FunctionItem[];
};

type AnyConnector = ArkyoConnectorItem | TenantConnectorItem;

const SECTION = "connectors";

// ── Helpers ────────────────────────────────────────────────────────────────

function isTenant(item: AnyConnector): item is TenantConnectorItem {
  return "functionIds" in item;
}

/**
 * Convertit un item DB en `ConnectorCardItem` pour le rendu partagé.
 * Le tenant reconstruit ses `functions[]` à partir de `functionIds` +
 * référentiel Arkyo.
 */
function toCardItem(
  item: AnyConnector,
  functions: FunctionItem[],
): ConnectorCardItem {
  let fns: ConnectorCardFunction[];
  if (isTenant(item)) {
    const ids = Array.isArray(item.functionIds) ? item.functionIds : [];
    fns = ids
      .map((id) => functions.find((f) => f.id === id) ?? null)
      .filter((f): f is FunctionItem => f !== null);
  } else {
    fns = (item.functions ?? []).map((r) => r.function);
  }
  return {
    id: item.id,
    name: item.name,
    color: item.color,
    versions: item.versions ?? [],
    iconId: item.iconId,
    svgUrl: item.svgUrl,
    hasNeutrikD: item.hasNeutrikD,
    dTypeSvgUrl: item.dTypeSvgUrl ?? null,
    functions: fns,
  };
}

// ── Composant principal ────────────────────────────────────────────────────

export function ConnectorsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  // Data
  const [arkyo, setArkyo] = useState<ArkyoConnectorItem[]>([]);
  const [personal, setPersonal] = useState<TenantConnectorItem[]>([]);
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // Toggle Arkyo / view / sort
  const [showArkyo, setShowArkyo] = useShowArkyoParametres();
  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  // Recherche
  const [search, setSearch] = useState("");

  // Modale form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantConnectorItem | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, lookup] = await Promise.all([
        api.get<ConnectorsResponse>("/api/tenant/parametres/connectors"),
        api
          .get<LookupResponse>("/api/tenant/catalogue/lookup")
          .catch(() => ({} as LookupResponse)),
      ]);
      setArkyo(Array.isArray(data?.arkyo) ? data.arkyo : []);
      setPersonal(Array.isArray(data?.personal) ? data.personal : []);
      setFunctions(Array.isArray(lookup?.functions) ? lookup.functions : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setArkyo([]);
        setPersonal([]);
      } else {
        setError(getApiErrorMessage(e, "Impossible de charger les connecteurs."));
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

  useParametresSync("tenant_parametres_connectors", () => {
    void reloadRef.current();
  });

  // ── Liste unifiée pré-filtrée par le toggle « Catalogue Arkyo » ─────────
  const visibleList: AnyConnector[] = useMemo(() => {
    return showArkyo ? [...personal, ...arkyo] : personal;
  }, [showArkyo, arkyo, personal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((c) => {
      if (!q) return true;
      const card = toCardItem(c, functions);
      const versionMatch = card.versions.some((v) =>
        v.toLowerCase().includes(q),
      );
      const fnMatch = card.functions.some((f) =>
        f.label.toLowerCase().includes(q),
      );
      return c.name.toLowerCase().includes(q) || versionMatch || fnMatch;
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir, functions]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: TenantConnectorItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantConnectorItem) => {
    try {
      await api.post("/api/tenant/parametres/connectors", {
        name: `${item.name} (copie)`,
        iconId: item.iconId,
        svgUrl: item.svgUrl,
        color: item.color,
        versions: item.versions,
        functionIds: item.functionIds,
      });
      toast.success("Connecteur dupliqué.");
      void reloadRef.current();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantConnectorItem) => {
    const ok = await confirm({
      title: "Supprimer ce connecteur ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le connecteur est utilisé par un
          équipement ou panel personnel.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/connectors/${item.id}`);
      setPersonal((prev) => prev.filter((c) => c.id !== item.id));
      toast.success("Connecteur supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ??
            "Ce connecteur est utilisé par des items du catalogue personnel.",
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
          icon={<Plug strokeWidth={1.5} />}
          title="Aucun connecteur personnel"
          description="Créez votre premier connecteur ou réactivez le catalogue Arkyo."
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
        icon={<Plug strokeWidth={1.5} />}
        title="Aucun connecteur"
        // arkyo-server: mention du référentiel Arkyo publié retirée (catalogue unique)
        description="Créez vos propres types de connecteurs."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter un connecteur
          </EmptyStateAction>
        }
      />
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Plug strokeWidth={1.5} />}
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
            placeholder="Nom, version, catégorie…"
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
              <span className="text-xs font-medium">Nouveau connecteur</span>
            </button>
          ) : undefined
        }
      >
        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun connecteur correspondant"
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
            {filtered.map((c) => {
              const card = toCardItem(c, functions);
              if (isTenant(c)) {
                return (
                  <ConnectorCard
                    key={c.id}
                    item={card}
                    view={view}
                    onClick={() => openEdit(c)}
                    actions={
                      <PersonalCardActions
                        onDuplicate={() => void handleDuplicate(c)}
                        onDelete={() => void handleDeleteFromCard(c)}
                      />
                    }
                  />
                );
              }
              return (
                <ConnectorCard
                  key={c.id}
                  item={card}
                  view={view}
                  // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                />
              );
            })}
          </div>
        )}
      </AdminTabLayout>

      <ConnectorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoConnectors={[]}
        functions={functions}
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
// Pattern aligné sur `brands-panel.tsx` : suite de boutons icônes visibles en
// hover, accolés en haut à droite de la card. Pas de dropdown.

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
