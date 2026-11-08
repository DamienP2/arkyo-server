/** Bloc « Sauvegarde du site » (spec sauvegardes §6 et §7). */

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSwitch } from "@/components/synoptique/components/property-patterns";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Archive,
  ArchiveRestore,
  Download,
  Trash2,
} from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, getApiErrorMessage } from "@/lib/api-client";
import { backupsApi, type SiteList, type SiteSettings } from "./api";
import { BackupBlock } from "./backup-block";
import { formatDate, formatSize } from "./format";

const btn =
  "border-border/60 text-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const POLL_MS = 1500;
/** Sans coupure observée au-delà de ce délai, on considère le redémarrage fait. */
const MAX_WAIT_MS = 8000;

/**
 * Attend que le serveur redémarre (même principe que l'installation d'une
 * mise à jour) : recharge la page dès que `/api/system` répond à nouveau.
 */
function RestartingScreen({ warning }: { warning?: string }) {
  useEffect(() => {
    const started = Date.now();
    let wentDown = false;
    const id = setInterval(async () => {
      let down = false;
      try {
        await api.get("/api/system");
      } catch (e) {
        // Erreur réseau ou passerelle : le serveur est encore coupé. Toute autre
        // réponse HTTP (401 : la session n'existe plus dans la base restaurée)
        // prouve qu'il répond : la page rechargée affichera la connexion au besoin.
        down =
          !(e instanceof ApiError) || [502, 503, 504].includes(e.status);
      }
      if (down) {
        wentDown = true;
      } else if (wentDown || Date.now() - started >= MAX_WAIT_MS) {
        clearInterval(id);
        window.location.reload();
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div role="status" className="space-y-2">
      <LoadingState label="Restauration en cours, le serveur redémarre…" />
      {warning && (
        <p className="text-[var(--warning-text)] text-center text-xs">
          {warning}
        </p>
      )}
    </div>
  );
}

function SiteSettingsForm({
  settings,
  dir,
  onSaved,
}: {
  settings: SiteSettings;
  dir: string;
  onSaved: () => void;
}) {
  const [s, setS] = useState(settings);
  const [folder, setFolder] = useState(settings.dir ?? "");
  const [keep, setKeep] = useState(String(settings.keep));
  const [error, setError] = useState<string | null>(null);

  async function save(next: SiteSettings) {
    try {
      const saved = await backupsApi.site.saveSettings(next);
      setS(saved);
      setFolder(saved.dir ?? "");
      setKeep(String(saved.keep));
      setError(null);
      onSaved();
    } catch (e) {
      setError(getApiErrorMessage(e));
      setFolder(s.dir ?? "");
    }
  }

  return (
    <div className="space-y-2">
      <ActionSwitch
        label="Sauvegarde automatique"
        checked={s.enabled}
        onChange={(v) => void save({ ...s, enabled: v })}
      />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Heure</span>
        <select
          aria-label="Heure"
          value={s.hour}
          onChange={(e) => void save({ ...s, hour: Number(e.target.value) })}
          className="border-border bg-card rounded-md border px-2 py-1 text-sm"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h} h
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Dossier</span>
        <input
          type="text"
          aria-label="Dossier"
          placeholder={dir}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={() => {
            const v = folder.trim();
            if (v !== (s.dir ?? "")) void save({ ...s, dir: v || null });
          }}
          className="border-border bg-card min-w-0 flex-1 rounded-md border px-2 py-1 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="text-[var(--danger-text)] text-xs">
          {error}
        </p>
      )}
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Sauvegardes gardées</span>
        <input
          type="number"
          min={1}
          aria-label="Sauvegardes gardées"
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
  );
}

export function SiteBackups() {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<SiteList | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restart, setRestart] = useState<{ warning?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await backupsApi.site.list());
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      await backupsApi.site.create();
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function remove(name: string) {
    const ok = await confirm({
      title: "Supprimer cette sauvegarde ?",
      description: `« ${name} » sera supprimée définitivement.`,
      variant: "destructive",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await backupsApi.site.remove(name);
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  async function download(name: string) {
    try {
      await backupsApi.site.download(name);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // La confirmation précède l'envoi : rien n'est transmis sans accord.
    const ok = await confirm({
      title: "Restaurer une sauvegarde du site ?",
      description:
        "Toutes les données actuelles seront remplacées. Elles sont mises de côté dans le dossier de données. Le serveur redémarre.",
      variant: "destructive",
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    setRestoring(true);
    try {
      const r = await backupsApi.site.restore(file);
      setRestart({ warning: r.warning });
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      setRestoring(false);
    }
  }

  if (restart) {
    return (
      <BackupBlock title="Sauvegarde du site">
        <RestartingScreen warning={restart.warning} />
      </BackupBlock>
    );
  }
  if (!data) {
    return (
      <BackupBlock title="Sauvegarde du site">
        <LoadingState className="py-4" />
      </BackupBlock>
    );
  }

  const last = data.backups[0];
  const status = data.lastRestore;

  return (
    <BackupBlock title="Sauvegarde du site">
      <div className="space-y-1 text-sm">
        <div>
          {last
            ? `Dernière sauvegarde : ${formatDate(last.createdAt)}`
            : "Aucune sauvegarde pour le moment"}
        </div>
        {status &&
          (status.ok ? (
            <div className="text-muted-foreground text-xs">
              Dernière restauration : {formatDate(status.at)}
            </div>
          ) : (
            <div role="alert" className="text-[var(--danger-text)] text-xs">
              {status.error || "La dernière restauration a échoué."}
            </div>
          ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={creating || restoring}
          onClick={() => void create()}
          className={btn}
        >
          <Archive className="h-3.5 w-3.5" />
          {creating ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          aria-label="Archive du site à restaurer"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
        <button
          type="button"
          disabled={creating || restoring}
          onClick={() => fileRef.current?.click()}
          className={btn}
        >
          <ArchiveRestore className="h-3.5 w-3.5" />
          Restaurer une sauvegarde du site
        </button>
      </div>
      {(creating || restoring) && (
        <LoadingState
          className="py-2"
          label={restoring ? "Envoi en cours…" : "Sauvegarde en cours…"}
        />
      )}
      {data.backups.length === 0 ? (
        <EmptyState
          icon={<Archive className="h-10 w-10" />}
          title="Aucune sauvegarde du site"
          className="py-8"
        />
      ) : (
        <ul className="divide-border/60 border-border/60 divide-y rounded-md border">
          {data.backups.map((b) => (
            <li key={b.name} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {b.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(b.createdAt)} · {formatSize(b.size)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Télécharger ${b.name}`}
                title="Télécharger"
                onClick={() => void download(b.name)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Supprimer ${b.name}`}
                title="Supprimer"
                onClick={() => void remove(b.name)}
                className="text-muted-foreground hover:text-[var(--danger-text)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SiteSettingsForm
        settings={data.settings}
        dir={data.dir}
        onSaved={() => void load()}
      />
    </BackupBlock>
  );
}
