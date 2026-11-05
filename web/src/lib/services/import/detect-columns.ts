/**
 * lib/services/import/detect-columns.ts
 *
 * Moteur de détection des colonnes d'un tableur importé → champs cibles
 * d'équipement (`TenantEquipment`). 100 % pur et **déterministe**.
 *
 * Pour chaque en-tête, on calcule un score de correspondance vers chaque
 * champ cible via :
 *  1. dictionnaire de synonymes FR/EN (match exact normalisé = score fort),
 *  2. inclusion partielle (le synonyme est contenu dans l'en-tête),
 *  3. distance de Levenshtein normalisée (secours flou),
 *  4. bonus/malus selon l'inspection d'un échantillon de valeurs de la colonne
 *     (100 % numérique, motifs oui/non/true/false, motif `"1U".."48U"`,
 *     valeurs `widthFraction`…).
 *
 * Le meilleur champ non déjà attribué à un score supérieur est suggéré ; on
 * garantit qu'un même champ n'est pas suggéré deux fois (résolution gloutonne
 * par score décroissant).
 */

// ─── Champs cibles ───────────────────────────────────────────────────────────

export type TargetField =
  | "name"
  | "reference"
  | "brand"
  | "category"
  | "type"
  | "heightU"
  | "widthFraction"
  | "depthMm"
  | "dimLmm"
  | "dimWmm"
  | "dimHmm"
  | "weight"
  | "powerW"
  | "heatBtuH"
  | "hasDualPsu"
  | "is2110"
  | "isLightingFixture"
  | "dmxChannelsDefault"
  | "notes"
  | "tags";

export type FieldKind = "text" | "number" | "int" | "bool" | "enum";

export const FIELD_KIND: Record<TargetField, FieldKind> = {
  name: "text",
  reference: "text",
  brand: "text",
  category: "text",
  type: "text",
  heightU: "int",
  widthFraction: "enum",
  depthMm: "number",
  dimLmm: "number",
  dimWmm: "number",
  dimHmm: "number",
  weight: "number",
  powerW: "number",
  heatBtuH: "number",
  hasDualPsu: "bool",
  is2110: "bool",
  isLightingFixture: "bool",
  dmxChannelsDefault: "int",
  notes: "text",
  tags: "text",
};

export const ALL_TARGET_FIELDS = Object.keys(FIELD_KIND) as TargetField[];

/**
 * Synonymes par champ (FR/EN). Comparés après normalisation
 * (accents/casse/ponctuation retirés, cf. `normalizeToken`). Généreux à
 * dessein : couvre abréviations, unités et variantes courantes.
 */
