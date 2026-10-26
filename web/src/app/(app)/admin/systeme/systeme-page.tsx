/**
 * `/admin/systeme` — version du serveur, adresses d'accès et mises à jour
 * intégrées (recherche, installation, import d'un paquet, retour arrière).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminTabLayout } from "@/app/(app)/admin/_components/admin-tab-layout";
import {
  ActionButton,
  ActionSwitch,
  InfoCard,
} from "@/components/synoptique/components/property-patterns";
import {
  Copy,
  Cpu,
  Download,
  Search,
  Settings,
  Undo2,
  Upload,
} from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { usePageTitle } from "@/lib/hooks/use-page-title";

type SystemInfo = { version: string; dataDir: string; urls: string[] };

type Release = {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
};

type Phase =
  "idle" | "checking" | "downloading" | "installing" | "restarting" | "error";

type UpdateInfo = {
  current: string;
  repo: string;
  autoCheck: boolean;
  previous: string | null;
  status: {
    phase: Phase;
    progress: number;
    message: string;
    latest: Release | null;
  };
};

const BUSY: Phase[] = ["checking", "downloading", "installing", "restarting"];

function isNewer(candidate: string, current: string): boolean {
  const key = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((p) => parseInt(p, 10) || 0);
  const a = key(candidate);
  const b = key(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return !candidate.includes("-") && current.includes("-");
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SystemePage() {
  usePageTitle("Système");
  const confirm = useConfirm();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const loadUpdate = useCallback(async () => {
    try {
      setUpdate(await api.get<UpdateInfo>("/api/system/update"));
    } catch {
      /* le serveur redémarre : on réessaie au prochain passage */
    }
  }, []);

  useEffect(() => {
    api
      .get<SystemInfo>("/api/system")
      .then(setSystem)
      .catch(() => setFailed(true));
    void loadUpdate();
  }, [loadUpdate]);

  const busy = !!update && BUSY.includes(update.status.phase);
  const initialVersion = useRef<string | null>(null);
  if (update && initialVersion.current === null)
    initialVersion.current = update.current;

  // Suivi de l'installation ; une fois redémarré sur la nouvelle version, on recharge.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(async () => {
      try {
        const next = await api.get<UpdateInfo>("/api/system/update");
        if (initialVersion.current && next.current !== initialVersion.current) {
          window.location.reload();
          return;
        }
        setUpdate(next);
      } catch {
        /* redémarrage en cours */
      }
    }, 1500);
    return () => clearInterval(id);
  }, [busy]);

  if (failed) {
    return (
      <AdminTabLayout>
        <p className="text-destructive text-sm">
          Impossible de charger l&apos;état du serveur.
        </p>
      </AdminTabLayout>
    );
  }
  if (!system || !update) {
    return (
      <AdminTabLayout>
        <LoadingState className="py-12" />
      </AdminTabLayout>
    );
  }

  const latest = update.status.latest;
  const available =
    latest && isNewer(latest.version, update.current) ? latest : null;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await loadUpdate();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
      await loadUpdate();
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Adresse copiée");
    } catch {
      toast.error("Copie impossible");
    }
  }

  async function search() {
    setChecking(true);
    await run(() => api.post("/api/system/update/check"));
    setChecking(false);
  }

  async function install() {
    if (!available) return;
    const ok = await confirm({
      title: `Installer la version ${available.version} ?`,
      description:
        "Le serveur redémarre ; les écrans connectés sont interrompus un instant.",
      confirmLabel: "Installer",
    });
    if (ok)
      await run(() =>
        api.post(`/api/system/update/install?version=${available.version}`),
      );
  }

  async function upload(file: File) {
    const ok = await confirm({
      title: `Installer ${file.name} ?`,
      description:
        "Le serveur redémarre ; les écrans connectés sont interrompus un instant.",
      confirmLabel: "Installer",
    });
    if (ok) await run(() => api.post("/api/system/update/upload", file));
  }

  async function rollback() {
    const ok = await confirm({
      title: `Revenir à la version ${update?.previous} ?`,
      description:
        "Le serveur redémarre ; les écrans connectés sont interrompus un instant.",
      confirmLabel: "Revenir",
    });
    if (ok) await run(() => api.post("/api/system/update/rollback"));
  }

  return (
    <AdminTabLayout>
      <div className="max-w-2xl space-y-8">
        <Section title="Serveur">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard
              icon={<Cpu className="h-4 w-4" />}
              label="Version"
              value={system.version}
            />
            <InfoCard
              label="Données"
              icon={<Settings className="h-4 w-4" />}
              value={system.dataDir}
            />
          </div>
          {system.urls.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs">
                Adresses d&apos;accès
              </div>
              {system.urls.map((url) => (
                <ActionButton
                  key={url}
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label={url}
                  onClick={() => void copy(url)}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Mises à jour">
          <ActionSwitch
            label="Vérification automatique"
            checked={update.autoCheck}
            onChange={(v) =>
              void run(() =>
                api.put("/api/system/update/settings", {
                  repo: update.repo,
                  autoCheck: v,
                }),
              )
            }
          />

          {busy && (
            <div className="border-border/60 rounded-md border p-3 text-sm">
              <div>{update.status.message || "Mise à jour en cours…"}</div>
              {update.status.phase === "downloading" && (
                <div className="bg-border mt-2 h-1 overflow-hidden rounded-full">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{
                      width: `${Math.round(update.status.progress * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {update.status.phase === "error" && (
            <p className="text-destructive text-sm">{update.status.message}</p>
          )}

          {available && (
            <div className="border-border/60 space-y-2 rounded-md border p-3">
              <div className="text-sm font-semibold">
                Version {available.version} disponible
              </div>
              {available.notes && (
                <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                  {available.notes}
                </p>
              )}
              <ActionButton
                icon={<Download className="h-3.5 w-3.5" />}
                label="Installer"
                onClick={() => void install()}
                className={busy ? "pointer-events-none opacity-50" : undefined}
              />
            </div>
          )}

          <div className="space-y-1">
            <ActionButton
              icon={<Search className="h-3.5 w-3.5" />}
              label={checking ? "Recherche…" : "Rechercher"}
              onClick={() => void search()}
              className={
                busy || checking ? "pointer-events-none opacity-50" : undefined
              }
            />
            <ActionButton
              icon={<Upload className="h-3.5 w-3.5" />}
              label="Importer un paquet"
              onClick={() => fileRef.current?.click()}
              className={busy ? "pointer-events-none opacity-50" : undefined}
            />
            {update.previous && (
              <ActionButton
                icon={<Undo2 className="h-3.5 w-3.5" />}
                label="Revenir à la version précédente"
                onClick={() => void rollback()}
                className={busy ? "pointer-events-none opacity-50" : undefined}
              />
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".tar.gz,.zip,.pkg,.msi"
            aria-label="Paquet de mise à jour"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </Section>
      </div>
    </AdminTabLayout>
  );
}
