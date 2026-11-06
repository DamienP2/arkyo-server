"use client";

/**
 * Liste des projets (tenant) — pattern AdminTabLayout :
 *  - Toolbar fixed (recherche + tri + filtre status + compteur).
 *  - Bouton inline "Nouveau projet" qui ouvre la modale `NewProjectDialog`.
 *  - Vue grid de cards (xl:grid-cols-3) — pattern Supervisor (border-left
 *    coloré + header tinté + monogramme + body badges).
 *  - Persistance recherche / tri / filtre status / view via localStorage.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Antenna,
  Calendar,
  Clock,
  HardHat,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "@/components/ui/icons";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { AdminTabLayout } from "@/app/(app)/admin/_components/admin-tab-layout";
import { AdminListToolbar } from "@/app/(app)/admin/_components/admin-list-toolbar";
import {
  ActiveFilterPills,
  Chip,
  type ActivePill,
} from "@/app/(app)/admin/_components/list-toolbar-helpers";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { IfTenantPerm } from "@/components/ui/tenant-perm-button";

// ── Types ────────────────────────────────────────────────────────────────────

export type ProjectStatus = "EN_PREPARATION" | "PRET" | "EN_COURS" | "TERMINE" | "ANNULE";
export type InterventionType = "PRESTATION" | "INTEGRATION";
export type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL" | "MIXED" | null;

export type ProjectListItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  interventionType: InterventionType;
  rigType: RigType;
  clientName: string | null;
  shootingDate: string | null;
  shootingEndDate: string | null;
  planningStart: string | null;
  planningEnd: string | null;
  commissioningDate: string | null;
  location: string | null;
  prestationType: string | null;
  description: string | null;
  updatedAt: string;
  createdAt: string;
  documentsCount: number;
  rigConfigsCount: number;
};

// ── Constantes ───────────────────────────────────────────────────────────────

// Couleurs accent par status — choisies pour rester bien distinctes les unes
// des autres (espacées sur la roue chromatique). La couleur s'applique en
// border-left + header tint dans le pattern TenantCard du supervisor.
const STATUS_COLOR: Record<ProjectStatus, string> = {
  EN_PREPARATION: "#f59e0b", // amber  — orange chaud
  PRET: "#10b981", // emerald — vert
  EN_COURS: "#3b82f6", // blue    — bleu
  TERMINE: "#64748b", // slate   — gris froid
  ANNULE: "#ef4444", // red     — rouge
};

const RIG_TYPE_LABEL: Record<NonNullable<RigType>, string> = {
  FLIGHT_CASE: "Flight case",
  CAR: "Car régie",
  FIXED_INSTALL: "Installation fixe",
  MIXED: "Mixte",
};

// La page est filtrée par type d'intervention via la sidebar (?tab=) :
// Prestation OU Intégration. À l'intérieur, les projets sont groupés par
// statut (header coloré : puce + label uppercase + ligne + count).
const INTERVENTION_LABEL: Record<InterventionType, string> = {
  PRESTATION: "prestation",
  INTEGRATION: "intégration",
};

type SortKey = "recent" | "name";

// Statuts filtrables — multi-select dans le Sheet drawer. ANNULE est inclus
// (l'utilisateur peut vouloir retrouver un projet annulé via le filtre).
const STATUS_FILTER_OPTIONS: { id: ProjectStatus; label: string; color: string }[] = [
  { id: "EN_PREPARATION", label: "En préparation", color: STATUS_COLOR.EN_PREPARATION },
  { id: "PRET", label: "Prêt", color: STATUS_COLOR.PRET },
  { id: "EN_COURS", label: "En cours", color: STATUS_COLOR.EN_COURS },
  { id: "TERMINE", label: "Terminé", color: STATUS_COLOR.TERMINE },
  { id: "ANNULE", label: "Annulé", color: STATUS_COLOR.ANNULE },
];

// ── Persistance localStorage ─────────────────────────────────────────────────

const LS_SORT = "projects:sort";
const LS_STATUS = "projects:status";
const LS_RIGTYPE = "projects:rigtype";

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectsClient({
  initialProjects,
}: {
  initialProjects: ProjectListItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Type d'intervention affiché, piloté par la sidebar (?tab=). Défaut : Prestation.
  const interventionView: InterventionType =
    searchParams.get("tab") === "integration" ? "INTEGRATION" : "PRESTATION";

  const [search, setSearch] = useState("");
  const [sortKey, setSortKeyRaw] = useState<SortKey>("recent");
  // Multi-select : Set<ProjectStatus>. Vide = aucun filtre (tous les statuts).
  const [statusFilter, setStatusFilterRaw] = useState<Set<ProjectStatus>>(new Set());
  // Multi-select : Set<RigType non-null>. Vide = aucun filtre (tous les types).
  const [rigTypeFilter, setRigTypeFilterRaw] = useState<Set<NonNullable<RigType>>>(
    new Set(),
  );
  // Drawer filtres (Sheet)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  // Liste locale (pour suppression optimiste) — sync depuis initialProjects.
  const [items, setItems] = useState<ProjectListItem[]>(initialProjects);
  useEffect(() => setItems(initialProjects), [initialProjects]);
  // Vue grid / list — persisté localStorage. Pattern aligné avec Supervisor.
  const [viewMode, setViewMode] = useLocalStorageState<"grid" | "list">(
    "projects:view",
    "grid",
    { isValid: (v): v is "grid" | "list" => v === "grid" || v === "list" },
  );

  // Hydrate localStorage côté client uniquement.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSort = window.localStorage.getItem(LS_SORT) as SortKey | null;
    if (savedSort === "recent" || savedSort === "name") setSortKeyRaw(savedSort);
    // Format actuel : CSV de ProjectStatus. On rétrocompatibilise avec
    // l'ancien format mono-select ("all" | ProjectStatus).
    const savedStatus = window.localStorage.getItem(LS_STATUS);
    if (savedStatus) {
      const validIds = new Set<string>(STATUS_FILTER_OPTIONS.map((o) => o.id));
      if (savedStatus === "all") {
        setStatusFilterRaw(new Set());
      } else {
        const parsed = savedStatus
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is ProjectStatus => validIds.has(s));
        if (parsed.length > 0) setStatusFilterRaw(new Set(parsed));
      }
    }
    // Rig type filter — multi-select stocké en CSV (NonNullable<RigType>).
    const savedRig = window.localStorage.getItem(LS_RIGTYPE);
    if (savedRig && savedRig !== "all") {
      const validRig = new Set<string>(Object.keys(RIG_TYPE_LABEL));
      const parsed = savedRig
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is NonNullable<RigType> => validRig.has(s));
      if (parsed.length > 0) setRigTypeFilterRaw(new Set(parsed));
    }
  }, []);

  const setSortKey = (v: SortKey) => {
    setSortKeyRaw(v);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_SORT, v);
  };

  const setStatusFilter = (next: Set<ProjectStatus>) => {
    setStatusFilterRaw(next);
    if (typeof window !== "undefined") {
      const serialized = next.size === 0 ? "all" : Array.from(next).join(",");
      window.localStorage.setItem(LS_STATUS, serialized);
    }
  };
  const toggleStatusFilter = (id: ProjectStatus) => {
    setStatusFilter(
      (() => {
        const next = new Set(statusFilter);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      })(),
    );
  };
  const clearStatusFilter = () => setStatusFilter(new Set());

  const setRigTypeFilter = (next: Set<NonNullable<RigType>>) => {
    setRigTypeFilterRaw(next);
    if (typeof window !== "undefined") {
      const serialized = next.size === 0 ? "all" : Array.from(next).join(",");
      window.localStorage.setItem(LS_RIGTYPE, serialized);
    }
  };
  const toggleRigTypeFilter = (id: NonNullable<RigType>) => {
    setRigTypeFilter(
      (() => {
        const next = new Set(rigTypeFilter);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      })(),
    );
  };
  const clearRigTypeFilter = () => setRigTypeFilter(new Set());
  const clearAllFilters = () => {
    setStatusFilter(new Set());
    setRigTypeFilter(new Set());
  };

  // ── Filtrage / tri ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = items.filter((p) => {
      // Vue sidebar = segmentation stricte par type d'intervention.
      if (p.interventionType !== interventionView) return false;

      if (statusFilter.size > 0 && !statusFilter.has(p.status)) {
        return false;
      }

      // Filtre par type de régie. Si rigTypeFilter actif, on exclut les projets
      // sans rigType ou avec un rigType non sélectionné.
      if (rigTypeFilter.size > 0) {
        if (!p.rigType || !rigTypeFilter.has(p.rigType)) return false;
      }

      if (q.length > 0) {
        const haystack = [p.name, p.clientName, p.location, p.prestationType, p.description]
          .filter((x): x is string => typeof x === "string")
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "fr");
      // recent : updatedAt desc
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return list;
  }, [items, search, sortKey, statusFilter, rigTypeFilter, interventionView]);

  // Projets de la vue courante (avant filtres recherche/statut) — sert au total
  // de la toolbar et à l'empty state plein écran.
  const viewItems = useMemo(
    () => items.filter((p) => p.interventionType === interventionView),
    [items, interventionView],
  );
  const totalCount = viewItems.length;
  const visibleCount = filtered.length;

  // ── Filtres actifs (pills + compteur) ────────────────────────────────────
  const activeFilterCount =
    (statusFilter.size > 0 ? 1 : 0) + (rigTypeFilter.size > 0 ? 1 : 0);
  const activePills = useMemo<ActivePill[]>(() => {
    const out: ActivePill[] = [];
    for (const id of statusFilter) {
      const opt = STATUS_FILTER_OPTIONS.find((o) => o.id === id);
      if (!opt) continue;
      out.push({
        key: `status:${id}`,
        label: opt.label,
        color: opt.color,
        onRemove: () => toggleStatusFilter(id),
      });
    }
    for (const id of rigTypeFilter) {
      out.push({
        key: `rig:${id}`,
        label: RIG_TYPE_LABEL[id],
        onRemove: () => toggleRigTypeFilter(id),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, rigTypeFilter]);

  // Clients connus (tous projets) — alimente l'autocomplétion du wizard.
  const knownClients = useMemo(() => {
    const seen = new Set<string>();
    for (const p of items) {
      if (p.clientName && p.clientName.trim()) seen.add(p.clientName.trim());
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "fr"));
  }, [items]);

  // Noms de projets existants (tous onglets confondus) — pour vérification
  // d'unicité dans le wizard. L'unicité s'applique au tenant entier, pas
  // seulement à l'onglet courant.
  const existingNames = useMemo(
    () => items.map((p) => p.name).filter((n): n is string => !!n),
    [items],
  );

  // ── Navigation cards ─────────────────────────────────────────────────────

  const handleCardClick = (p: ProjectListItem) => {
    router.push(`/project/${p.id}?tab=fiche`);
  };

  // ── Suppression ──────────────────────────────────────────────────────────
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Modal "Nouveau projet" ───────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);

  const handleDelete = async (p: ProjectListItem) => {
    const ok = await confirm({
      title: `Supprimer « ${p.name} » ?`,
      description:
        "Le projet et toutes ses données associées (contenants, équipements, documents) seront supprimés définitivement.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(p.id);
    try {
      await api.delete(`/api/tenant/projects/${p.id}`);
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      window.alert(getApiErrorMessage(e, "Échec de la suppression."));
    } finally {
      setDeleting(null);
    }
  };

  // ── Groupement par statut ─────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<ProjectStatus, ProjectListItem[]>();
    for (const p of filtered) {
      const arr = map.get(p.status) ?? [];
      arr.push(p);
      map.set(p.status, arr);
    }
    return STATUS_FILTER_OPTIONS.map((o) => ({
      key: o.id,
      label: o.label,
      color: o.color,
      items: map.get(o.id) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [filtered]);

  // ── Render ───────────────────────────────────────────────────────────────

  // Empty state plein écran quand la vue d'intervention courante est vide.
  const isEmpty = viewItems.length === 0;

  return (
    <>
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex-1 overflow-y-auto px-8",
          // Centrage vertical uniquement quand pas de data (empty state plein écran)
          isEmpty
            ? "flex items-center justify-center py-8"
            : "space-y-5 pt-11 pb-5",
        )}
      >
        {isEmpty ? (
          <EmptyState
            icon={
              interventionView === "PRESTATION" ? (
                <Antenna strokeWidth={1.5} />
              ) : (
                <HardHat strokeWidth={1.5} />
              )
            }
            title={`Aucun projet en ${INTERVENTION_LABEL[interventionView]}`}
            description="Créez votre premier projet pour commencer à organiser vos régies, vos contenants et votre câblage."
            action={
              <IfTenantPerm domain="projects" level="write">
                <EmptyStateAction onClick={() => setNewOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Nouveau projet
                </EmptyStateAction>
              </IfTenantPerm>
            }
          />
        ) : (
          <>
            {/* Toolbar inline (pattern racks-client) */}
            <AdminListToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder="Rechercher un projet, un client, un lieu…"
              count={visibleCount}
              total={totalCount}
              view={viewMode}
              onViewChange={setViewMode}
              onSort={() => setSortKey(sortKey === "recent" ? "name" : "recent")}
              sortDir={sortKey === "recent" ? "desc" : "asc"}
              onFilter={() => setFilterDrawerOpen(true)}
              filterCount={activeFilterCount}
              onClearFilters={clearAllFilters}
            >
              <ActiveFilterPills pills={activePills} />
            </AdminListToolbar>

            {/* Bouton "Nouveau projet" inline */}
            <IfTenantPerm domain="projects" level="write">
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                style={{ minHeight: "72px" }}
              >
                <Plus className="h-5 w-5" />
                <span className="text-xs font-medium">Nouveau projet</span>
              </button>
            </IfTenantPerm>

            {filtered.length === 0 ? (
        <EmptyState
          icon={<Search strokeWidth={1.5} />}
          title="Aucun résultat"
          description={
            activeFilterCount > 0 || search.trim()
              ? `${totalCount} projet${totalCount > 1 ? "s" : ""} au total, mais aucun ne correspond aux filtres actifs.`
              : "Aucun projet ne correspond à ces critères."
          }
          action={
            activeFilterCount > 0 || search.trim() ? (
              <EmptyStateAction
                onClick={() => {
                  clearAllFilters();
                  setSearch("");
                }}
              >
                <X className="h-3.5 w-3.5" />
                Effacer les filtres
              </EmptyStateAction>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-7">
          {grouped.map((group) => {
            const headerColor = group.color;
            const headerLabel = group.label;
            return (
              <div key={group.key}>
                {/* Header statut — pattern Supervisor /collaborators */}
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
                    {group.items.length}
                  </span>
                </div>
                {viewMode === "grid" ? (
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}
                  >
                    {group.items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        color={STATUS_COLOR[p.status]}
                        busy={deleting === p.id}
                        onClick={() => handleCardClick(p)}
                        onDelete={() => handleDelete(p)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {group.items.map((p) => (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        color={STATUS_COLOR[p.status]}
                        busy={deleting === p.id}
                        onClick={() => handleCardClick(p)}
                        onDelete={() => handleDelete(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
          </>
        )}
      </div>
    </div>

    {/* Modal "Nouveau projet" — RENDU EN DEHORS d'AdminTabLayout pour rester
        monté en mode empty (`isEmpty && empty`) où AdminTabLayout fait un
        early-return et n'instancie pas ses children. Sans ça, cliquer sur
        l'EmptyStateAction "Nouveau projet" appelait setNewOpen(true) mais
        aucune Dialog n'écoutait l'état. */}
    <NewProjectDialog
      open={newOpen}
      onOpenChange={setNewOpen}
      interventionType={interventionView}
      knownClients={knownClients}
      existingNames={existingNames}
    />

    {/* Drawer filtres — pattern aligné sur /admin/catalogue. Pour l'instant
        un seul filtre (statut), mais le Sheet est prêt à accueillir d'autres
        critères (type de régie, période, etc.). */}
    <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
      <SheetContent className="w-[340px]">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <SheetTitle className="text-sm">Filtrer les projets</SheetTitle>
              <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif
                {activeFilterCount > 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          <div className="space-y-7">
            <div>
              <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                Statut
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.id}
                    label={opt.label}
                    active={statusFilter.has(opt.id)}
                    onClick={() => toggleStatusFilter(opt.id)}
                    color={opt.color}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--muted-foreground)]/80">
                Aucune sélection = tous les statuts.
              </p>
            </div>

            <div>
              <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                Type de régie
              </p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(RIG_TYPE_LABEL) as NonNullable<RigType>[]).map((id) => (
                  <Chip
                    key={id}
                    label={RIG_TYPE_LABEL[id]}
                    active={rigTypeFilter.has(id)}
                    onClick={() => toggleRigTypeFilter(id)}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--muted-foreground)]/80">
                Aucune sélection = tous les types.
              </p>
            </div>
          </div>
        </SheetBody>

        {activeFilterCount > 0 && (
          <SheetFooter>
            <button
              onClick={clearAllFilters}
              // arkyo-server: habillage Strata
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent)]/20"
            >
              <X className="h-3.5 w-3.5" />
              Effacer les {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""}
            </button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}

// ── ProjectCard — pattern Supervisor /collaborators ────────────────────────
// Header tinté (titre = nom du projet, sous-titre = client) + badge type de
// régie en haut à droite. Body : lignes "label uppercase" + valeur (LIEU,
// DATES). Footer hover-revealed avec icône supprimer.

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return format(d, "d MMM yyyy", { locale: fr });
}

/**
 * Calcule la string "DATES" affichée en body de la card selon le type
 * d'intervention. PRESTATION → période de tournage. INTÉGRATION → date de
 * mise en service. Fallback → "—" si rien renseigné.
 */
function formatProjectDates(p: ProjectListItem): string {
  if (p.interventionType === "PRESTATION") {
    const start = formatDate(p.shootingDate);
    const end = formatDate(p.shootingEndDate);
    if (start && end && start !== end) return `${start} → ${end}`;
    if (start) return start;
    return "—";
  }
  // INTEGRATION : date de mise en service.
  return formatDate(p.commissioningDate) ?? "—";
}

/** Période de planification formatée (ou "—" si absente). */
function formatPlanning(p: ProjectListItem): string {
  const start = formatDate(p.planningStart);
  const end = formatDate(p.planningEnd);
  if (start && end && start !== end) return `${start} → ${end}`;
  if (start) return start;
  return "—";
}

function ProjectCard({
  project,
  color,
  busy,
  onClick,
  onDelete,
}: {
  project: ProjectListItem;
  color: string;
  busy: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const rigLabel = project.rigType ? RIG_TYPE_LABEL[project.rigType] : null;
  const datesLabel = formatProjectDates(project);
  const planningLabel = formatPlanning(project);
  const keyDatesTitle =
    project.interventionType === "PRESTATION" ? "Période de tournage" : "Mise en service";
  const hasClient = !!project.clientName;
  const clientLabel = project.clientName ?? "Projet interne";
  const description = project.description?.trim();

  return (
    <div
      onClick={onClick}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--card)] transition-colors hover:bg-[var(--secondary)]"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* Header tinté : nom + client + badge régie */}
      <div
        className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3"
        style={{ background: `${color}08` }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold">{project.name}</p>
          <p
            className={cn(
              "mt-0.5 truncate text-[11px]",
              hasClient
                ? "text-[var(--muted-foreground)]"
                : "text-[var(--muted-foreground)]/60 italic",
            )}
          >
            {clientLabel}
          </p>
        </div>
        {rigLabel && (
          <span
            className="shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase"
            style={{
              backgroundColor: "var(--card)",
              borderColor: `${color}40`,
              color,
            }}
          >
            {rigLabel}
          </span>
        )}
      </div>

      {/* Body : infos avec icônes (Lieu / Planification / Dates clés) */}
      <div className="flex flex-col gap-2 border-t border-[var(--border)]/40 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-[var(--foreground)]/80">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <span className="truncate">{project.location ?? "Lieu non précisé"}</span>
        </div>
        <div
          className="flex items-center gap-2 text-[11px]"
          title="Période de planification"
        >
          <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <span className="font-mono text-[var(--muted-foreground)]">{planningLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]" title={keyDatesTitle}>
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <span className="font-mono text-[var(--muted-foreground)]">{datesLabel}</span>
        </div>
        {description && (
          <p className="line-clamp-2 border-t border-[var(--border)]/40 pt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {description}
          </p>
        )}
      </div>

      {/* Suppression au survol — réservée à projects:admin */}
      <IfTenantPerm domain="projects" level="admin">
        <div className="flex items-center justify-end px-3 pb-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={busy}
            title="Supprimer définitivement"
            // arkyo-server: habillage Strata
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)] disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </IfTenantPerm>
    </div>
  );
}

// ── ProjectRow — variant liste compacte (pattern Supervisor TenantRow) ──────

function ProjectRow({
  project,
  color,
  busy,
  onClick,
  onDelete,
}: {
  project: ProjectListItem;
  color: string;
  busy: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const rigLabel = project.rigType ? RIG_TYPE_LABEL[project.rigType] : null;
  const datesLabel = formatProjectDates(project);
  const lieuLabel = project.location ?? "—";

  return (
    <div
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]"
      style={{
        borderTopColor: `${color}20`,
        borderRightColor: `${color}20`,
        borderBottomColor: `${color}20`,
        borderLeftColor: color,
        borderLeftWidth: 3,
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{project.name}</p>
        <p
          className={cn(
            "truncate text-[10px]",
            project.clientName
              ? "text-[var(--muted-foreground)]"
              : "text-[var(--muted-foreground)]/60 italic",
          )}
        >
          {project.clientName ?? "Projet interne"}
        </p>
      </div>
      {rigLabel && (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: `${color}18`, color }}
        >
          {rigLabel}
        </span>
      )}
      <span className="hidden shrink-0 truncate text-[10px] text-[var(--muted-foreground)] md:inline-block md:max-w-[160px]">
        {lieuLabel}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--muted-foreground)] tabular-nums">
        {datesLabel}
      </span>
      <IfTenantPerm domain="projects" level="admin">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={busy}
          title="Supprimer définitivement"
          // arkyo-server: habillage Strata
          className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)] disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </IfTenantPerm>
    </div>
  );
}
