"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Download, Package } from "@/components/ui/icons";
import { ALL_TARGET_FIELDS } from "@/lib/services/import/detect-columns";
import {
  buildXlsxBlob,
  buildXlsxBlobMulti,
  type XlsxCellValue,
  type XlsxColumn,
} from "@/lib/export/table-xlsx";
import {
  buildConnectiqueRows,
  buildCsvText,
  collectConnectorTypeIds,
  COMPLETE_EXTRA_FIELDS,
  CONNECTIQUE_COLUMNS,
  equipmentCellValue,
  type ExportEquipment,
  type ExportField,
} from "@/lib/export/catalogue-export";

import { FIELD_LABEL } from "./types";

type ExportFormat = "csv" | "xlsx";
type ExportContent = "standard" | "complete";

const CONTENT_HINT: Record<ExportContent, string> = {
  standard: "Champs compatibles avec l'import.",
  complete: "Ajoute la connectique, les fonctions et le détail réseau.",
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fetchEquipment(): Promise<ExportEquipment[]> {
  const res = await fetch("/api/tenant/catalogue/equipment");
  if (!res.ok) throw new Error("fetch failed");
  const data = (await res.json()) as { personal?: ExportEquipment[] };
  return data.personal ?? [];
}

/** Résout les noms des types de connecteurs (main DB) par lots d'IDs. */
async function fetchConnectorNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const CHUNK = 60;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await fetch(`/api/tenant/catalogue/connectors?ids=${chunk.join(",")}`);
    if (!res.ok) throw new Error("fetch failed");
    const items = (await res.json()) as { id?: string; name?: string }[];
    for (const it of items) {
      if (it?.id && it.name) names.set(it.id, it.name);
    }
  }
  return names;
}

function equipmentColumns(content: ExportContent): XlsxColumn[] {
  const base = ALL_TARGET_FIELDS.map((f) => ({ key: f, label: FIELD_LABEL[f] }));
  return content === "complete" ? [...base, ...COMPLETE_EXTRA_FIELDS] : base;
}

function equipmentRows(
  items: ExportEquipment[],
  columns: XlsxColumn[],
): Record<string, XlsxCellValue>[] {
  return items.map((item) => {
    const row: Record<string, XlsxCellValue> = {};
    for (const c of columns) row[c.key] = equipmentCellValue(item, c.key as ExportField);
    return row;
  });
}

function csvBlob(text: string): Blob {
  return new Blob([text], { type: "text/csv;charset=utf-8" });
}

/** Export du catalogue équipements du tenant en CSV / XLSX (round-trip ou complet). */
export function ExportCard() {
  const toast = useToast();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [content, setContent] = useState<ExportContent>("standard");
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const items = await fetchEquipment();
      if (items.length === 0) {
        toast.info("Aucun équipement à exporter.");
        return;
      }
      const stamp = todayStamp();
      const columns = equipmentColumns(content);
      const eqRows = equipmentRows(items, columns);

      if (content === "standard") {
        const filename = `catalogue-equipements-${stamp}.${format}`;
        const blob =
          format === "csv"
            ? csvBlob(buildCsvText(columns, eqRows))
            : await buildXlsxBlob({ sheetName: "Équipements", columns, rows: eqRows });
        triggerDownload(blob, filename);
        toast.success(`${items.length} équipement(s) exporté(s).`);
        return;
      }

      const connectorNames = await fetchConnectorNames(collectConnectorTypeIds(items));
      const connRows = buildConnectiqueRows(items, connectorNames);

      if (format === "xlsx") {
        const blob = await buildXlsxBlobMulti([
          { sheetName: "Équipements", columns, rows: eqRows },
          { sheetName: "Connectique", columns: CONNECTIQUE_COLUMNS, rows: connRows },
        ]);
        triggerDownload(blob, `catalogue-complet-${stamp}.xlsx`);
      } else {
        triggerDownload(csvBlob(buildCsvText(columns, eqRows)), `catalogue-equipements-${stamp}.csv`);
        triggerDownload(
          csvBlob(buildCsvText(CONNECTIQUE_COLUMNS, connRows)),
          `connectique-${stamp}.csv`,
        );
      }
      toast.success(`${items.length} équipement(s) et ${connRows.length} port(s) exportés.`);
    } catch {
      toast.error("Export impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <Download className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Exporter</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Téléchargez votre catalogue.
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

      {/* Contenu */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Contenu
        </p>
        <div className="flex gap-1.5">
          {(["standard", "complete"] as ExportContent[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setContent(c)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                content === c
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              {c === "standard" ? "Standard" : "Complet"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          {CONTENT_HINT[content]}
        </p>
      </div>

      {/* Format */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Format
        </p>
        <div className="flex gap-1.5">
          {(["xlsx", "csv"] as ExportFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                format === f
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              {f === "xlsx" ? "Excel (.xlsx)" : "CSV"}
            </button>
          ))}
        </div>
        {content === "complete" && format === "csv" && (
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
            Deux fichiers : équipements et connectique.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--secondary)] disabled:cursor-wait disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? "Export…" : "Exporter"}
      </button>
    </div>
  );
}
