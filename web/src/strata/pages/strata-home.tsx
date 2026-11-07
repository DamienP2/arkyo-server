/**
 * Accueil de l'interface Strata (`/dashboard` en Strata ; le tableau de bord
 * d'arkyo reste celui de l'interface Classique). Spec §6.3, maquette
 * `viewAccueil` :
 *
 * - en-tête : titre, résumé et « Nouveau projet » (l'assistant existant,
 *   `NewProjectDialog`, comme la liste des projets) ;
 * - bandeau : les quatre compteurs du tableau de bord Classique (mêmes calculs,
 *   mêmes données), puis trois cartes : captations à venir, à traiter (projets
 *   actifs dont la fiche technique est incomplète), activité (notifications) ;
 * - « Tous les projets actifs » : recherche, tri, grille de cartes avec
 *   « Concevoir » (`?tab=rack`) et « Livrer » (`?tab=preparation`).
 *
 * Données : `GET /api/projects` et `?stats=tasks` (celles du tableau de bord
 * Classique, obligatoires), `GET /api/tenant/projects` (compteurs de la liste
 * des projets) et `GET /api/notifications?limit=15`. Ces deux dernières sont
 * des compléments : si l'une échoue, l'accueil s'affiche quand même et la
 * donnée manquante est signalée (« — », message), jamais remplacée par 0.
 *
 * Les vignettes de rack de la maquette demandent les racks de chaque projet,
 * que les listes ne donnent pas : la carte montre à la place les compteurs
 * réels du projet (régies, documents, tâches).
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { addDays, format, isAfter, isBefore } from "date-fns";
import { fr } from "date-fns/locale";
import { ClientPage } from "@/components/client-page";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import {
  AlertTriangle,
  Antenna,
  Calendar,
  CalendarDays,
  FolderOpen,
  HardHat,
  History,
  Layers,
  Plus,
  Search,
  Truck,
} from "@/components/ui/icons";
import { IfTenantPerm } from "@/components/ui/tenant-perm-button";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ── Données ──────────────────────────────────────────────────────────────────

type InterventionType = "PRESTATION" | "INTEGRATION";
type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL" | "MIXED";

/** Projet de `GET /api/projects` : forme `DashboardProject` du tableau de bord,
 *  plus les colonnes du projet que la route renvoie aussi. */
type HomeProject = {
  id: string;
  name: string;
  clientName: string | null;
  location: string | null;
  status: string;
  shootingDate: string | null;
  shootingEndDate: string | null;
  commissioningDate: string | null;
  interventionType: InterventionType;
  rigType: RigType | null;
  updatedAt: string;
  technicalSheet: { completionPercent: number } | null;
  _count: { tasks: number };
};

/** `GET /api/projects?stats=tasks`. */
type TaskStat = { status: string; _count: number };

/** Compteurs de `GET /api/tenant/projects` (`ProjectListItem`). */
type ListCounts = { documentsCount: number; rigConfigsCount: number };

/** Notification de `GET /api/notifications` (forme de `NotificationsMenu`). */
type Notif = {
  id: string;
  title: string;
  message: string | null;
  createdAt: string;
};

type HomeData = {
  /** Ordre de l'API : `updatedAt` décroissant. */
  projects: HomeProject[];
  taskStats: TaskStat[];
  /** `null` : liste des projets indisponible. */
  counts: Map<string, ListCounts> | null;
  /** `null` : notifications indisponibles. */
  notifications: Notif[] | null;
};

async function loadHome(): Promise<HomeData> {
  const [projects, taskStats, counts, notifications] = await Promise.all([
    api.get<HomeProject[]>("/api/projects"),
    api.get<TaskStat[]>("/api/projects?stats=tasks"),
    api.get<{ projects: ({ id: string } & ListCounts)[] }>("/api/tenant/projects").then(
      (r) =>
        new Map(
          r.projects.map((p) => [
            p.id,
            { documentsCount: p.documentsCount, rigConfigsCount: p.rigConfigsCount },
          ]),
        ),
      () => null,
    ),
    api.get<{ items?: Notif[] }>("/api/notifications?limit=15").then(
      (r) => r.items ?? [],
      () => null,
    ),
  ]);
  return { projects, taskStats, counts, notifications };
}