export const FIELD_SYNONYMS: Record<TargetField, string[]> = {
  name: [
    "name",
    "nom",
    "designation",
    "designation produit",
    "libelle",
    "intitule",
    "appellation",
    "produit",
    "materiel",
    "equipement",
    "equipment",
    "item",
    "article",
    "titre",
  ],
  reference: [
    "reference",
    "ref",
    "refs",
    "modele",
    "model",
    "model number",
    "part number",
    "part no",
    "pn",
    "sku",
    "code",
    "code article",
    "code produit",
    "mpn",
    "type ref",
  ],
  brand: [
    "brand",
    "marque",
    "fabricant",
    "fabriquant",
    "manufacturer",
    "constructeur",
    "maker",
    "vendor",
    "fournisseur",
    "make",
  ],
  category: [
    "category",
    "categorie",
    "categories",
    "classification",
    "famille",
    "family",
    "groupe",
    "group",
    "rubrique",
    "class",
    "classe",
    "segment",
  ],
  type: ["type", "sous type", "subtype", "kind", "genre", "nature", "sorte"],
  heightU: [
    "u",
    "hu",
    "height u",
    "hauteur u",
    "rack u",
    "ru",
    "unites",
    "unite",
    "units",
    "unit",
    "nb u",
    "nombre u",
    "taille u",
    "hauteur rack",
    "rack height",
  ],
  widthFraction: [
    "width fraction",
    "largeur fraction",
    "fraction largeur",
    "fraction",
    "largeur rack",
    "rack width",
    "width",
    "largeur",
    "occupation largeur",
    "format largeur",
  ],
  depthMm: [
    "depth",
    "profondeur",
    "prof",
    "depth mm",
    "profondeur mm",
    "prof mm",
    "profondeur (mm)",
    "d mm",
    "depth (mm)",
  ],
  dimLmm: [
    "longueur",
    "length",
    "long",
    "l mm",
    "longueur mm",
    "length mm",
    "longueur (mm)",
    "dim l",
    "dimension l",
  ],
  dimWmm: [
    "largeur mm",
    "width mm",
    "l mm largeur",
    "largeur (mm)",
    "dim w",
    "dim l largeur",
    "dimension largeur",
    "width (mm)",
    "larg mm",
  ],
  dimHmm: [
    "hauteur",
    "height",
    "haut",
    "h mm",
    "hauteur mm",
    "height mm",
    "hauteur (mm)",
    "dim h",
    "dimension h",
  ],
  weight: [
    "weight",
    "poids",
    "masse",
    "mass",
    "poids kg",
    "weight kg",
    "poids (kg)",
    "kg",
    "poids net",
    "net weight",
  ],
  powerW: [
    "power",
    "puissance",
    "conso",
    "consommation",
    "watts",
    "watt",
    "w",
    "power w",
    "puissance w",
    "puissance (w)",
    "conso w",
    "power consumption",
    "consommation electrique",
  ],
  heatBtuH: [
    "heat",
    "chaleur",
    "btu",
    "btu h",
    "btuh",
    "btu hr",
    "dissipation",
    "dissipation thermique",
    "heat dissipation",
    "degagement thermique",
  ],
  hasDualPsu: [
    "dual psu",
    "double alimentation",
    "double alim",
    "redundant psu",
    "redundant power",
    "alimentation redondante",
    "alim redondante",
    "psu redondant",
    "double psu",
    "redondance alim",
    "dual power",
  ],
  is2110: [
    "2110",
    "st 2110",
    "smpte 2110",
    "st2110",
    "is 2110",
    "ip 2110",
    "compatible 2110",
    "2110 compatible",
  ],
  isLightingFixture: [
    "lighting",
    "eclairage",
    "projecteur",
    "lumiere",
    "fixture",
    "luminaire",
    "spot",
    "lighting fixture",
    "appareil eclairage",
    "is lighting",
  ],
  dmxChannelsDefault: [
    "dmx",
    "dmx channels",
    "canaux dmx",
    "channels dmx",
    "nb canaux dmx",
    "dmx channel",
    "canaux",
    "dmx footprint",
    "empreinte dmx",
  ],
  notes: [
    "notes",
    "note",
    "commentaire",
    "commentaires",
    "comment",
    "comments",
    "remarque",
    "remarques",
    "observation",
    "observations",
    "description",
    "desc",
  ],
  tags: [
    "tags",
    "tag",
    "etiquettes",
    "etiquette",
    "mots cles",
    "keywords",
    "labels",
    "label",
  ],
};

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Normalise un libellé : minuscule, accents retirés, ponctuation → espace,
 * espaces multiples compactés, trim.
 */
export function normalizeToken(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Distance de Levenshtein ─────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similarité [0..1] dérivée de Levenshtein (1 = identique). */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - dist / max;
}

// ─── Inspection des valeurs d'échantillon ────────────────────────────────────

const BOOL_TRUE = new Set([
  "oui",
  "yes",
  "y",
  "true",
  "vrai",
  "1",
  "x",
  "o",
  "on",
]);
const BOOL_FALSE = new Set([
  "non",
  "no",
  "n",
  "false",
  "faux",
  "0",
  "off",
  "",
]);

/** Valeurs `widthFraction` acceptées (formes normalisées). */
const WIDTH_FRACTION_TOKENS = new Set([
  "full",
  "half",
  "third",
  "quarter",
  "1",
  "1 1",
  "1 2",
  "1 3",
  "1 4",
  "plein",
  "pleine",
  "entier",
  "demi",
  "tiers",
  "quart",
]);

function isNumericLike(v: string): boolean {
  const t = v.trim().replace(",", ".").replace(/\s/g, "");
  if (t === "") return false;
  return /^-?\d+(\.\d+)?$/.test(t);
}

/** "1U", "2 U", "12u"… */
function isRackUnitLike(v: string): boolean {
  return /^\s*\d{1,2}\s*u\s*$/i.test(v);
}

