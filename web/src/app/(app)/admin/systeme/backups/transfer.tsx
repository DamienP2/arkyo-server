/** Bloc « Exporter / importer » (spec sauvegardes §4 et §7). */

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, getApiErrorMessage } from "@/lib/api-client";
import {
  backupsApi,
  type ImportMode,
  type ImportPreview,
  type ImportReport,
  type RootKind,
  type TransferObjects,
} from "./api";
import { BackupBlock } from "./backup-block";
import { formatDate } from "./format";
import { summarize } from "./table-labels";

type Tab = { key: keyof TransferObjects; kind: RootKind; label: string };
const TABS: Tab[] = [
  { key: "projects", kind: "project", label: "Projets" },
  { key: "racks", kind: "rack", label: "Contenants" },
  { key: "rigs", kind: "rig", label: "Régies" },
  { key: "panels", kind: "panel", label: "Panels" },
];

const KIND_LABEL: Record<RootKind, string> = {
  project: "Projet",
  rack: "Contenant",
  rig: "Régie",
  panel: "Panel",
};
const MODE_LABEL: Record<ImportMode, string> = {
  insert: "Ajouté",
  replace: "Remplacé",
  copy: "Copie",
};

const btn =
  "border-border/60 text-foreground hover:bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50";

function ExportPanel({ reloadKey }: { reloadKey: number }) {
  const toast = useToast();
  const [objects, setObjects] = useState<TransferObjects | null>(null);
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backupsApi
      .objects()
      .then(setObjects)
      .catch((e) => toast.error(getApiErrorMessage(e)));
  }, [toast, reloadKey]);

  const key = (kind: RootKind, id: string) => `${kind}:${id}`;
  const chosen = Object.entries(picked)
    .filter(([, v]) => v)
    .map(([k]) => {
      const [kind, id] = k.split(":");
      return { kind: kind as RootKind, id };
    });

  async function doExport() {
    setBusy(true);
    try {
      await backupsApi.exportObjects(chosen);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!objects) return <LoadingState />;
  const items = objects[tab.key];

  return (
    <div className="space-y-2">
      <div role="tablist" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab.key}
            onClick={() => setTab(t)}
            className={
              t.key === tab.key
                ? "bg-muted rounded-md px-2.5 py-1 text-xs font-medium"
                : "text-muted-foreground hover:bg-muted/40 rounded-md px-2.5 py-1 text-xs"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Download className="h-10 w-10" />}
          title={`Aucun objet dans « ${tab.label} »`}
          className="py-8"
        />
      ) : (
        <ul className="divide-border/60 border-border/60 divide-y rounded-md border">
          {items.map((it) => (
            <li key={it.id}>
              <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={!!picked[key(tab.kind, it.id)]}
                  onChange={(e) =>
                    setPicked({ ...picked, [key(tab.kind, it.id)]: e.target.checked })
                  }
                />
                <span className="min-w-0 flex-1 text-sm font-medium">{it.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatDate(it.updatedAt)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={chosen.length === 0 || busy}
        onClick={() => void doExport()}
        className={btn}
      >
        <Download className="h-3.5 w-3.5" />
        {`Exporter (${chosen.length})`}
      </button>
    </div>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const added = summarize(report.catalogueAdded);
  return (
    <div className="border-border/60 space-y-2 rounded-md border p-3 text-sm">
      <div className="font-medium">Import terminé</div>
      <ul className="space-y-1">
        {report.roots.map((r) => (
          <li key={`${r.kind}:${r.id}`}>
            {KIND_LABEL[r.kind]} « {r.name} » · {MODE_LABEL[r.mode]}
            <span className="text-muted-foreground block text-xs">
              {summarize(r.inserted)}
            </span>
          </li>
        ))}
      </ul>
      {added && (
        <div className="text-xs">Éléments de catalogue ajoutés : {added}</div>
      )}
      <div className="text-xs">Fichiers copiés : {report.uploadsCopied}</div>
      {(report.safetyCopies ?? []).length > 0 && (
        <div className="text-xs">
          État précédent gardé sur le serveur :
          <ul className="text-muted-foreground mt-0.5 space-y-0.5 break-all">
            {report.safetyCopies!.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <ul className="text-[var(--warning-text)] list-disc space-y-0.5 pl-4 text-xs">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{
    token: string;
    preview: ImportPreview;
  } | null>(null);
  const [modes, setModes] = useState<Record<string, ImportMode>>({});
  const [report, setReport] = useState<ImportReport | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setReport(null);
    setSession(null);
    try {
      const r = await backupsApi.inspect(file);
      setSession(r);
      const m: Record<string, ImportMode> = {};
      for (const root of r.preview.roots) if (root.exists) m[root.id] = "copy";
      setModes(m);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!session) return;
    const replaced = session.preview.roots.filter(
      (r) => r.exists && modes[r.id] === "replace",
    );
    if (replaced.length > 0) {
      const ok = await confirm({
        title: "Remplacer ces éléments ?",
        description: `Ces éléments seront remplacés par le contenu du fichier : ${replaced
          .map((r) => `${KIND_LABEL[r.kind]} « ${r.name} »`)
          .join(", ")}. Une copie de leur état actuel est gardée sur le serveur.`,
        variant: "destructive",
        confirmLabel: "Remplacer",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setReport(await backupsApi.importFile(session.token, modes));
      setSession(null);
      onImported();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      // Jeton consommé ou expiré : il faut choisir le fichier à nouveau.
      if (
        err instanceof ApiError &&
        (err.status === 400 || err.status === 404)
      ) {
        setSession(null);
        setModes({});
        if (fileRef.current) fileRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept=".arkyo"
        aria-label="Fichier .arkyo à importer"
        className="hidden"
        onChange={(e) => void onFile(e)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className={btn}
      >
        <Upload className="h-3.5 w-3.5" />
        Importer un fichier
      </button>
      {session && (
        <div className="space-y-2">
          <ul className="divide-border/60 border-border/60 divide-y rounded-md border">
            {session.preview.roots.map((r) => (
              <li key={`${r.kind}:${r.id}`} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {KIND_LABEL[r.kind]}
                    </span>
                  </span>
                  {r.exists && (
                    <span className="text-xs text-[var(--warning-text)]">
                      Existe déjà ici
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground text-xs">{summarize(r.counts)}</div>
                {r.exists && (
                  <div
                    role="radiogroup"
                    aria-label={`Mode d'import de ${r.name}`}
                    className="flex gap-4 text-xs"
                  >
                    {(["replace", "copy"] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`mode-${r.id}`}
                          checked={modes[r.id] === m}
                          onChange={() => setModes({ ...modes, [r.id]: m })}
                        />
                        {m === "replace" ? "Remplacer" : "Copie"}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void doImport()}
            className={btn}
          >
            <Upload className="h-3.5 w-3.5" />
            Importer
          </button>
        </div>
      )}
      {report && <ReportView report={report} />}
    </div>
  );
}

export function TransferBlock() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <BackupBlock title="Exporter / importer">
      <ExportPanel reloadKey={reloadKey} />
      <ImportPanel onImported={() => setReloadKey((k) => k + 1)} />
    </BackupBlock>
  );
}
