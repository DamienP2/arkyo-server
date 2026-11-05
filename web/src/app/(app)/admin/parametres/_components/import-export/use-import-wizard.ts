"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import {
  normalizeToken,
  type TargetField,
} from "@/lib/services/import/detect-columns";
import { parseCsv, type TabularMatrix } from "@/lib/services/import/parse-tabular";
import { loadSheetJS } from "@/lib/export/table-xlsx";

import {
  IGNORE,
  MAX_ROWS,
  type AnalyzeResponse,
  type CommitResponse,
  type DedupPolicy,
  type ExistingRef,
  type FieldChoice,
  type PerRowOverride,
  type PerRowOverrides,
  type PreviewResponse,
  type RefDecision,
  type RefDecisions,
  type WizardStep,
} from "./types";

// ── Lecture XLSX client (SheetJS) ─────────────────────────────────────────────

type XlsxReadModule = {
  read: (
    data: ArrayBuffer,
    opts: { type: "array" },
  ) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (
      ws: unknown,
      opts: { header: 1; blankrows: false; defval: string },
    ) => unknown[][];
  };
};

async function readXlsxSheets(
  buffer: ArrayBuffer,
): Promise<{ workbook: ReturnType<XlsxReadModule["read"]>; xlsx: XlsxReadModule }> {
  await loadSheetJS();
  const xlsx = (window as unknown as { XLSX: XlsxReadModule }).XLSX;
  const workbook = xlsx.read(buffer, { type: "array" });
  return { workbook, xlsx };
}

function matrixToTabular(matrix: unknown[][]): TabularMatrix {
  const rows = matrix.map((r) => r.map((c) => (c == null ? "" : String(c))));
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return { headers, rows: rows.slice(1).slice(0, MAX_ROWS) };
}

/**
 * Décisions de réf par défaut : match exact normalisé → rattacher (Arkyo
 * prioritaire pour éviter les fabricants tenant orphelins) ; sinon créer.
 */