// ── Libellés et couleurs métier (ceux du tableau de bord et de la liste) ────

const STATUS_LABEL: Record<string, string> = {
  EN_PREPARATION: "En préparation",
  PRET: "Prêt",
  EN_COURS: "En cours",
  TERMINE: "Terminé",
  ANNULE: "Annulé",
};

// Couleurs de statut (couleur métier) : celles du tableau de bord d'arkyo.
const STATUS_COLOR: Record<string, string> = {
  EN_PREPARATION: "#f59e0b",
  PRET: "#10b981",
  EN_COURS: "#3b82f6",
  TERMINE: "#71717a",
  ANNULE: "#ef4444",
};

const RIG_TYPE_LABEL: Record<RigType, string> = {
  FLIGHT_CASE: "Flight case",
  CAR: "Car régie",
  FIXED_INSTALL: "Installation fixe",
  MIXED: "Mixte",
};

const INACTIVE = ["TERMINE", "ANNULE"];
const DAY = 86_400_000;

// ── Calculs du tableau de bord Classique ─────────────────────────────────────

/** Tri du tableau de bord : date de captation croissante, sans date en dernier. */
function byShooting(projects: HomeProject[]): HomeProject[] {
  const shooting = (p: HomeProject) =>
    p.shootingDate ? new Date(p.shootingDate).getTime() : Number.POSITIVE_INFINITY;
  return [...projects].sort((a, b) => shooting(a) - shooting(b) || 0);
}

/** Les quatre compteurs et les captations à venir, calculés comme le tableau
 *  de bord Classique (`app/(app)/dashboard/page.tsx`). */
function dashboardFigures(byUpdate: HomeProject[], taskStats: TaskStat[], now: Date) {
  const projects = byShooting(byUpdate);
  const soon = addDays(now, 30);
  const activeProjects = projects.filter((p) => !INACTIVE.includes(p.status));
  const upcomingProjects = projects.filter(
    (p) =>
      p.shootingDate &&
      isAfter(new Date(p.shootingDate), now) &&
      isBefore(new Date(p.shootingDate), soon),
  );
  const nextProject = projects.find(
    (p) => p.shootingDate && isAfter(new Date(p.shootingDate), now) && !INACTIVE.includes(p.status),
  );
  const totalTasks = taskStats.reduce((acc, s) => acc + s._count, 0);
  const doneTasks = taskStats
    .filter((s) => ["TERMINE", "VALIDE"].includes(s.status))
    .reduce((acc, s) => acc + s._count, 0);
  const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const avgCompletion =
    projects.length > 0
      ? Math.round(
          projects.reduce((acc, p) => acc + (p.technicalSheet?.completionPercent ?? 0), 0) /
            projects.length,
        )
      : 0;
  return {
    projects,
    activeProjects,
    upcomingProjects,
    nextProject,
    totalTasks,
    doneTasks,
    taskPct,
    avgCompletion,
  };
}

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY);
}

function shortDate(iso: string): string {
  return format(new Date(iso), "d MMM", { locale: fr });
}

/** Date clé d'un projet, comme la liste des projets : période de captation
 *  (Prestation) ou mise en service (Intégration). */
function keyDateLabel(p: HomeProject): string {
  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : format(d, "d MMM yyyy", { locale: fr });
  };
  if (p.interventionType === "INTEGRATION") return fmt(p.commissioningDate) ?? "—";
  const start = fmt(p.shootingDate);
  const end = fmt(p.shootingEndDate);
  if (start && end && start !== end) return `${start} → ${end}`;
  return start ?? "—";
}

