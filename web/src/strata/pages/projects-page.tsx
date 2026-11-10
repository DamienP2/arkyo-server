/**
 * Page « Projets » de l'interface Strata v2 (`/dashboard` et `/projects` en
 * Strata ; spec v2 §4.3, maquette `viewAccueil`). En Classique, ces URL
 * restent le tableau de bord et la liste des projets d'arkyo.
 *
 * - En-tête : titre, résumé et « Nouveau projet » (l'assistant existant,
 *   `NewProjectDialog`, en pointillés).
 * - Compteurs : les quatre du tableau de bord Classique (mêmes calculs, mêmes
 *   données).
 * - Liste « Tous les projets » : avancement (complétion de la fiche
 *   technique), date clé, statut, équipe ; filtres Prestation / Intégration
 *   (ceux du rail Classique : sur `/projects`, ils suivent `?tab=`), statut,
 *   recherche, tri.
 * - Détail du projet sélectionné : résumé, compteurs, alertes connues,
 *   « Ouvrir dans Concevoir » (`?tab=synoptique`), « Ouvrir dans Gérer »
 *   (`?space=gerer`), suppression (`projects:admin`, comme la
 *   liste Classique). Sans sélection : captations à venir.
 *
 * Données : `GET /api/projects` et `?stats=tasks` (celles du tableau de bord
 * Classique, obligatoires), `GET /api/tenant/projects` (compteurs de la liste
 * Classique) et `GET /api/tenant/members?inactive=1` (créateur du projet). Ces deux
 * dernières sont des compléments : si l'une échoue, la page s'affiche et la
 * donnée manquante vaut « — », jamais 0.
 *
 * Équipe : arkyo n'a pas d'équipe par projet ; la colonne montre son créateur
 * (`createdById`), seul membre qu'un projet désigne.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, format, isAfter, isBefore } from "date-fns";
import { fr } from "date-fns/locale";
import { ClientPage } from "@/components/client-page";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import {
  AlertTriangle,
  CalendarDays,
  FolderOpen,
  LayoutList,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
} from "@/components/ui/icons";
import { IfTenantPerm } from "@/components/ui/tenant-perm-button";
import { useToast } from "@/components/ui/toast";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { useTenantMembership } from "@/lib/tenant-membership-context";
import { cn } from "@/lib/utils";

// ── Données ──────────────────────────────────────────────────────────────────

type InterventionType = "PRESTATION" | "INTEGRATION";
type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL" | "MIXED";

/** Projet de `GET /api/projects` : forme `DashboardProject` du tableau de bord,
 *  plus les colonnes du projet que la route renvoie aussi. */
type StrataProject = {
  id: string;
  name: string;
  clientName: string | null;
  location: string | null;
  description: string | null;
  status: string;
  shootingDate: string | null;
  shootingEndDate: string | null;
  planningStart: string | null;
  planningEnd: string | null;
  commissioningDate: string | null;
  interventionType: InterventionType;
  rigType: RigType | null;
  createdById: string;
  updatedAt: string;
  technicalSheet: { completionPercent: number } | null;
  _count: { tasks: number };
};

/** `GET /api/projects?stats=tasks`. */
type TaskStat = { status: string; _count: number };

/** Compteurs de `GET /api/tenant/projects` (`ProjectListItem`). */
type ListCounts = { documentsCount: number; rigConfigsCount: number };

/** Membre de `GET /api/tenant/members` (champs utilisés). */
type Member = { id: string; name: string | null; email: string };

type PageData = {
  /** Ordre de l'API : `updatedAt` décroissant. */
  projects: StrataProject[];
  taskStats: TaskStat[];
  /** `null` : liste des projets indisponible. */
  counts: Map<string, ListCounts> | null;
  /** `null` : membres indisponibles. */
  members: Map<string, Member> | null;
};