function defaultRefDecisions(
  values: string[],
  existing: ExistingRef[],
): Record<string, RefDecision> {
  const out: Record<string, RefDecision> = {};
  for (const value of values) {
    const norm = normalizeToken(value);
    const matches = existing.filter((e) => normalizeToken(e.name) === norm);
    const match = matches.find((m) => m.source === "arkyo") ?? matches[0];
    out[value] = match ? { action: "link", id: match.id } : { action: "create" };
  }
  return out;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export type ImportWizard = ReturnType<typeof useImportWizard>;

export function useImportWizard() {
  const toast = useToast();

  const [step, setStep] = useState<WizardStep>("hub");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Matrice complète (gardée client pour le commit ; modifiable en Vérification).
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);

  const [columnField, setColumnField] = useState<Record<number, FieldChoice>>({});
  const [refDecisions, setRefDecisions] = useState<RefDecisions>({ brands: {}, categories: {} });
  const [dedupPolicy, setDedupPolicy] = useState<DedupPolicy>("skip");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [perRowOverrides, setPerRowOverrides] = useState<PerRowOverrides>({});

  const [report, setReport] = useState<CommitResponse | null>(null);

  const workbookRef = useRef<{
    workbook: ReturnType<XlsxReadModule["read"]>;
    xlsx: XlsxReadModule;
  } | null>(null);

  const reset = useCallback(() => {
    setStep("hub");
    setBusy(false);
    setError(null);
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setAnalysis(null);
    setColumnField({});
    setRefDecisions({ brands: {}, categories: {} });
    setDedupPolicy("skip");
    setPreview(null);
    setPreviewDirty(false);
    setPerRowOverrides({});
    setReport(null);
    workbookRef.current = null;
  }, []);

  // ── Mapping courant → colonnes commit/preview ──────────────────────────────
  const columns = useMemo(
    () =>
      Object.entries(columnField)
        .filter(([, f]) => f !== IGNORE)
        .map(([idx, f]) => ({ index: Number(idx), field: f as TargetField })),
    [columnField],
  );

  const hasName = columns.some((c) => c.field === "name");

  // ── Analyse (POST matrice complète → mapping + réfs) ───────────────────────
  const runAnalyze = useCallback(async (matrix: TabularMatrix, name: string) => {
    if (matrix.headers.length === 0) {
      setError("Le tableur ne contient aucune colonne exploitable.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/parametres/import/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix: [matrix.headers, ...matrix.rows] }),
      });
      if (res.status === 403) {
        setError("Vous n'avez pas les droits pour importer dans le catalogue.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof j?.error === "string" ? j.error : "Analyse du fichier impossible.");
        return;
      }
      const data = (await res.json()) as AnalyzeResponse;
      setHeaders(matrix.headers);
      setRows(matrix.rows);
      setFileName(name);
      setAnalysis(data);

      const cf: Record<number, FieldChoice> = {};
      for (const m of data.mapping) cf[m.index] = m.suggestedField ?? IGNORE;
      setColumnField(cf);

      setRefDecisions({
        brands: defaultRefDecisions(data.refValues.brands, data.existing.brands),
        categories: defaultRefDecisions(data.refValues.categories, data.existing.categories),
      });

      setPreview(null);
      setPreviewDirty(false);
      setPerRowOverrides({});
      setStep("map");
    } catch {
      setError("Erreur réseau pendant l'analyse.");
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Sélection de fichier ───────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file: File) => {
      reset();
      setBusy(true);
      setFileName(file.name);
      try {
        const isXlsx =
          file.name.toLowerCase().endsWith(".xlsx") ||
          file.type.includes("spreadsheetml");
        if (isXlsx) {
          const buf = await file.arrayBuffer();
          const parsed = await readXlsxSheets(buf);
          workbookRef.current = parsed;
          const first = parsed.workbook.SheetNames[0];
          const aoa = parsed.xlsx.utils.sheet_to_json(parsed.workbook.Sheets[first], {
            header: 1,
            blankrows: false,
            defval: "",
          });
          await runAnalyze(matrixToTabular(aoa), file.name);
        } else {
          const text = await file.text();
          const matrix = parseCsv(text);
          matrix.rows = matrix.rows.slice(0, MAX_ROWS);
          await runAnalyze(matrix, file.name);
        }
      } catch {
        setError(
          "Impossible de lire ce fichier. Formats acceptés : .csv, .xlsx (première feuille).",
        );
        setBusy(false);
      }
    },
    [reset, runAnalyze],
  );

  // Changement de feuille (XLSX multi-feuilles).
  const handleSheet = useCallback(
    async (sheetName: string) => {
      const wb = workbookRef.current;
      if (!wb) return;
      setBusy(true);
      try {
        const aoa = wb.xlsx.utils.sheet_to_json(wb.workbook.Sheets[sheetName], {
          header: 1,
          blankrows: false,
          defval: "",
        });
        await runAnalyze(matrixToTabular(aoa), fileName ?? sheetName);
      } finally {
        setBusy(false);
      }
    },
    [fileName, runAnalyze],
  );

  // ── Preview ────────────────────────────────────────────────────────────────
  const runPreview = useCallback(async () => {
    if (!hasName) {
      setError("Associez au moins une colonne au champ « Nom ».");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/parametres/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns, rows }),
      });
      if (res.status === 403) {
        setError("Vous n'avez pas les droits pour importer dans le catalogue.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof j?.error === "string" ? j.error : "Vérification impossible.");
        return;
      }
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setPreviewDirty(false);
    } catch {
      setError("Erreur réseau pendant la vérification.");
    } finally {
      setBusy(false);
    }
  }, [columns, rows, hasName]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goToStep = useCallback(
    (target: "file" | "map" | "verify" | "done") => {
      if (target === "file") {
        reset();
        return;
      }
      if (target === "map") {
        setError(null);
        setStep("map");
        return;
      }
      if (target === "verify") {
        setError(null);
        setStep("verify");
        void runPreview();
      }
    },
    [reset, runPreview],
  );

  // ── Édition inline d'une cellule (Vérification) ────────────────────────────
  const updateCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) => r.slice());
      if (!next[rowIndex]) return prev;
      // Étend la ligne si la colonne éditée dépasse (ligne courte).
      while (next[rowIndex].length <= colIndex) next[rowIndex].push("");
      next[rowIndex][colIndex] = value;
      return next;
    });
    setPreviewDirty(true);
  }, []);

  const setRowOverride = useCallback((rowIndex: number, patch: PerRowOverride | null) => {
    setPerRowOverrides((prev) => {
      const next = { ...prev };
      if (patch === null) {
        delete next[rowIndex];
        return next;
      }
      const merged = { ...next[rowIndex], ...patch };
      // Nettoie les clés vides pour ne pas envoyer d'override inutile.
      if (merged.skip === false) delete merged.skip;
      if (merged.dedup === undefined) delete merged.dedup;
      if (Object.keys(merged).length === 0) delete next[rowIndex];
      else next[rowIndex] = merged;
      return next;
    });
  }, []);

  // ── Commit ─────────────────────────────────────────────────────────────────
  const runCommit = useCallback(async () => {
    if (!hasName) {
      setError("Associez au moins une colonne au champ « Nom ».");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const overridesPayload: Record<string, PerRowOverride> = {};
      for (const [k, v] of Object.entries(perRowOverrides)) {
        overridesPayload[String(k)] = v;
      }
      const res = await fetch("/api/tenant/parametres/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns,
          rows,
          refDecisions,
          dedupPolicy,
          perRowOverrides: overridesPayload,
        }),
      });
      if (res.status === 403) {
        setError("Vous n'avez pas les droits pour importer dans le catalogue.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof j?.error === "string" ? j.error : "Import impossible.");
        return;
      }
      const data = (await res.json()) as CommitResponse;
      setReport(data);
      setStep("done");
      if (data.failed.length === 0) {
        toast.success(`Import terminé : ${data.created + data.updated} élément(s).`);
      } else {
        toast.info(`Import terminé avec ${data.failed.length} ligne(s) en erreur.`);
      }
    } catch {
      setError("Erreur réseau pendant l'import.");
    } finally {
      setBusy(false);
    }
  }, [columns, rows, refDecisions, dedupPolicy, perRowOverrides, hasName, toast]);

  return {
    // état
    step,
    busy,
    error,
    fileName,
    headers,
    rows,
    analysis,
    columnField,
    refDecisions,
    dedupPolicy,
    preview,
    previewDirty,
    perRowOverrides,
    report,
    columns,
    hasName,
    hasMultipleSheets: !!(analysis?.sheetNames && analysis.sheetNames.length > 1),
    // setters
    setColumnField,
    setRefDecisions,
    setDedupPolicy,
    setError,
    setRowOverride,
    updateCell,
    // actions
    handleFile,
    handleSheet,
    reset,
    goToStep,
    runPreview,
    runCommit,
  };
}