function nonEmptySample(values: string[], limit = 100): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v != null && v.trim() !== "") out.push(v.trim());
    if (out.length >= limit) break;
  }
  return out;
}

type ValueProfile = {
  ratioNumeric: number;
  ratioBool: number;
  ratioRackUnit: number;
  ratioWidthFraction: number;
  avgLen: number;
  distinctRatio: number;
};

function profileValues(values: string[]): ValueProfile {
  const sample = nonEmptySample(values);
  if (sample.length === 0) {
    return {
      ratioNumeric: 0,
      ratioBool: 0,
      ratioRackUnit: 0,
      ratioWidthFraction: 0,
      avgLen: 0,
      distinctRatio: 0,
    };
  }
  let numeric = 0;
  let bool = 0;
  let rackUnit = 0;
  let width = 0;
  let lenSum = 0;
  const distinct = new Set<string>();
  for (const v of sample) {
    if (isNumericLike(v)) numeric += 1;
    const nv = normalizeToken(v);
    if (BOOL_TRUE.has(nv) || BOOL_FALSE.has(nv)) bool += 1;
    if (isRackUnitLike(v)) rackUnit += 1;
    if (WIDTH_FRACTION_TOKENS.has(nv)) width += 1;
    lenSum += v.length;
    distinct.add(nv);
  }
  const n = sample.length;
  return {
    ratioNumeric: numeric / n,
    ratioBool: bool / n,
    ratioRackUnit: rackUnit / n,
    ratioWidthFraction: width / n,
    avgLen: lenSum / n,
    distinctRatio: distinct.size / n,
  };
}

// ─── Scoring d'un en-tête vers un champ ──────────────────────────────────────

const HEADER_WEIGHT = 0.75;
const VALUE_WEIGHT = 0.25;

/** Score de correspondance en-tête → champ, sur la seule base du libellé. */
function scoreHeaderAgainstField(headerNorm: string, field: TargetField): number {
  let best = 0;
  for (const syn of FIELD_SYNONYMS[field]) {
    const synNorm = normalizeToken(syn);
    if (headerNorm === synNorm) {
      best = Math.max(best, 1);
      continue;
    }
    // Inclusion mot-à-mot (l'en-tête contient le synonyme comme token entier).
    if (containsAsWord(headerNorm, synNorm)) {
      best = Math.max(best, 0.85);
      continue;
    }
    // Inclusion partielle brute.
    if (headerNorm.includes(synNorm) || synNorm.includes(headerNorm)) {
      best = Math.max(best, 0.7);
      continue;
    }
    // Secours flou (Levenshtein) — seulement si proche.
    const sim = similarity(headerNorm, synNorm);
    if (sim >= 0.8) best = Math.max(best, sim * 0.75);
  }
  return best;
}

/** Vrai si `needle` apparaît comme séquence de mots entiers dans `haystack`. */
function containsAsWord(haystack: string, needle: string): boolean {
  if (needle === "") return false;
  const h = ` ${haystack} `;
  const n = ` ${needle} `;
  return h.includes(n);
}

/** Bonus/malus [-…, +…] issu du profil de valeurs, selon le type du champ. */
function valueBonus(field: TargetField, profile: ValueProfile): number {
  const kind = FIELD_KIND[field];
  switch (kind) {
    case "number":
    case "int": {
      let b = profile.ratioNumeric >= 0.8 ? 1 : profile.ratioNumeric * 0.5;
      if (field === "heightU" && profile.ratioRackUnit >= 0.5) b = 1;
      // Une colonne texte pure ne peut pas être un nombre.
      if (profile.ratioNumeric < 0.3 && profile.ratioRackUnit < 0.3) b = -1;
      return b;
    }
    case "bool": {
      if (profile.ratioBool >= 0.8) return 1;
      if (profile.ratioBool < 0.4) return -1;
      return profile.ratioBool * 0.5;
    }
    case "enum": {
      if (profile.ratioWidthFraction >= 0.5) return 1;
      if (profile.ratioNumeric >= 0.8) return -0.5;
      return 0;
    }
    case "text":
    default: {
      // Le texte long / très distinct est bon pour name/notes ; pénalise si
      // la colonne est 100 % numérique (probablement une mesure).
      if (profile.ratioNumeric >= 0.9) return -0.5;
      if (field === "name" && profile.distinctRatio >= 0.7) return 0.3;
      return 0;
    }
  }
}