async function loadProjects(): Promise<PageData> {
  const [projects, taskStats, counts, members] = await Promise.all([
    api.get<StrataProject[]>("/api/projects"),
    api.get<TaskStat[]>("/api/projects?stats=tasks"),
    api.get<{ projects: ({ id: string } & ListCounts)[] }>("/api/tenant/projects").then(
      (r) =>
        new Map(
          r.projects.map((p) => [p.id, { documentsCount: p.documentsCount, rigConfigsCount: p.rigConfigsCount }]),
        ),
      () => null,
    ),
    // `?inactive=1` : un créateur désactivé reste nommé.
    api.get<Member[]>("/api/tenant/members?inactive=1").then(
      (r) => new Map(r.map((m) => [m.id, m])),
      () => null,
    ),
  ]);
  return { projects, taskStats, counts, members };
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
function byShooting(projects: StrataProject[]): StrataProject[] {
  const shooting = (p: StrataProject) =>
    p.shootingDate ? new Date(p.shootingDate).getTime() : Number.POSITIVE_INFINITY;
  return [...projects].sort((a, b) => shooting(a) - shooting(b) || 0);
}

/** Les quatre compteurs et les captations à venir, calculés comme le tableau
 *  de bord Classique (`app/(app)/dashboard/page.tsx`). */
function dashboardFigures(byUpdate: StrataProject[], taskStats: TaskStat[], now: Date) {
  const projects = byShooting(byUpdate);
  const soon = addDays(now, 30);
  const activeProjects = projects.filter((p) => !INACTIVE.includes(p.status));
  const upcomingProjects = projects.filter(
    (p) => p.shootingDate && isAfter(new Date(p.shootingDate), now) && isBefore(new Date(p.shootingDate), soon),
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
          projects.reduce((acc, p) => acc + (p.technicalSheet?.completionPercent ?? 0), 0) / projects.length,
        )
      : 0;
  return { projects, activeProjects, upcomingProjects, nextProject, totalTasks, doneTasks, taskPct, avgCompletion };
}

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY);
}

function fmtDate(iso: string | null, pattern = "d MMM yyyy"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : format(d, pattern, { locale: fr });
}

/** Date clé d'un projet, comme la liste des projets : période de captation
 *  (Prestation) ou mise en service (Intégration). */
function keyDateLabel(p: StrataProject): string {
  if (p.interventionType === "INTEGRATION") return fmtDate(p.commissioningDate) ?? "—";
  const start = fmtDate(p.shootingDate);
  const end = fmtDate(p.shootingEndDate);
  if (start && end && start !== end) return `${start} → ${end}`;
  return start ?? "—";
}

/** Horodatage ISO de la date clé. */
function keyDateIso(p: StrataProject): string | null {
  return p.interventionType === "INTEGRATION" ? p.commissioningDate : p.shootingDate;
}

