"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ArchiveRestore } from "@/components/ui/icons";
import {
  BACKUP_SECTIONS,
  backupSummary,
  type ArkyoBackup,
  type BackupSectionKey,
  type RestoreMode,
} from "@/lib/services/backup";

type CurrentSummary = Partial<Record<BackupSectionKey, number>>;
type Modes = Partial<Record<BackupSectionKey, RestoreMode>>;

const SECTION_LABEL = new Map(BACKUP_SECTIONS.map((s) => [s.key, s.label]));

/**
 * Écran de vérification : pour chaque section du fichier, compteur fichier vs
 * état actuel et choix Fusionner / Remplacer. Un « Remplacer » déclenche une
 * confirmation avant l'envoi.
 */
export function RestoreVerify({
  backup,
  busy,
  onCancel,
  onSubmit,
}: {
  backup: ArkyoBackup;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (modes: Modes) => void;
}) {
  const confirm = useConfirm();

  const fileCounts = useMemo(() => backupSummary(backup), [backup]);
  const sections = useMemo(
    () => BACKUP_SECTIONS.filter((s) => fileCounts[s.key] !== undefined),
    [fileCounts],
  );

  const [modes, setModes] = useState<Modes>(() =>
    Object.fromEntries(sections.map((s) => [s.key, "merge" as RestoreMode])),
  );
  const [current, setCurrent] = useState<CurrentSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/tenant/parametres/backup/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setCurrent(d as CurrentSummary);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const setMode = (key: BackupSectionKey, mode: RestoreMode) =>
    setModes((prev) => ({ ...prev, [key]: mode }));

  const hasReplace = sections.some((s) => modes[s.key] === "replace");

  const handleSubmit = async () => {
    if (hasReplace) {
      const ok = await confirm({
        title: "Remplacer des données ?",
        description:
          "Les sections en « Remplacer » seront vidées puis recréées à partir du fichier. Cette action est irréversible.",
        variant: "destructive",
        confirmLabel: "Restaurer",
      });
      if (!ok) return;
    }
    onSubmit(modes);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <ArchiveRestore className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Vérifier la restauration</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Choisissez comment appliquer chaque section du fichier.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {sections.map((s) => {
          const fileCount = fileCounts[s.key] ?? 0;
          const currentCount = current?.[s.key];
          const mode = modes[s.key] ?? "merge";
          return (
            <div
              key={s.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{SECTION_LABEL.get(s.key) ?? s.label}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {fileCount} élément(s) dans le fichier
                  {currentCount !== undefined && (
                    <> · {currentCount} actuellement</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {(["merge", "replace"] as RestoreMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(s.key, m)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      mode === m
                        ? m === "replace"
                          ? "border-[var(--destructive)] bg-[var(--destructive)]/10 text-[var(--destructive)]"
                          : "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    {m === "merge" ? "Fusionner" : "Remplacer"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || sections.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--secondary)] disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Restauration…" : "Restaurer"}
        </button>
      </div>
    </div>
  );
}