// ─── Résultat ────────────────────────────────────────────────────────────────

export type ColumnMapping = {
  header: string;
  index: number;
  suggestedField: TargetField | null;
  score: number;
  alternatives: TargetField[];
};

export type DetectColumnsInput = {
  headers: string[];
  /** Lignes de données (pour l'inspection des valeurs). Optionnel. */
  rows?: string[][];
  /** Seuil minimal de score pour proposer une suggestion (défaut 0.45). */
  threshold?: number;
};

/**
 * Détecte le mapping des colonnes. Déterministe : mêmes entrées → même sortie.
 * Résolution gloutonne : chaque champ n'est attribué qu'à un seul en-tête (le
 * mieux scoré) ; les autres reçoivent leur meilleur champ libre.
 */
export function detectColumns(input: DetectColumnsInput): ColumnMapping[] {
  const { headers, rows = [], threshold = 0.45 } = input;

  // Profil de valeurs par colonne.
  const profiles = headers.map((_, colIdx) =>
    profileValues(rows.map((r) => r[colIdx] ?? "")),
  );

  // Matrice de scores [colonne][champ].
  const scored = headers.map((header, colIdx) => {
    const headerNorm = normalizeToken(header);
    const profile = profiles[colIdx];
    const perField = ALL_TARGET_FIELDS.map((field) => {
      const headerScore = scoreHeaderAgainstField(headerNorm, field);
      const bonus = valueBonus(field, profile);
      // Si l'en-tête ne matche pas du tout, on ne "sauve" pas via les valeurs
      // seules (évite d'assigner une colonne numérique au hasard) — sauf léger.
      const combined =
        headerScore <= 0
          ? Math.max(0, bonus) * 0.15 * VALUE_WEIGHT
          : clamp01(headerScore * HEADER_WEIGHT + normalizeBonus(bonus) * VALUE_WEIGHT);
      return { field, score: round4(combined) };
    });
    perField.sort((a, b) => b.score - a.score || cmpField(a.field, b.field));
    return { header, index: colIdx, perField };
  });

  // Attribution gloutonne : on trie toutes les paires (col,champ) par score
  // décroissant et on attribue tant que ni la colonne ni le champ ne sont pris.
  type Pair = { col: number; field: TargetField; score: number };
  const pairs: Pair[] = [];
  for (const col of scored) {
    for (const pf of col.perField) {
      if (pf.score >= threshold) {
        pairs.push({ col: col.index, field: pf.field, score: pf.score });
      }
    }
  }
  pairs.sort(
    (a, b) => b.score - a.score || a.col - b.col || cmpField(a.field, b.field),
  );

  const takenCols = new Set<number>();
  const takenFields = new Set<TargetField>();
  const assigned = new Map<number, TargetField>();
  for (const p of pairs) {
    if (takenCols.has(p.col) || takenFields.has(p.field)) continue;
    takenCols.add(p.col);
    takenFields.add(p.field);
    assigned.set(p.col, p.field);
  }

  return scored.map((col) => {
    const suggestedField = assigned.get(col.index) ?? null;
    const alternatives = col.perField
      .filter((pf) => pf.field !== suggestedField && pf.score >= threshold * 0.6)
      .slice(0, 3)
      .map((pf) => pf.field);
    const score =
      suggestedField != null
        ? (col.perField.find((pf) => pf.field === suggestedField)?.score ?? 0)
        : (col.perField[0]?.score ?? 0);
    return { header: col.header, index: col.index, suggestedField, score, alternatives };
  });
}

// ─── Utilitaires numériques ──────────────────────────────────────────────────

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Ramène le bonus [-1..1] vers [0..1] pour la combinaison pondérée. */
function normalizeBonus(bonus: number): number {
  return clamp01((bonus + 1) / 2);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Ordre stable des champs (par index dans ALL_TARGET_FIELDS). */
function cmpField(a: TargetField, b: TargetField): number {
  return ALL_TARGET_FIELDS.indexOf(a) - ALL_TARGET_FIELDS.indexOf(b);
}