/** Horodatage de la date clé (sans date : en dernier). */
function keyDateTime(p: HomeProject): number {
  const iso = p.interventionType === "INTEGRATION" ? p.commissioningDate : p.shootingDate;
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StrataHome() {
  return (
    <ClientPage
      permission={null}
      icon={<FolderOpen strokeWidth={1.5} />}
      fallbackError="Impossible de charger le tableau de bord."
      load={loadHome}
    >
      {(data) => <HomeContent data={data} />}
    </ClientPage>
  );
}

function HomeContent({ data }: { data: HomeData }) {
  const now = new Date();
  const f = dashboardFigures(data.projects, data.taskStats, now);
  const [newOpen, setNewOpen] = useState(false);

  const weekCount = f.upcomingProjects.filter((p) => daysUntil(p.shootingDate!, now) <= 7).length;

  // À traiter : projets actifs dont la fiche technique est incomplète,
  // captation la plus proche d'abord (ordre du tableau de bord).
  const toProcess = f.activeProjects
    .filter((p) => (p.technicalSheet?.completionPercent ?? 0) < 100)
    .slice(0, 3);

  // Assistant de création : mêmes aides que la liste des projets.
  const knownClients = useMemo(() => {
    const seen = new Set<string>();
    for (const p of data.projects) if (p.clientName?.trim()) seen.add(p.clientName.trim());
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "fr"));
  }, [data.projects]);
  const existingNames = useMemo(
    () => data.projects.map((p) => p.name).filter(Boolean),
    [data.projects],
  );

  const openNew = () => setNewOpen(true);

  return (
    <>
      <div className="flex max-w-[1480px] flex-col gap-[18px] p-6">
        {/* En-tête */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-[var(--foreground)]">
              Tableau de bord
            </h1>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {plural(f.activeProjects.length, "projet actif", "projets actifs")} ·{" "}
              {plural(weekCount, "captation", "captations")} dans les 7 jours
            </p>
          </div>
          <IfTenantPerm domain="projects" level="write">
            <NewProjectButton onClick={openNew} />
          </IfTenantPerm>
        </div>

        {/* Bandeau */}
        <section aria-label="Bandeau" className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] lg:grid-cols-4">
            <Counter
              label="Projets actifs"
              value={f.activeProjects.length}
              sub={`sur ${f.projects.length} au total`}
            />
            <Counter
              label="Tâches complétées"
              value={`${f.doneTasks}/${f.totalTasks}`}
              sub={`${f.taskPct}% d'avancement`}
            />
            <Counter label="Complétion moyenne" value={`${f.avgCompletion}%`} sub="fiches techniques" />
            <Counter
              label="Prochaine captation"
              value={f.nextProject?.shootingDate ? shortDate(f.nextProject.shootingDate) : "—"}
              sub={f.nextProject?.name ?? "Aucune planifiée"}
            />
          </div>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
            <BandCard title="Captations à venir" icon={<CalendarDays className="h-3.5 w-3.5" />}>
              {f.upcomingProjects.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays strokeWidth={1.5} />}
                  title="Aucune captation planifiée"
                  description="Aucun projet n'est programmé dans les 30 prochains jours."
                  className="py-6"
                />
              ) : (
                f.upcomingProjects.slice(0, 3).map((p) => (
                  <BandRow key={p.id} href={`/project/${p.id}`} className="grid-cols-[56px_minmax(0,1fr)]">
                    <span className="font-mono text-xs text-[var(--muted-foreground)] tabular-nums">
                      {shortDate(p.shootingDate!)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--foreground)] group-hover:text-[var(--accent-strong)]">{p.name}</span>
                      <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                        J-{daysUntil(p.shootingDate!, now)} · {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </span>
                  </BandRow>
                ))
              )}
            </BandCard>

            <BandCard title="À traiter" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {toProcess.length === 0 ? (
                <EmptyState
                  icon={<AlertTriangle strokeWidth={1.5} />}
                  title="Rien à traiter"
                  description="Les fiches techniques des projets actifs sont complètes."
                  className="py-6"
                />
              ) : (
                toProcess.map((p) => {
                  const days = p.shootingDate ? daysUntil(p.shootingDate, now) : null;
                  const urgent = days !== null && days >= 0 && days <= 7;
                  return (
                    <BandRow key={p.id} href={`/project/${p.id}`} className="grid-cols-[10px_minmax(0,1fr)]">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: urgent ? "var(--danger)" : "var(--warning)" }}
                      />
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-[var(--foreground)] group-hover:text-[var(--accent-strong)]">{p.name}</span>{" "}
                        <span className="text-[var(--muted-foreground)]">
                          Fiche technique à {Math.round(p.technicalSheet?.completionPercent ?? 0)} %
                          {urgent ? `, captation J-${days}` : ""}
                        </span>
                      </span>
                    </BandRow>
                  );
                })
              )}
            </BandCard>

            <BandCard title="Activité" icon={<History className="h-3.5 w-3.5" />}>
              {data.notifications === null ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                  Impossible de charger l'activité.
                </p>
              ) : data.notifications.length === 0 ? (
                <EmptyState
                  icon={<History strokeWidth={1.5} />}
                  title="Aucune activité"
                  description="Les notifications de l'espace s'afficheront ici."
                  className="py-6"
                />
              ) : (
                data.notifications.slice(0, 3).map((n) => (
                  <div
                    key={n.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-[var(--border)] py-2 text-[12.5px] last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--foreground)]">{n.title}</span>
                      {n.message && (
                        <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                          {n.message}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                      {format(new Date(n.createdAt), "d MMM HH:mm", { locale: fr })}
                    </span>
                  </div>
                ))
              )}
            </BandCard>
          </div>
        </section>

        <ProjectsSection active={f.activeProjects} counts={data.counts} onNew={openNew} />
      </div>

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        interventionType="PRESTATION"
        knownClients={knownClients}
        existingNames={existingNames}
      />
    </>
  );
}

