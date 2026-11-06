// arkyo-server: `auth()` / `requireTenantDb()` (serveur) remplacés par la session
// du shim next-auth et un chargement client via l'API (`ClientPage`).
import { useSession } from "next-auth/react";
import { ClientPage } from "@/components/client-page";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import {
  FolderOpen,
  CalendarDays,
  MapPin,
  CheckSquare,
  Clock,
  TrendingUp,
  ArrowRight,
  Plus,
  Activity,
} from "@/components/ui/icons";
import Link from "next/link";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  EN_PREPARATION: "En préparation",
  PRET: "Prêt",
  EN_COURS: "En cours",
  TERMINE: "Terminé",
  ANNULE: "Annulé",
};

const STATUS_COLOR: Record<string, string> = {
  EN_PREPARATION: "#f59e0b",
  PRET: "#10b981",
  EN_COURS: "#3b82f6",
  TERMINE: "#71717a",
  ANNULE: "#ef4444",
};

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${color}18` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
      <div>
        <p className="text-3xl leading-none font-bold text-[var(--foreground)]">{value}</p>
        {sub && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{sub}</p>}
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{label}</p>
      </div>
    </div>
  );
}

// arkyo-server: le Server Component devient une page client. `ClientPage`
// (session seule, comme `auth()` d'arkyo) charge les données (`loadDashboard`,
// en bas du fichier) avec `<LoadingState>`, puis une erreur avec « Réessayer » ;
// `DashboardContent` garde le rendu d'arkyo.
export default function DashboardPage() {
  return (
    <ClientPage
      permission={null}
      icon={<FolderOpen strokeWidth={1.5} />}
      fallbackError="Impossible de charger le tableau de bord."
      load={loadDashboard}
    >
      {(data) => <DashboardContent data={data} />}
    </ClientPage>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  const { data: session } = useSession(); // arkyo-server: session du shim next-auth
  // arkyo-server: requêtes Prisma remplacées par `loadDashboard`.
  const [projects, taskStats, recentActivity] = data;

  const now = new Date();
  const soon = addDays(now, 30);

  const activeProjects = projects.filter((p) => !["TERMINE", "ANNULE"].includes(p.status));
  const upcomingProjects = projects
    .filter(
      (p) =>
        p.shootingDate &&
        isAfter(new Date(p.shootingDate), now) &&
        isBefore(new Date(p.shootingDate), soon),
    )
    .slice(0, 5);
  const nextProject = projects.find(
    (p) =>
      p.shootingDate &&
      isAfter(new Date(p.shootingDate), now) &&
      !["TERMINE", "ANNULE"].includes(p.status),
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

  const firstName = session?.user?.name?.split(" ")[0] ?? null;
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

  return (
    <div className="flex h-full flex-col">
      {/* ── En-tête dashboard ── */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-8 py-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {greeting}
            {firstName ? `, ${firstName}` : ""}&nbsp;👋
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)] capitalize">
            {format(now, "EEEE d MMMM yyyy", { locale: fr })}
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouveau projet
        </Link>
      </div>

      {/* ── Corps scrollable ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-6 p-8">
          {/* ── Colonne principale (8/12) ── */}
          <div className="col-span-12 flex flex-col gap-6 xl:col-span-8">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard
                label="Projets actifs"
                value={activeProjects.length}
                sub={`sur ${projects.length} au total`}
                icon={FolderOpen}
                color="#3b82f6"
              />
              <StatCard
                label="Tâches complétées"
                value={`${doneTasks}/${totalTasks}`}
                sub={`${taskPct}% d'avancement`}
                icon={CheckSquare}
                color="#10b981"
              />
              <StatCard
                label="Complétion moyenne"
                value={`${avgCompletion}%`}
                sub="fiches techniques"
                icon={TrendingUp}
                color="#8b5cf6"
              />
              <StatCard
                label="Prochaine captation"
                value={
                  nextProject?.shootingDate
                    ? format(new Date(nextProject.shootingDate), "d MMM", { locale: fr })
                    : "—"
                }
                sub={nextProject?.name ?? "Aucune planifiée"}
                icon={CalendarDays}
                color="#f59e0b"
              />
            </div>

            {/* Projets à venir */}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Projets à venir — 30 jours
                </h3>
                <Link
                  href="/projects"
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  Voir tout <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {upcomingProjects.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays strokeWidth={1.5} />}
                  title="Aucune captation planifiée"
                  description="Aucun projet n'est programmé dans les 30 prochains jours."
                  className="py-12"
                />
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {upcomingProjects.map((project) => {
                    const completion = project.technicalSheet?.completionPercent ?? 0;
                    const daysLeft = project.shootingDate
                      ? Math.ceil(
                          (new Date(project.shootingDate).getTime() - now.getTime()) / 86400000,
                        )
                      : null;
                    return (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="group flex items-center gap-5 px-5 py-3.5 transition-colors hover:bg-[var(--secondary)]"
                      >
                        {/* Indicateur statut */}
                        <div
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[project.status] }}
                        />

                        {/* Infos */}
                        <div className="min-w-0 flex-1">
                          {/* arkyo-server: habillage Strata (texte d'accent sur le survol --secondary) */}
                          <p className="truncate text-sm font-medium text-[var(--foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                            {project.name}
                          </p>
                          <div className="mt-0.5 flex items-center gap-3">
                            {project.clientName && (
                              <span className="text-xs text-[var(--muted-foreground)]">
                                {project.clientName}
                              </span>
                            )}
                            {project.location && (
                              <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                                <MapPin className="h-3 w-3" />
                                {project.location}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Progression */}
                        <div className="w-28 shrink-0">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] text-[var(--muted-foreground)]">
                              Fiche
                            </span>
                            <span className="text-[11px] font-medium text-[var(--foreground)]">
                              {Math.round(completion)}%
                            </span>
                          </div>
                          <Progress value={completion} className="h-1.5" />
                        </div>

                        {/* Jours restants */}
                        {daysLeft !== null && (
                          <div
                            className={cn(
                              "min-w-[56px] shrink-0 text-right",
                              daysLeft <= 7
                                ? "text-[var(--danger-text)]" // arkyo-server: habillage Strata
                                : daysLeft <= 14
                                  ? "text-[var(--warning-text)]" // arkyo-server: habillage Strata
                                  : "text-[var(--muted-foreground)]",
                            )}
                          >
                            <p className="text-base leading-none font-bold">{daysLeft}j</p>
                            <p className="mt-0.5 text-[10px]">restants</p>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tous les projets actifs */}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Tous les projets actifs
                </h3>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {activeProjects.length} projets
                </span>
              </div>
              {activeProjects.length === 0 ? (
                <EmptyState
                  icon={<FolderOpen strokeWidth={1.5} />}
                  title="Aucun projet actif"
                  description="Lancez un nouveau projet pour commencer à organiser votre production."
                  action={
                    <Link
                      href="/projects"
                      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Nouveau projet
                    </Link>
                  }
                  className="py-12"
                />
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {activeProjects.map((project) => {
                    const completion = project.technicalSheet?.completionPercent ?? 0;
                    return (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-[var(--secondary)]"
                      >
                        <div
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[project.status] }}
                        />
                        <div className="min-w-0 flex-1">
                          {/* arkyo-server: habillage Strata (texte d'accent sur le survol --secondary) */}
                          <p className="truncate text-sm font-medium text-[var(--foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                            {project.name}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[11px]"
                          style={{
                            color: STATUS_COLOR[project.status],
                            borderColor: `${STATUS_COLOR[project.status]}40`,
                          }}
                        >
                          {STATUS_LABEL[project.status]}
                        </Badge>
                        <div className="w-24 shrink-0">
                          <Progress value={completion} className="h-1" />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs text-[var(--muted-foreground)]">
                          {Math.round(completion)}%
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Colonne latérale (4/12) ── */}
          <div className="col-span-12 flex flex-col gap-6 xl:col-span-4">
            {/* Activité récente */}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Activité récente</h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {recentActivity.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[var(--secondary)]"
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]">
                      <Activity className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--foreground)]">
                        {project.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{"—"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                      <Clock className="h-3 w-3" />
                      {format(new Date(project.updatedAt), "d MMM", { locale: fr })}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Répartition par statut */}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Répartition des projets
                </h3>
              </div>
              <div className="flex flex-col gap-3 p-5">
                {Object.entries(STATUS_LABEL).map(([key, label]) => {
                  const count = projects.filter((p) => p.status === key).length;
                  const pct = projects.length > 0 ? (count / projects.length) * 100 : 0;
                  if (count === 0) return null;
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
                        <span className="text-xs font-semibold text-[var(--foreground)]">
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: STATUS_COLOR[key] }}
                        />
                      </div>
                    </div>
                  );
                })}
                {projects.length === 0 && (
                  <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">
                    Aucun projet
                  </p>
                )}
              </div>
            </div>

            {/* Accès rapide */}
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Accès rapide</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3">
                {[
                  { href: "/projects", label: "Projets", icon: FolderOpen, color: "#3b82f6" },
                  {
                    href: "/templates?tab=rigs",
                    label: "Régies",
                    icon: Activity,
                    color: "#8b5cf6",
                  },
                  {
                    href: "/templates?tab=racks",
                    label: "Racks",
                    icon: CheckSquare,
                    color: "#10b981",
                  },
                  {
                    href: "/templates?tab=panels",
                    label: "Panels",
                    icon: TrendingUp,
                    color: "#f59e0b",
                  },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--secondary)]"
                  >
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `${item.color}18` }}
                    >
                      <item.icon className="h-3.5 w-3.5" style={{ color: item.color }} />
                    </div>
                    <span className="text-xs font-medium text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--foreground)]">
                      {item.label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// arkyo-server: données de la page serveur d'arkyo, lues par l'API.

/** Projet de `GET /api/projects` (Prisma `include` de la page d'arkyo). */
type DashboardProject = {
  id: string;
  name: string;
  clientName: string | null;
  location: string | null;
  status: string;
  shootingDate: string | null;
  updatedAt: string;
  technicalSheet: { completionPercent: number } | null;
  _count: { tasks: number };
};

/** `task.groupBy({ by: ["status"], _count: true })` (`?stats=tasks`). */
type TaskStat = { status: string; _count: number };

type DashboardData = [DashboardProject[], TaskStat[], DashboardProject[]];

/**
 * Les trois requêtes de la page d'arkyo :
 * - `project.findMany({ orderBy: { shootingDate: "asc" }, include })` : la liste
 *   de `GET /api/projects` (updatedAt desc), retriée ici par date de captation
 *   croissante, sans date en dernier (`ASC` de PostgreSQL : NULLS LAST) ;
 * - `task.groupBy` : `GET /api/projects?stats=tasks` ;
 * - `project.findMany({ orderBy: { updatedAt: "desc" }, take: 5 })` : les cinq
 *   premiers de la même liste.
 */
async function loadDashboard(): Promise<DashboardData> {
  const [byUpdate, taskStats] = await Promise.all([
    api.get<DashboardProject[]>("/api/projects"),
    api.get<TaskStat[]>("/api/projects?stats=tasks"),
  ]);
  const shooting = (p: DashboardProject) =>
    p.shootingDate ? new Date(p.shootingDate).getTime() : Number.POSITIVE_INFINITY;
  const projects = [...byUpdate].sort((a, b) => shooting(a) - shooting(b) || 0); // deux sans date : NaN → égaux
  return [projects, taskStats, byUpdate.slice(0, 5)];
}
