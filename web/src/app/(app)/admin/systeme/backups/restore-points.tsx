/** Bloc « Points de restauration » (spec sauvegardes §5 et §7). */

import { useCallback, useEffect, useState } from "react";
import {
  ActionButton,
  ActionSwitch,
} from "@/components/synoptique/components/property-patterns";
import { EmptyState } from "@/components/ui/empty-state";
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

function PointSettings() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<ProjectSettings | null>(null);
  const [keep, setKeep] = useState("");

  useEffect(() => {
    if (!open || s) return;
    backupsApi.points
      .settings()
      .then((v) => {
        setS(v);
        setKeep(String(v.keep));
      })
      .catch((e) => toast.error(getApiErrorMessage(e)));
  }, [open, s, toast]);

  async function save(next: ProjectSettings) {
    try {
      const saved = await backupsApi.points.saveSettings(next);
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

  async function create() {
    try {
      await backupsApi.points.create(project.id);
      toast.success("Point créé");
      await load();
      onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  async function restore(p: Point) {
    const ok = await confirm({
      title: "Restaurer ce point ?",
      description: `Le projet sera remplacé par l'état du ${formatDate(p.createdAt)}. Un point de l'état actuel est créé avant.`,
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      await backupsApi.points.restore(project.id, p.id);
      toast.success("Projet restauré");
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
          onClick={() => void create()}
        />
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

  const open = projects?.find((p) => p.id === openId) ?? null;
  const q = query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(q));

  return (
    <BackupBlock title="Points de restauration">
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
        </div>
      )}
      <PointSettings />
    </BackupBlock>
  );
}