/** Horodatage de la date clé (sans date : en dernier). */
function keyDateTime(p: StrataProject): number {
  const iso = keyDateIso(p);
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function planningLabel(p: StrataProject): string {
  const start = fmtDate(p.planningStart);
  const end = fmtDate(p.planningEnd);
  if (start && end) return start === end ? start : `${start} → ${end}`;
  return start ?? end ?? "—";
}

const completionOf = (p: StrataProject) => Math.round(p.technicalSheet?.completionPercent ?? 0);

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Nom affiché d'un membre : son nom, sinon son e-mail. */
const memberLabel = (m: Member) => m.name?.trim() || m.email;

/** Initiales d'un membre (« Damien Perpignan » → « DP »). */
function initials(m: Member): string {
  const words = memberLabel(m).split(/[\s@._-]+/).filter(Boolean);
  const name = m.name?.trim() ? words.slice(0, 2) : words.slice(0, 1);
  return name.map((w) => w.charAt(0).toLocaleUpperCase("fr-FR")).join("");
}

/** Alertes connues d'un projet, tirées des données de la liste. */
function alertsOf(p: StrataProject, now: Date): { text: string; level: "warning" | "danger" }[] {
  const out: { text: string; level: "warning" | "danger" }[] = [];
  if (INACTIVE.includes(p.status)) return out;
  const iso = keyDateIso(p);
  const days = iso ? daysUntil(iso, now) : null;
  const urgent = days !== null && days >= 0 && days <= 7;
  const completion = completionOf(p);
  if (completion < 100) {
    out.push({ text: `Fiche technique à ${completion} %`, level: urgent ? "danger" : "warning" });
  }
  if (urgent) {
    const what = p.interventionType === "INTEGRATION" ? "Mise en service" : "Captation";
    out.push({ text: `${what} J-${days}`, level: "warning" });
  }
  return out;
}

// ── Filtres et tri ───────────────────────────────────────────────────────────

type Kind = "tous" | "prestation" | "integration";
const KINDS: { id: Kind; label: string }[] = [
  { id: "tous", label: "Tous" },
  { id: "prestation", label: "Prestation" },
  { id: "integration", label: "Intégration" },
];
const kindOf = (tab: string | null): Kind => (tab === "prestation" || tab === "integration" ? tab : "tous");

type SortKey = "date" | "nom" | "avancement";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "nom", label: "Nom" },
  { id: "avancement", label: "Avancement" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

const PROJECTS_READ = ["projects", "read"] as const;

export default function ProjectsPage() {
  const pathname = usePathname();
  return (
    <ClientPage
      // `/projects` garde la permission de la liste Classique ; `/dashboard`, la session seule.
      permission={pathname === "/projects" ? PROJECTS_READ : null}
      icon={<FolderOpen strokeWidth={1.5} />}
      fallbackError="Impossible de charger les projets."
      load={loadProjects}
    >
      {(data) => <ProjectsContent data={data} />}
    </ClientPage>
  );
}

function ProjectsContent({ data }: { data: PageData }) {
  const now = new Date();
  const { tenantName } = useTenantMembership();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const listTitleId = useId();

  // Type d'intervention : sur `/projects`, l'URL (`?tab=`, comme le rail
  // Classique) ; sur `/dashboard`, un état local (la page n'est pas remontée).
  const onProjects = pathname === "/projects";
  const [localKind, setLocalKind] = useState<Kind>("tous");
  const kind = onProjects ? kindOf(searchParams.get("tab")) : localKind;
  const setKind = (k: Kind) => {
    if (onProjects) router.replace(k === "tous" ? "/projects" : `/projects?tab=${k}`);
    else setLocalKind(k);
  };

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [newOpen, setNewOpen] = useState(false);

  const projects = useMemo(() => data.projects.filter((p) => !removed.has(p.id)), [data.projects, removed]);
  // Compteurs sur la liste à jour : un projet supprimé n'y compte plus.
  const f = dashboardFigures(projects, data.taskStats, now);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter(
      (p) =>
        (kind === "tous" || p.interventionType === kind.toUpperCase()) &&
        (!status || p.status === status) &&
        (!q || [p.name, p.clientName, p.location].some((v) => v?.toLowerCase().includes(q))),
    );
    const byName = (a: StrataProject, b: StrataProject) => a.name.localeCompare(b.name, "fr");
    if (sort === "nom") return list.sort(byName);
    if (sort === "avancement")
      return list.sort((a, b) => (b.technicalSheet?.completionPercent ?? 0) - (a.technicalSheet?.completionPercent ?? 0) || byName(a, b));
    return list.sort((a, b) => keyDateTime(a) - keyDateTime(b) || byName(a, b));
  }, [projects, kind, status, search, sort]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Assistant de création : mêmes aides que la liste des projets.
  const knownClients = useMemo(() => {
    const seen = new Set<string>();
    for (const p of data.projects) if (p.clientName?.trim()) seen.add(p.clientName.trim());
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "fr"));
  }, [data.projects]);
  const existingNames = useMemo(() => data.projects.map((p) => p.name).filter(Boolean), [data.projects]);

  const openNew = () => setNewOpen(true);

  const remove = async (p: StrataProject) => {
    // Même confirmation et même route que la liste Classique.
    const ok = await confirm({
      title: `Supprimer « ${p.name} » ?`,
      description:
        "Le projet et toutes ses données associées (contenants, équipements, documents) seront supprimés définitivement.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/projects/${p.id}`);
      setRemoved((prev) => new Set(prev).add(p.id));
      setSelectedId(null);
      // Relecture silencieuse (`ClientPage`) : les statistiques de tâches suivent.
      router.refresh();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  const site = tenantName?.trim();
  const today = format(now, "EEEE d MMM yyyy", { locale: fr });

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-[18px] px-7 pt-6 pb-16">
        {/* En-tête */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-[var(--foreground)]">
              Projets
            </h1>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {[site, plural(projects.length, "projet", "projets"), today].filter(Boolean).join(" · ")}
            </p>
          </div>
          <IfTenantPerm domain="projects" level="write">
            <NewProjectButton onClick={openNew} />
          </IfTenantPerm>
        </div>

        {/* Compteurs du tableau de bord Classique */}
        <section aria-label="Compteurs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Counter label="Projets actifs" value={f.activeProjects.length} sub={`sur ${f.projects.length} au total`} />
          <Counter label="Tâches complétées" value={`${f.doneTasks}/${f.totalTasks}`} sub={`${f.taskPct}% d'avancement`} />
          <Counter label="Complétion moyenne" value={`${f.avgCompletion}%`} sub="fiches techniques" />
          <Counter
            label="Prochaine captation"
            value={f.nextProject?.shootingDate ? fmtDate(f.nextProject.shootingDate, "d MMM")! : "—"}
            sub={f.nextProject?.name ?? "Aucune planifiée"}
          />
        </section>

        <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* Liste */}
          <section aria-labelledby={listTitleId} className={BOX}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
              <h3 id={listTitleId} className="mr-auto text-[13px] font-bold text-[var(--foreground)]">
                Tous les projets
              </h3>
              <div className="relative w-[200px] max-w-full">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer"
                  aria-label="Rechercher des projets"
                  className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pr-2.5 pl-8 text-xs text-[var(--foreground)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ring)] focus:outline-none"
                />
              </div>
              <Segmented label="Type d'intervention" options={KINDS} value={kind} onChange={setKind} />
              <select
                aria-label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--foreground)] focus:border-[var(--ring)] focus:outline-none"
              >
                <option value="">Tous les statuts</option>
                {Object.entries(STATUS_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <Segmented label="Tri" options={SORTS} value={sort} onChange={setSort} />
            </header>

            {projects.length === 0 ? (
              <EmptyState
                icon={<FolderOpen strokeWidth={1.5} />}
                title="Aucun projet"
                description="Lancez un nouveau projet pour commencer à organiser votre production."
                action={
                  <IfTenantPerm domain="projects" level="write">
                    <EmptyStateAction onClick={openNew}>
                      <Plus className="h-3.5 w-3.5" />
                      Nouveau projet
                    </EmptyStateAction>
                  </IfTenantPerm>
                }
                className="py-12"
              />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<Search strokeWidth={1.5} />}
                title="Aucun résultat"
                description="Aucun projet ne correspond à ces filtres."
                className="py-12"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {["Projet", "Date", "Avancement", "Équipe", "Statut"].map((h) => (
                        <th
                          key={h}
                          className="border-b border-[var(--border)] px-2.5 py-2 text-left text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap text-[var(--text-tertiary)] uppercase first:pl-3.5"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        members={data.members}
                        selected={p.id === selectedId}
                        onSelect={() => setSelectedId(p.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Détail, ou captations à venir sans sélection */}
          {selected ? (
            <ProjectDetail
              project={selected}
              counts={data.counts?.get(selected.id)}
              members={data.members}
              now={now}
              onClose={() => setSelectedId(null)}
              onDelete={() => void remove(selected)}
            />
          ) : (
            <section aria-label="Captations à venir" className={BOX}>
              <header className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5 text-[var(--muted-foreground)]">
                <CalendarDays className="h-3.5 w-3.5" />
                <h3 className="flex-1 text-[13px] font-bold text-[var(--foreground)]">Captations à venir</h3>
              </header>
              {f.upcomingProjects.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays strokeWidth={1.5} />}
                  title="Aucune captation planifiée"
                  description="Aucun projet n'est programmé dans les 30 prochains jours."
                  className="py-8"
                />
              ) : (
                <div className="flex flex-col py-1">
                  {f.upcomingProjects
                    .slice(0, 5)
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--muted)]"
                      >
                        <span className="font-mono text-xs whitespace-nowrap text-[var(--muted-foreground)] tabular-nums">
                          {fmtDate(p.shootingDate, "d MMM")}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--foreground)]">{p.name}</span>
                          <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                            J-{daysUntil(p.shootingDate!, now)} · {STATUS_LABEL[p.status] ?? p.status}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        interventionType={kind === "integration" ? "INTEGRATION" : "PRESTATION"}
        knownClients={knownClients}
        existingNames={existingNames}
      />
    </>
  );
}

const BOX = "min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]";

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
    <div role="group" aria-label={label} className={cn(BOX, "flex flex-col gap-1 px-3.5 py-3")}>
      <p className="text-[22px] leading-none font-bold tracking-[-0.02em] text-[var(--foreground)] tabular-nums">
        {value}
      </p>
      <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
      <p className="truncate text-xs text-[var(--muted-foreground)]">{sub}</p>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2.5 py-[3px] text-xs whitespace-nowrap transition-colors",
            value === o.id
              ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--muted-foreground)]">
      <span
        aria-hidden
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: STATUS_COLOR[status] ?? "var(--muted-foreground)" }}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
      >
        <div className="h-full rounded-full bg-[var(--muted-foreground)]" style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-[11px] text-[var(--muted-foreground)] tabular-nums">{value} %</span>
    </div>
  );
}

