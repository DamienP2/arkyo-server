"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { Download, ExternalLink, Upload } from "@/components/ui/icons";

import type { CommitResponse } from "./types";

/** Étape Rapport : bilan de l'import + accès catalogue + relance. */
export function ReportStep({
  report,
  onRestart,
}: {
  report: CommitResponse;
  onRestart: () => void;
}) {
  const copyErrors = () => {
    const text = report.failed.map((f) => `Ligne ${f.row + 1}\t${f.reason}`).join("\n");
    void navigator.clipboard?.writeText(text);
  };

  const downloadErrorsCsv = () => {
    const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = "Ligne;Erreur";
    const lines = report.failed.map((f) => `${f.row + 1};${esc(f.reason)}`);
    const text = `﻿${[header, ...lines].join("\r\n")}`;
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `erreurs-import-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Créés" value={report.created} tone="accent" />
        <Stat label="Mis à jour" value={report.updated} />
        <Stat label="Ignorés" value={report.skipped} />
      </div>

      {(report.createdRefs.brands.length > 0 || report.createdRefs.categories.length > 0) && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {report.createdRefs.brands.length} fabricant(s) et {report.createdRefs.categories.length}{" "}
          classification(s) ajoutés.
        </p>
      )}

      {report.failed.length > 0 && (
        <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--destructive)]">
              {report.failed.length} ligne(s) en erreur
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={copyErrors}
                className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Copier
              </button>
              <button
                type="button"
                onClick={downloadErrorsCsv}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <Download className="h-3 w-3" />
                CSV des erreurs
              </button>
            </div>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {report.failed.map((f) => (
              <div key={f.row} className="text-[11px] text-[var(--muted-foreground)]">
                <span className="font-mono">L{f.row + 1}</span> — {f.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/catalogue"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--secondary)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Voir le catalogue
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
        >
          <Upload className="h-3.5 w-3.5" />
          Importer un autre fichier
        </button>
      </div>
    </div>
  );
}

/** Tuile statistique — partagée avec l'étape Vérification. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "destructive";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-center">
      <p
        className={cn(
          "text-lg font-bold",
          tone === "accent" && "text-[var(--accent)]",
          tone === "destructive" && "text-[var(--destructive)]",
          !tone && "text-[var(--foreground)]",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
    </div>
  );
}