function NewProjectButton({ onClick }: { onClick: () => void }) {
  // Règle arkyo : bouton d'ajout en pointillés, jamais plein.
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border-2 border-dashed border-[var(--border-strong)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
    >
      <Plus className="h-3.5 w-3.5" />
      Nouveau projet
    </button>
  );
}

function Counter({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1 bg-[var(--surface)] px-4 py-3">
      <span className="text-[11px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      <p className="text-[22px] leading-none font-bold text-[var(--foreground)] tabular-nums">{value}</p>
      <p className="truncate text-xs text-[var(--muted-foreground)]">{sub}</p>
    </div>
  );
}

function BandCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5 py-2.5 text-[var(--muted-foreground)]">
        {icon}
        <h3 className="flex-1 text-[12.5px] font-semibold text-[var(--foreground)]">{title}</h3>
      </header>
      <div className="flex flex-col px-3.5 pt-1 pb-2">{children}</div>
    </section>
  );
}

function BandRow({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "group grid items-center gap-2.5 border-b border-[var(--border)] py-2 text-[12.5px] last:border-b-0",
        className,
      )}
    >
      {children}
    </Link>
  );
}

// ── Grille des projets ───────────────────────────────────────────────────────

type SortKey = "recent" | "name" | "date";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "Récents" },
  { id: "name", label: "Nom" },
  { id: "date", label: "Date" },
];

