"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { FileDown, Package, Upload } from "@/components/ui/icons";
import { ALL_TARGET_FIELDS } from "@/lib/services/import/detect-columns";
import { buildXlsxBlob } from "@/lib/export/table-xlsx";

import { BackupCard } from "./backup-card";
import { ExportCard } from "./export-card";
import { RestoreCard } from "./restore-card";
import { RestoreReport } from "./restore-report";
import { RestoreVerify } from "./restore-verify";
import { useRestoreFlow } from "./use-restore-flow";
import { FIELD_LABEL } from "./types";

/** Génère un modèle XLSX vide : en-têtes `FIELD_LABEL` + une ligne d'exemple. */
async function downloadTemplate(): Promise<void> {
  const blob = await buildXlsxBlob({
    sheetName: "Équipements",
    columns: ALL_TARGET_FIELDS.map((f) => ({ key: f, label: FIELD_LABEL[f] })),
    rows: [Object.fromEntries(ALL_TARGET_FIELDS.map((f) => [f, ""]))],
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modele-import-equipements.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** En-tête de section : label uppercase muted + description courte. */
function SectionHeader({ label, description }: { label: string; description: string }) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </h3>
      <p className="text-xs text-[var(--muted-foreground)]/80">{description}</p>
    </div>
  );
}

/**
 * Écran d'accueil : deux sections empilées (Sauvegarde puis Échange tableur).
 * Le mini-parcours de restauration (vérification / rapport) remplace le contenu
 * du hub tant qu'il est actif.
 */
export function Hub({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const restore = useRestoreFlow();

  if (restore.step === "verify" && restore.backup) {
    return (
      <RestoreVerify
        backup={restore.backup}
        busy={restore.busy}
        onCancel={restore.cancel}
        onSubmit={restore.submit}
      />
    );
  }
  if (restore.step === "report" && restore.report) {
    return <RestoreReport report={restore.report} onDone={restore.cancel} />;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeader
          label="Sauvegarde"
          description="Fichier Arkyo (.json) — restauration fidèle de votre catalogue."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <BackupCard />
          <RestoreCard onValidated={restore.openVerify} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          label="Échange tableur"
          description="CSV ou Excel, pour tableurs et outils externes."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <ImportCard busy={busy} onFile={onFile} />
          <ExportCard />
        </div>
      </section>
    </div>
  );
}

function ImportCard({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTemplate = async () => {
    setDownloading(true);
    try {
      await downloadTemplate();
    } catch {
      toast.error("Téléchargement du modèle impossible.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <Upload className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Importer</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Depuis un tableur (CSV ou Excel).
          </p>
        </div>
      </div>

      {/* Entité */}
      <div className="flex gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--accent)]">
          <Package className="h-3.5 w-3.5" />
          Équipements
        </span>
        <span className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]/50">
          Câbles
        </span>
        <span className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]/50">
          Adaptateurs
        </span>
      </div>

      {/* Dropzone */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] hover:bg-[var(--secondary)]",
          busy && "cursor-wait opacity-60",
        )}
      >
        <Upload className="h-7 w-7 text-[var(--muted-foreground)]" />
        <div>
          <p className="text-sm font-medium">
            {busy ? "Lecture du fichier…" : "Glissez un tableur ici, ou cliquez"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            CSV ou Excel (.xlsx) — 5000 lignes max
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={handleTemplate}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 self-start text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-60"
      >
        <FileDown className="h-3.5 w-3.5" />
        {downloading ? "Préparation…" : "Télécharger le modèle"}
      </button>
    </div>
  );
}
