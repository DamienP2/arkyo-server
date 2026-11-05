import type { ColumnMapping, TargetField } from "@/lib/services/import/detect-columns";

// ── Constantes partagées ──────────────────────────────────────────────────────

export const MAX_ROWS = 5000;

export const IGNORE = "__ignore__" as const;
export type FieldChoice = TargetField | typeof IGNORE;

/** Libellés FR des champs cibles (ordre d'affichage). */
export const FIELD_LABEL: Record<TargetField, string> = {
  name: "Nom",
  reference: "Référence",
  brand: "Fabricant",
  category: "Classification",
  type: "Type",
  heightU: "Hauteur (U)",
  widthFraction: "Largeur",
  depthMm: "Profondeur (mm)",
  dimLmm: "Longueur (mm)",
  dimWmm: "Largeur (mm)",
  dimHmm: "Hauteur (mm)",
  weight: "Poids (kg)",
  powerW: "Puissance (W)",
  heatBtuH: "Dissipation (BTU/h)",
  hasDualPsu: "Double alimentation",
  is2110: "ST 2110",
  isLightingFixture: "Éclairage",
  dmxChannelsDefault: "Canaux DMX",
  notes: "Notes",
  tags: "Étiquettes",
};

/** Champs indispensables (mis en avant, requis pour importer). */
export const REQUIRED_FIELDS: TargetField[] = ["name"];

/** Regroupement thématique des champs (récap des champs pourvus). */
export const FIELD_GROUPS: { title: string; fields: TargetField[] }[] = [
  { title: "Identité", fields: ["name", "reference", "brand", "category", "type"] },
  {
    title: "Dimensions",
    fields: ["heightU", "widthFraction", "depthMm", "dimLmm", "dimWmm", "dimHmm", "weight"],
  },
  { title: "Énergie & thermique", fields: ["powerW", "heatBtuH", "hasDualPsu"] },
  { title: "Réseau & lumière", fields: ["is2110", "isLightingFixture", "dmxChannelsDefault"] },
  { title: "Complément", fields: ["notes", "tags"] },
];

// ── Types API : analyze ───────────────────────────────────────────────────────

export type ExistingRef = { id: string; name: string; source: "tenant" | "arkyo" };

export type AnalyzeResponse = {
  entity: "equipment";
  sheetNames?: string[];
  headers: string[];
  totalRows: number;
  sampleRows: string[][];
  mapping: ColumnMapping[];
  refValues: { brands: string[]; categories: string[] };
  existing: { brands: ExistingRef[]; categories: ExistingRef[] };
};

export type RefDecision = { action: "create" | "link"; id?: string };
export type RefDecisions = {
  brands: Record<string, RefDecision>;
  categories: Record<string, RefDecision>;
};

export type DedupPolicy = "skip" | "update" | "duplicate";

// ── Types API : preview ───────────────────────────────────────────────────────

export type RowPreviewStatus = "new" | "duplicate" | "invalid";

export type RowPreview = {
  row: number;
  status: RowPreviewStatus;
  match?: { id: string; name: string; reference: string | null };
  /** Doublon intra-fichier : n° de la ligne source. */
  matchRow?: number;
  cellIssues: { field: TargetField; value: string; message: string }[];
  reason?: string;
};

export type PreviewResponse = {
  rows: RowPreview[];
  summary: { new: number; duplicate: number; invalid: number };
};

// ── Types API : commit ────────────────────────────────────────────────────────

export type PerRowOverride = { dedup?: DedupPolicy; skip?: boolean };
export type PerRowOverrides = Record<number, PerRowOverride>;

export type CommitResponse = {
  created: number;
  updated: number;
  skipped: number;
  failed: { row: number; reason: string }[];
  createdRefs: {
    brands: { value: string; id: string }[];
    categories: { value: string; id: string }[];
  };
};

// ── Parcours ──────────────────────────────────────────────────────────────────

/** `hub` = écran d'accueil (dropzone) ; les 3 autres = wizard. */
export type WizardStep = "hub" | "map" | "verify" | "done";

/** Clé de l'étape telle qu'affichée dans le stepper. */
export type StepperKey = "file" | "map" | "verify" | "done";
