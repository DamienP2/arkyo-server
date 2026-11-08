/** Bloc « Points de restauration » (spec sauvegardes §5 et §7). */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  ActionButton,
  ActionSwitch,
} from "@/components/synoptique/components/property-patterns";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog, FormSection } from "@/components/ui/form-dialog";
import {
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Plus,
  Save,
  Search,
  Trash2,
} from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  backupsApi,
  type Point,
  type PointKind,
  type PointProject,
  type ProjectSettings,
  type ProjectSettingsState,
} from "./api";
import { BackupBlock } from "./backup-block";
import { formatDate, formatSize } from "./format";

const KIND_LABEL: Record<PointKind, string> = {
  auto: "Automatique",
  manual: "Manuel",
  beforeRestore: "Avant restauration",
};

const INTERVALS = [1, 6, 24];

function authorOf(p: Point): string {
  return p.author?.name || p.author?.email || "";
}

const labelSchema = z.object({ label: z.string().max(200, "200 caractères au plus") });
type LabelValues = z.infer<typeof labelSchema>;
const NO_LABEL: LabelValues = { label: "" };

function PointSettings({ settings }: { settings: ProjectSettings | null }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<ProjectSettings | null>(settings);
  const [keep, setKeep] = useState(settings ? String(settings.keep) : "");

  useEffect(() => {
    if (!settings) return;
    setS(settings);
    setKeep(String(settings.keep));
  }, [settings]);

  async function save(next: ProjectSettings) {
    try {
      const saved = await backupsApi.points.saveSettings({
        enabled: next.enabled,
        intervalHours: next.intervalHours,
        keep: next.keep,
      });
      setS(saved);
      setKeep(String(saved.keep));
    } catch (e) {
      toast.error(getApiErrorMessage(e));
      if (s) setKeep(String(s.keep));
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Réglages automatiques
      </button>
      {open && !s && <LoadingState className="py-4" />}
      {open && s && (
        <div className="space-y-2">
          <ActionSwitch
            label="Points automatiques"
            checked={s.enabled}
            onChange={(v) => void save({ ...s, enabled: v })}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Intervalle</span>
            <select
              aria-label="Intervalle"
              value={s.intervalHours}
              onChange={(e) =>
                void save({ ...s, intervalHours: Number(e.target.value) })
              }
              className="border-border bg-card rounded-md border px-2 py-1 text-sm"
            >
              {INTERVALS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Points automatiques gardés</span>
            <input
              type="number"
              min={1}
              aria-label="Points gardés"
              value={keep}
              onChange={(e) => setKeep(e.target.value)}
              onBlur={() => {
                const n = Math.floor(Number(keep));
                if (n >= 1 && n !== s.keep) void save({ ...s, keep: n });
                else setKeep(String(s.keep));
              }}
              className="border-border bg-card w-20 rounded-md border px-2 py-1 text-right text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function ProjectPointsList({
  project,
  onBack,
  onChanged,
}: {
  project: PointProject;
  onBack: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [points, setPoints] = useState<Point[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setPoints(await backupsApi.points.list(project.id));
    } catch (e) {
      toast.error(getApiErrorMessage(e));
      setPoints([]);
    }
  }, [project.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Lève en cas d'échec : le dialogue reste ouvert avec l'erreur. Pendant
   * l'envoi, FormDialog désactive « Créer » (pas de second envoi).
   */
  async function create({ label }: LabelValues) {
    await backupsApi.points.create(project.id, label.trim() || undefined);
    toast.success("Point créé");
    await load();
    onChanged();
  }

  async function restore(p: Point) {
    const when = formatDate(p.createdAt);
    const ok = await confirm({
      title: "Restaurer ce point ?",
      description: project.deleted
        ? `Le projet sera recréé à l'état du ${when}.`
        : `Le projet sera remplacé par l'état du ${when}. Un point de l'état actuel est créé avant.`,
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    setWarnings([]);
    try {
      const report = await backupsApi.points.restore(project.id, p.id);
      toast.success("Projet restauré");
      setWarnings(report.warnings ?? []);
      await load();
      onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  async function remove(p: Point) {
    const ok = await confirm({
      title: "Supprimer ce point ?",
      description: `Le point du ${formatDate(p.createdAt)} sera supprimé définitivement.`,
      variant: "destructive",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await backupsApi.points.remove(project.id, p.id);
      await load();
      onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  async function download(p: Point) {
    try {
      await backupsApi.points.download(project.id, p.id);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Retour aux projets"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{project.name}</span>
        {project.deleted && (
          <span className="text-muted-foreground text-xs">Supprimé</span>
        )}
      </div>
      {!project.deleted && (
        <ActionButton
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Créer un point"
          onClick={() => setCreating(true)}
        />
      )}
      <FormDialog<LabelValues>
        open={creating}
        onOpenChange={setCreating}
        title="Créer un point"
        icon={<History />}
        schema={labelSchema}
        defaultValues={NO_LABEL}
        onSubmit={create}
        submitLabel="Créer"
        size="sm"
      >
        {(form) => (
          <FormSection>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">
                Libellé
              </span>
              <input
                {...form.register("label")}
                maxLength={200}
                className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </label>
            {form.formState.errors.label && (
              <p className="text-[11px] text-[var(--danger-text)]">
                {form.formState.errors.label.message as string}
              </p>
            )}
          </FormSection>
        )}
      </FormDialog>
      {warnings.length > 0 && (
        <ul
          aria-label="Avertissements de la restauration"
          className="list-disc space-y-0.5 pl-4 text-xs text-[var(--warning-text)]"
        >
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {points === null ? (
        <LoadingState className="py-6" />
      ) : points.length === 0 ? (
        <EmptyState
          icon={<History className="h-10 w-10" />}
          title="Aucun point de restauration"
          className="py-8"
        />
      ) : (
        <ul className="divide-border/60 border-border/60 divide-y rounded-md border">
          {points.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <div>{formatDate(p.createdAt)}</div>
                <div className="text-muted-foreground text-xs">
                  {[
                    KIND_LABEL[p.kind],
                    p.label,
                    authorOf(p),
                    formatSize(p.size),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <ActionButton
                  icon={<ArchiveRestore className="h-3.5 w-3.5" />}
                  label="Restaurer"
                  onClick={() => void restore(p)}
                  className="w-auto"
                />
                <ActionButton
                  icon={<Download className="h-3.5 w-3.5" />}
                  label="Télécharger"
                  onClick={() => void download(p)}
                  className="w-auto"
                />
                <ActionButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Supprimer"
                  danger
                  onClick={() => void remove(p)}
                  className="w-auto"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RestorePoints() {
  const toast = useToast();
  const [projects, setProjects] = useState<PointProject[] | null>(null);
  const [settings, setSettings] = useState<ProjectSettingsState | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await backupsApi.points.projects());
    } catch (e) {
      toast.error(getApiErrorMessage(e));
      setProjects((p) => p ?? []);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Réglages et dernier échec des points automatiques.
  useEffect(() => {
    backupsApi.points
      .settings()
      .then(setSettings)
      .catch((e) => toast.error(getApiErrorMessage(e)));
  }, [toast]);

  const open = projects?.find((p) => p.id === openId) ?? null;
  const q = query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(q));

  return (
    <BackupBlock title="Points de restauration">
      {settings?.lastError && (
        <p role="alert" className="text-xs text-[var(--danger-text)]">
          Échec des points automatiques ({formatDate(settings.lastError.at)}) :{" "}
          {settings.lastError.message}
        </p>
      )}
      {projects === null ? (
        <LoadingState className="py-8" />
      ) : open ? (
        <ProjectPointsList
          project={open}
          onBack={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Save className="h-10 w-10" />}
          title="Aucun projet"
          className="py-8"
        />
      ) : (
        <div className="space-y-2">
          <div className="border-border bg-card flex items-center gap-2 rounded-md border px-2 py-1.5">
            <Search className="text-muted-foreground h-3.5 w-3.5" />
            <input
              type="search"
              aria-label="Rechercher un projet"
              placeholder="Rechercher un projet"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={<Search className="h-10 w-10" />}
              title="Aucun projet ne correspond"
              className="py-8"
            />
          ) : (
            <ul className="divide-border/60 border-border/60 divide-y rounded-md border">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{p.name}</span>
                      {p.deleted && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          Supprimé
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {p.lastPoint
                        ? `${p.count} ${p.count > 1 ? "points" : "point"} · ${formatDate(p.lastPoint.createdAt)}`
                        : "Aucun point"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <PointSettings settings={settings} />
    </BackupBlock>
  );
}