function Avatar({ member }: { member: Member }) {
  return (
    <span
      role="img"
      aria-label={`Créé par ${memberLabel(member)}`}
      title={`Créé par ${memberLabel(member)}`}
      className="inline-grid h-6 w-6 place-items-center rounded-full border border-[var(--border)] bg-[var(--muted)] text-[10px] font-bold text-[var(--muted-foreground)]"
    >
      {initials(member)}
    </span>
  );
}

function ProjectRow({
  project: p,
  members,
  selected,
  onSelect,
}: {
  project: StrataProject;
  members: Map<string, Member> | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const creator = members?.get(p.createdById) ?? null;
  const cell = "border-b border-[var(--border)] px-2.5 py-[7px] align-middle";
  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer transition-colors",
        selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--muted)]",
      )}
    >
      <td className={cn(cell, "pl-3.5")}>
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          className="block max-w-[320px] truncate text-left font-semibold text-[var(--foreground)] outline-none focus-visible:underline"
        >
          {p.name}
        </button>
        <div className="truncate text-[11.5px] text-[var(--muted-foreground)]">
          {p.clientName ?? "Projet interne"} · {p.interventionType === "INTEGRATION" ? "Intégration" : "Prestation"}
        </div>
      </td>
      <td className={cn(cell, "font-mono text-xs whitespace-nowrap text-[var(--muted-foreground)]")}>
        {keyDateLabel(p)}
      </td>
      <td className={cn(cell, "w-[150px]")}>
        <ProgressBar value={completionOf(p)} label="Avancement" />
      </td>
      <td className={cell}>
        {creator ? <Avatar member={creator} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className={cell}>
        <StatusPill status={p.status} />
      </td>
    </tr>
  );
}

