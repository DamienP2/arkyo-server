"use client";

import { ArchiveRestore } from "@/components/ui/icons";
import { BACKUP_SECTIONS, type BackupSectionKey, type RestoreReport } from "@/lib/services/backup";

import { Stat } from "./report-step";

const SECTION_LABEL = new Map(BACKUP_SECTIONS.map((s) => [s.key, s.label]));

/** Rapport de restauration : bilan créés / mis à jour / supprimés par section. */
export function RestoreReport({
  report,
  onDone,
}: {
  report: RestoreReport;
  onDone: () => void;
}) {
  const entries = (Object.keys(report) as BackupSectionKey[])
    .map((key) => ({ key, stats: report[key] }))
    .filter((e): e is { key: BackupSectionKey; stats: NonNullable<(typeof report)[BackupSectionKey]> } =>
      e.stats !== undefined,
    );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <ArchiveRestore className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Restauration terminée</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Bilan par section.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {entries.map(({ key, stats }) => (
          <div key={key} className="rounded-lg border border-[var(--border)] p-3">
            <p className="mb-2 text-xs font-semibold">{SECTION_LABEL.get(key) ?? key}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Créés" value={stats.created} tone="accent" />
              <Stat label="Mis à jour" value={stats.updated} />
              <Stat label="Supprimés" value={stats.deleted} tone="destructive" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--secondary)]"
        >
          Terminer
        </button>
      </div>
    </div>
  );
}