function ProjectsSection({
  active,
  counts,
  onNew,
}: {
  active: HomeProject[];
  counts: Map<string, ListCounts> | null;
  onNew: () => void;
}) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = active.filter(
      (p) => !q || [p.name, p.clientName, p.location].some((v) => v?.toLowerCase().includes(q)),
    );
    if (sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (sort === "date") return list.sort((a, b) => keyDateTime(a) - keyDateTime(b) || 0);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [active, search, sort]);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3.5">
      <div className="flex items-baseline gap-2.5">
        <h2 id={titleId} className="text-sm font-semibold text-[var(--foreground)]">
          Tous les projets actifs
        </h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {plural(active.length, "projet", "projets")}
        </span>
      </div>

      {active.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={<FolderOpen strokeWidth={1.5} />}
            title="Aucun projet actif"
            description="Lancez un nouveau projet pour commencer à organiser votre production."
            action={
              <IfTenantPerm domain="projects" level="write">
                <EmptyStateAction onClick={onNew}>
                  <Plus className="h-3.5 w-3.5" />
                  Nouveau projet
                </EmptyStateAction>
              </IfTenantPerm>
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-[280px] max-w-full">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher des projets"
                aria-label="Rechercher des projets"
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pr-2.5 pl-8 text-xs text-[var(--foreground)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ring)] focus:outline-none"
              />
            </div>
            <div className="flex-1" />
            <span className="text-xs text-[var(--text-tertiary)]">Trier</span>
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={sort === s.id}
                  onClick={() => setSort(s.id)}
                  className={cn(
                    "rounded px-2.5 py-[3px] text-xs whitespace-nowrap transition-colors",
                    sort === s.id
                      ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={<Search strokeWidth={1.5} />}
              title="Aucun résultat"
              description="Aucun projet ne correspond à cette recherche."
              className="py-12"
            />
          ) : (
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
            >
              {shown.map((p) => (
                <ProjectCard key={p.id} project={p} counts={counts?.get(p.id) ?? null} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProjectCard({ project: p, counts }: { project: HomeProject; counts: ListCounts | null }) {
  const completion = Math.round(p.technicalSheet?.completionPercent ?? 0);
  const integration = p.interventionType === "INTEGRATION";
  const KindIcon = integration ? HardHat : Antenna;
  const specs = [p.rigType ? RIG_TYPE_LABEL[p.rigType] : null, p.location].filter(Boolean).join(" · ");
  const statusColor = STATUS_COLOR[p.status] ?? "var(--muted-foreground)";

  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {/* Visuel : type, statut et compteurs du projet */}
      <div className="relative flex h-[132px] items-end justify-center gap-8 rounded-t-lg border-b border-[var(--border)] bg-[var(--muted)] px-3.5 pb-4">
        <span className="absolute top-2.5 left-3 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
          <KindIcon className="h-3.5 w-3.5" />
          {integration ? "Intégration" : "Prestation"}
        </span>
        <span className="absolute top-2 right-2.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--muted-foreground)]">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: statusColor }} />
          {STATUS_LABEL[p.status] ?? p.status}
        </span>
        <Figure label="Régies" value={counts?.rigConfigsCount} />
        <Figure label="Documents" value={counts?.documentsCount} />
        <Figure label="Tâches" value={p._count.tasks} />
      </div>

      <div className="flex flex-col gap-2 px-3.5 py-3">
        <div>
          <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{p.name}</h3>
          <p
            className={cn(
              "truncate text-xs",
              p.clientName ? "text-[var(--muted-foreground)]" : "text-[var(--text-tertiary)] italic",
            )}
          >
            {p.clientName ?? "Projet interne"}
          </p>
        </div>
        {specs && <p className="truncate text-xs text-[var(--muted-foreground)]">{specs}</p>}
        <div className="flex items-center gap-2 text-[11.5px] text-[var(--muted-foreground)]">
          <span>Fiche</span>
          <div
            role="meter"
            aria-label="Fiche technique"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion}
            className="h-1 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
          >
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${completion}%` }} />
          </div>
          <span className="tabular-nums">{completion} %</span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{keyDateLabel(p)}</span>
        </p>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 px-3.5 pb-3.5">
        <CardAction href={`/project/${p.id}?tab=rack`} icon={<Layers className="h-3.5 w-3.5" />}>
          Concevoir
        </CardAction>
        <CardAction href={`/project/${p.id}?tab=preparation`} icon={<Truck className="h-3.5 w-3.5" />}>
          Livrer
        </CardAction>
      </div>
    </article>
  );
}

/** Compteur du visuel ; `undefined` : donnée indisponible (« — »). */
function Figure({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col items-center gap-0.5">
      <span className="text-[22px] leading-none font-bold text-[var(--foreground)] tabular-nums">
        {value ?? "—"}
      </span>
      <span className="text-[11px] text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}

function CardAction({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--muted)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
    >
      {icon}
      {children}
    </Link>
  );
}