/** Compteur du détail ; `undefined` : donnée indisponible (« — »). */
function Figure({ label, value }: { label: string; value: ReactNode | undefined }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <span className="text-[18px] leading-none font-bold text-[var(--foreground)] tabular-nums">{value ?? "—"}</span>
      <span className="truncate text-[11px] text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}

function ProjectDetail({
  project: p,
  counts,
  members,
  now,
  onClose,
  onDelete,
}: {
  project: StrataProject;
  /** `undefined` : compteurs indisponibles (« — »). */
  counts: ListCounts | undefined;
  members: Map<string, Member> | null;
  now: Date;
  onClose: () => void;
  onDelete: () => void;
}) {
  const integration = p.interventionType === "INTEGRATION";
  const creator = members?.get(p.createdById) ?? null;
  const alerts = alertsOf(p, now);
  const facts: [string, ReactNode][] = [
    ["Client", p.clientName ?? "Projet interne"],
    ["Type", integration ? "Intégration" : "Prestation"],
    ["Lieu", p.location ?? "—"],
    ["Type de régie", p.rigType ? RIG_TYPE_LABEL[p.rigType] : "—"],
    [integration ? "Mise en service" : "Période de tournage", keyDateLabel(p)],
    ["Planification", planningLabel(p)],
    ["Créé par", creator ? memberLabel(creator) : "—"],
    ["Mis à jour", fmtDate(p.updatedAt) ?? "—"],
  ];

  return (
    <section aria-label="Détail du projet" className={cn(BOX, "xl:sticky xl:top-4")}>
      <header className="flex flex-col gap-1.5 border-b border-[var(--border)] px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[17px] leading-snug font-bold tracking-[-0.01em] text-[var(--foreground)]">
            {p.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le détail"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div>
          <StatusPill status={p.status} />
        </div>
        <div className="mt-1.5 flex flex-col gap-2">
          <OpenLink href={`/project/${p.id}?tab=synoptique`} icon={<Workflow className="h-3.5 w-3.5" />}>
            Ouvrir dans Concevoir
          </OpenLink>
          <OpenLink href={`/project/${p.id}?space=gerer`} icon={<LayoutList className="h-3.5 w-3.5" />}>
            Ouvrir dans Gérer
          </OpenLink>
        </div>
      </header>

      <div className="flex flex-col gap-3.5 px-4 pt-3 pb-4">
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--border)] [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b [&>*]:border-[var(--border)]">
          <Figure label="Fiche technique" value={`${completionOf(p)} %`} />
          <Figure label="Tâches" value={p._count.tasks} />
          <Figure label="Régies" value={counts?.rigConfigsCount} />
          <Figure label="Documents" value={counts?.documentsCount} />
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Alertes</SectionLabel>
          {alerts.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">Aucune alerte</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {alerts.map((a) => (
                <li key={a.text} className="flex items-center gap-2 text-[12.5px] text-[var(--foreground)]">
                  <AlertTriangle
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: a.level === "danger" ? "var(--danger)" : "var(--warning)" }}
                  />
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Résumé</SectionLabel>
          <dl className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--muted-foreground)]">{k}</dt>
                <dd className="min-w-0 truncate text-[var(--foreground)]">{v}</dd>
              </div>
            ))}
          </dl>
          {p.description?.trim() && (
            <p className="mt-1 text-[12.5px] leading-snug whitespace-pre-line text-[var(--muted-foreground)]">
              {p.description.trim()}
            </p>
          )}
        </div>

        <IfTenantPerm domain="projects" level="admin">
          <div className="flex justify-end border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--danger-text)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer le projet
            </button>
          </div>
        </IfTenantPerm>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">{children}</span>
  );
}

function OpenLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--muted)] px-2.5 text-xs font-medium whitespace-nowrap text-[var(--foreground)] transition-colors hover:border-[var(--border-strong)]"
    >
      {icon}
      {children}
    </Link>
  );
}
