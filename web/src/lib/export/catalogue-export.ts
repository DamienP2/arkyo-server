/**
 * lib/export/catalogue-export.ts
 *
 * Logique pure de l'export du catalogue équipements du tenant
 * (Paramètres > Importer / Exporter). Aucune dépendance React/DOM :
 * la carte `export-card.tsx` fournit les données (fetch) et déclenche
 * les téléchargements, ce module construit lignes et texte CSV.
 *
 * Deux contenus d'export :
 *  - standard : champs plats du round-trip import (`ALL_TARGET_FIELDS`) ;
 *  - complet  : + colonnes Rackable / Mode ST 2110 / Fonctions sur la feuille
 *    Équipements, et une feuille « Connectique » avec une ligne par port
 *    (noms de connecteurs résolus par l'appelant via la main DB).
 */

import type { TargetField } from "@/lib/services/import/detect-columns";
import type { XlsxCellValue, XlsxColumn } from "@/lib/export/table-xlsx";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Entrée connectique telle que stockée dans `TenantEquipment.connectors`. */
type RawConnectorEntry = {
  face?: string;
  connectorTypeId?: string;
  version?: string;
  signalName?: string;
  quantity?: number;
  label?: string;
  direction?: string;
  gender?: string;
};

export type ExportEquipment = {
  name?: string | null;
  reference?: string | null;
  brand?: { name?: string | null } | null;
  equipmentCategory?: { name?: string | null } | null;
  type?: { name?: string | null } | null;
  heightU?: number | null;
  widthFraction?: string | null;
  depthMm?: number | null;
  dimLmm?: number | null;
  dimWmm?: number | null;
  dimHmm?: number | null;
  weight?: number | null;
  powerW?: number | null;
  heatBtuH?: number | null;
  hasDualPsu?: boolean | null;
  is2110?: boolean | null;
  isLightingFixture?: boolean | null;
  dmxChannelsDefault?: number | null;
  notes?: string | null;
  tags?: unknown;
  // Champs additionnels de l'export complet
  isRackable?: boolean | null;
  ip2110Mode?: string | null;
  functions?: { label?: string | null }[] | null;
  connectors?: unknown;
};

/** Champs additionnels de la feuille Équipements en export complet. */
export type CompleteExtraField = "isRackable" | "ip2110Mode" | "functions";
export type ExportField = TargetField | CompleteExtraField;

export const COMPLETE_EXTRA_FIELDS: { key: CompleteExtraField; label: string }[] = [
  { key: "isRackable", label: "Rackable" },
  { key: "ip2110Mode", label: "Mode ST 2110" },
  { key: "functions", label: "Fonctions" },
];

// ─── Feuille Équipements ─────────────────────────────────────────────────────

/** Valeur exportée d'un champ (nombres typés pour XLSX ; bool → Oui/Non). */
export function equipmentCellValue(item: ExportEquipment, field: ExportField): XlsxCellValue {
  switch (field) {
    case "name":
      return item.name ?? "";
    case "reference":
      return item.reference ?? null;
    case "brand":
      return item.brand?.name ?? null;
    case "category":
      return item.equipmentCategory?.name ?? null;
    case "type":
      return item.type?.name ?? null;
    case "widthFraction":
      return item.widthFraction ?? null;
    case "notes":
      return item.notes ?? null;
    case "tags":
      return Array.isArray(item.tags)
        ? (item.tags as unknown[]).map((t) => String(t)).join(", ")
        : null;
    case "hasDualPsu":
    case "is2110":
    case "isLightingFixture":
    case "isRackable":
      return item[field] ? "Oui" : "Non";
    case "ip2110Mode":
      return item.ip2110Mode ?? null;
    case "functions": {
      const labels = (item.functions ?? [])
        .map((f) => f?.label)
        .filter((l): l is string => typeof l === "string" && l.length > 0);
      return labels.length > 0 ? labels.join(", ") : null;
    }
    default: {
      // Champs numériques (heightU, depthMm, dims, weight, powerW…).
      const v = (item as Record<string, unknown>)[field];
      return typeof v === "number" ? v : null;
    }
  }
}

// ─── Feuille Connectique ─────────────────────────────────────────────────────

const FACE_LABEL: Record<string, string> = {
  FRONT: "Devant",
  REAR: "Arrière",
  LEFT: "Gauche",
  RIGHT: "Droite",
  TOP: "Dessus",
  BOTTOM: "Dessous",
};

const DIRECTION_LABEL: Record<string, string> = {
  IN: "Entrée",
  OUT: "Sortie",
  BOTH: "Bidirectionnel",
};

const GENDER_LABEL: Record<string, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "N",
};

export const CONNECTIQUE_COLUMNS: XlsxColumn[] = [
  { key: "equipment", label: "Équipement" },
  { key: "reference", label: "Référence" },
  { key: "face", label: "Face" },
  { key: "connector", label: "Connecteur" },
  { key: "version", label: "Version" },
  { key: "signal", label: "Signal" },
  { key: "direction", label: "Direction" },
  { key: "gender", label: "Genre" },
  { key: "quantity", label: "Quantité" },
  { key: "label", label: "Libellé" },
];

function connectorEntries(item: ExportEquipment): RawConnectorEntry[] {
  if (!Array.isArray(item.connectors)) return [];
  return (item.connectors as unknown[]).filter(
    (c): c is RawConnectorEntry => !!c && typeof c === "object",
  );
}

/** IDs uniques de types de connecteurs référencés par la connectique. */
export function collectConnectorTypeIds(items: ExportEquipment[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    for (const entry of connectorEntries(item)) {
      if (typeof entry.connectorTypeId === "string" && entry.connectorTypeId) {
        ids.add(entry.connectorTypeId);
      }
    }
  }
  return [...ids];
}

/**
 * Une ligne par port, triées par nom d'équipement (ordre source au sein d'un
 * même équipement). `connectorNames` : id type de connecteur → nom résolu.
 */
export function buildConnectiqueRows(
  items: ExportEquipment[],
  connectorNames: Map<string, string>,
): Record<string, XlsxCellValue>[] {
  const sorted = [...items].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", "fr", { sensitivity: "base" }),
  );
  const rows: Record<string, XlsxCellValue>[] = [];
  for (const item of sorted) {
    for (const entry of connectorEntries(item)) {
      rows.push({
        equipment: item.name ?? "",
        reference: item.reference ?? null,
        face: entry.face ? (FACE_LABEL[entry.face] ?? entry.face) : null,
        connector: entry.connectorTypeId
          ? (connectorNames.get(entry.connectorTypeId) ?? null)
          : null,
        version: entry.version || null,
        signal: entry.signalName || null,
        direction: entry.direction ? (DIRECTION_LABEL[entry.direction] ?? entry.direction) : null,
        gender: entry.gender ? (GENDER_LABEL[entry.gender] ?? entry.gender) : null,
        quantity: typeof entry.quantity === "number" ? entry.quantity : null,
        label: entry.label || null,
      });
    }
  }
  return rows;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Échappement RFC 4180 : guillemets doublés, encadrement si séparateur/quote/CR/LF. */
export function csvEscape(raw: XlsxCellValue): string {
  if (raw == null) return "";
  const s = String(raw);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Texte CSV complet (BOM UTF-8, séparateur `;`, lignes CRLF). */
export function buildCsvText(
  columns: XlsxColumn[],
  rows: Record<string, XlsxCellValue>[],
): string {
  const header = columns.map((c) => csvEscape(c.label)).join(";");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key] ?? null)).join(";"));
  return `﻿${[header, ...lines].join("\r\n")}`;
}
