/**
 * Modèle de tableau de la liste du matériel — source UNIQUE des sorties PDF,
 * CSV, XLSX et de l'aperçu du modal d'export.
 *
 * Un seul builder produit `{ columns, rows }` à partir des contenants et des
 * options de contenu : les trois formats restent donc cohérents par
 * construction (mêmes colonnes, mêmes regroupements, mêmes sous-totaux).
 *
 * Les regroupements et sous-totaux sont émis comme des LIGNES du tableau (pas
 * de structure imbriquée) : le générateur PDF générique et le CSV les rendent
 * tels quels, sans traitement particulier.
 *
 * Pur : aucune dépendance React / DOM / Prisma.
 */

export type BomTableColumnKey =
  | "location"
  | "container"
  | "type"
  | "name"
  | "brand"
  | "category"
  | "quantity"
  | "heightU"
  | "weight"
  | "power";

/**
 * Référentiel des colonnes. Une seule colonne d'identité : « Désignation »,
 * alimentée par le champ FUSIONNÉ nom/référence des fiches équipement
 * (migration `merge_equipment_name_reference`, 2026-08 : la valeur vit dans
 * `name`, la colonne `reference` est dormante et vaut NULL partout). Il n'y a
 * donc plus de colonne « Référence » — elle aurait été vide.
 */
export const BOM_TABLE_COLUMNS: ReadonlyArray<{
  key: BomTableColumnKey;
  label: string;
  /** Valeur chiffrée — alignée à droite, en chasse fixe. */
  numeric?: boolean;
  /**
   * Colonne CUMULÉE dans les sous-totaux et les totaux. Distinct de `numeric` :
   * « Quantité » est un nombre mais additionner les quantités d'items
   * hétérogènes (une caméra + un câble) ne veut rien dire — elle est chiffrée
   * sans être totalisée.
   */
  totaled?: boolean;
}> = [
  { key: "location", label: "Emplacement" },
  { key: "container", label: "Contenant" },
  { key: "type", label: "Type" },
  { key: "name", label: "Désignation" },
  { key: "brand", label: "Marque" },
  { key: "category", label: "Catégorie" },
  { key: "quantity", label: "Quantité", numeric: true },
  { key: "heightU", label: "Hauteur (U)" },
  { key: "weight", label: "Poids (kg)", numeric: true, totaled: true },
  { key: "power", label: "Conso (W)", numeric: true, totaled: true },
];

const ALL_COLUMN_KEYS = BOM_TABLE_COLUMNS.map((c) => c.key);

/**
 * Colonnes cumulées (Poids, Conso). Elles sont ÉPINGLÉES en fin de tableau et
 * ne se réordonnent pas : les lignes de sous-total et de total écrivent leur
 * libellé à gauche puis leurs valeurs sous ces colonnes — ça ne tient que si
 * elles forment un bloc contigu en fin de ligne.
 *
 * « Quantité » n'en fait PAS partie : chiffrée mais non totalisée, elle reste
 * librement déplaçable parmi les colonnes de texte.
 */
export const BOM_TOTALED_COLUMNS: BomTableColumnKey[] = BOM_TABLE_COLUMNS.filter(
  (c) => c.totaled,
).map((c) => c.key);

export function isBomTotaledColumn(key: BomTableColumnKey): boolean {
  return BOM_TOTALED_COLUMNS.includes(key);
}

/**
 * Normalise un ordre : colonnes libres dans l'ordre demandé, puis les colonnes
 * cumulées dans l'ordre du référentiel. Toute personnalisation qui violerait
 * l'épinglage est réparée ici.
 */
export function orderWithTotalsLast(
  order: BomTableColumnKey[],
): BomTableColumnKey[] {
  return [
    ...order.filter((k) => !isBomTotaledColumn(k)),
    ...BOM_TOTALED_COLUMNS,
  ];
}

/**
 * Colonnes rendues inutiles par le regroupement courant : les bandes de groupe
 * portent déjà l'information, la répéter sur chaque ligne est du bruit. La
 * règle vaut pour TOUTES les sorties (PDF, CSV, XLSX, aperçu) — pas d'exception
 * tabulaire.
 */
export function columnsCoveredByGroups(
  groupBy: BomGroupBy,
): Set<BomTableColumnKey> {
  if (groupBy === "location") return new Set<BomTableColumnKey>(["location"]);
  if (groupBy === "container")
    return new Set<BomTableColumnKey>(["location", "container"]);
  return new Set<BomTableColumnKey>();
}

/** Ordre d'affichage par défaut — celui du référentiel. */
export const DEFAULT_BOM_COLUMN_ORDER: BomTableColumnKey[] = [
  ...ALL_COLUMN_KEYS,
];

/** Colonnes cochées par défaut. */
export const DEFAULT_BOM_COLUMNS: BomTableColumnKey[] = [
  "container",
  "type",
  "name",
  "brand",
  "quantity",
  "weight",
  "power",
];

export type BomGroupBy = "none" | "location" | "container";

export type BomTableOptions = {
  /**
   * Ordre d'affichage de TOUTES les colonnes — piloté par le glisser-déposer
   * des pastilles de réglage. Les colonnes retenues sortent dans cet ordre.
   */
  columnOrder: BomTableColumnKey[];
  /** Colonnes retenues — sous-ensemble de `columnOrder`. */
  columns: BomTableColumnKey[];
  /** Regroupement : aucun, par emplacement, ou par emplacement puis contenant. */
  groupBy: BomGroupBy;
  /** Ligne de sous-total (quantité / poids / conso) en fin de groupe. */
  subtotals: boolean;
  /** Inclure les équipements libres (contenants virtuels des lieux). */
  includeFree: boolean;
};

export const DEFAULT_BOM_TABLE_OPTIONS: BomTableOptions = {
  columnOrder: DEFAULT_BOM_COLUMN_ORDER,
  columns: DEFAULT_BOM_COLUMNS,
  groupBy: "container",
  subtotals: true,
  includeFree: true,
};

/**
 * Remet d'aplomb des options restaurées : retire les colonnes inconnues (ex.
 * « reference », supprimée), complète l'ordre avec les colonnes apparues
 * depuis, réapplique l'épinglage des colonnes à totaux en fin d'ordre, et
 * garantit au moins une colonne retenue.
 *
 * Migration DOUCE : on ne rejette jamais le réglage mémorisé en bloc, on le
 * nettoie — un utilisateur qui avait tout personnalisé garde ses choix.
 */
export function sanitizeBomTableOptions(
  options: BomTableOptions,
): BomTableOptions {
  const known = new Set<string>(ALL_COLUMN_KEYS);
  const order = (options.columnOrder ?? []).filter((k) => known.has(k));
  for (const key of ALL_COLUMN_KEYS) {
    if (!order.includes(key)) order.push(key);
  }
  // Réapplique l'épinglage : un ordre mémorisé avant l'introduction de la
  // règle (ou modifié à la main) est réparé plutôt que rejeté.
  const pinned = orderWithTotalsLast(order);
  const selected = pinned.filter((k) => (options.columns ?? []).includes(k));
  return {
    ...options,
    columnOrder: pinned,
    columns: selected.length > 0 ? selected : DEFAULT_BOM_COLUMNS,
  };
}

// ── Entrées ──────────────────────────────────────────────────────────────────

export type BomTableItem = {
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /** Champ fusionné nom / référence. */
  name: string;
  brandName?: string | null;
  category?: string | null;
  quantity: number;
  heightU?: number | null;
  weightKg?: number | null;
  powerW?: number | null;
  /** Composant installé dans un châssis — jamais compté à part. */
  hostItemId?: string | null;
};

export type BomTableRack = {
  id: string;
  name: string;
  locationId?: string | null;
  isVirtual?: boolean;
  /** Type de contenant — méta affichée après le nom dans le PDF. */
  rackType?: string | null;
  /** Hauteur en U — méta affichée si le contenant est rackable. */
  totalU?: number | null;
  isRackable?: boolean;
  bom?: ReadonlyArray<BomTableItem> | null;
};

export type BomTableLocation = { id: string; name: string };

const KIND_LABEL: Record<BomTableItem["kind"], string> = {
  equipment: "Équipement",
  panel: "Panel",
  adapter: "Adaptateur",
  accessory: "Accessoire",
};

/** Libellé du contenant virtuel d'un lieu (équipements sans contenant). */
export const FREE_CONTAINER_LABEL = "Équipements libres";
const NO_LOCATION_LABEL = "Sans emplacement";

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Cumuls d'un groupe. PAS de quantité : additionner les quantités d'items
 * hétérogènes ne veut rien dire (« 14 » pour une caméra, un rack de câbles et
 * trois vis n'informe personne). Seules des grandeurs physiques homogènes se
 * totalisent.
 */
export type BomTotals = { weightKg: number; powerW: number };

export type BomTableColumn = {
  key: BomTableColumnKey;
  label: string;
  /** Aligné à droite, en chasse fixe. */
  numeric: boolean;
  /** Cumulé dans les sous-totaux / totaux (Poids, Conso). */
  totaled: boolean;
};

/**
 * Ligne TYPÉE. `cells` est toujours rempli (sorties tabulaires plates : CSV,
 * XLSX, aperçu du modal) ; les autres champs ne servent qu'au rendu PDF, qui
 * dessine chaque nature de ligne différemment. Aucun consommateur ne doit
 * déduire la nature d'une ligne en inspectant son contenu texte.
 */
export type BomTableRow =
  | { kind: "item"; cells: Array<string | number> }
  | { kind: "group-location"; label: string; cells: Array<string | number> }
  | {
      kind: "group-container";
      label: string;
      /** « BAIE 19" · 12U » — méta grise après le nom. */
      meta: string | null;
      /** Contenant virtuel (équipements libres) — rendu en italique. */
      free: boolean;
      cells: Array<string | number>;
    }
  | {
      kind: "subtotal";
      label: string;
      totals: BomTotals;
      cells: Array<string | number>;
    }
  | {
      kind: "total";
      label: string;
      totals: BomTotals;
      cells: Array<string | number>;
    };

export type BomTable = {
  columns: BomTableColumn[];
  rows: BomTableRow[];
  /** Nombre de lignes d'items (hors titres de groupe et sous-totaux). */
  itemCount: number;
  /**
   * Regroupement appliqué — pilote l'indentation des items sous leur groupe et
   * le retrait des colonnes que les bandes portent déjà.
   */
  groupBy: BomGroupBy;
};

type Totals = BomTotals;

const emptyTotals = (): Totals => ({ weightKg: 0, powerW: 0 });

function addTotals(acc: Totals, item: BomTableItem): void {
  if (typeof item.weightKg === "number")
    acc.weightKg += item.weightKg * item.quantity;
  if (typeof item.powerW === "number")
    acc.powerW += item.powerW * item.quantity;
}

/** Arrondi d'affichage — 1 décimale pour les poids, entier pour la conso. */
function fmtWeight(v: number): string | number {
  return v > 0 ? Number(v.toFixed(1)) : "";
}
function fmtPower(v: number): string | number {
  return v > 0 ? Math.round(v) : "";
}

/** Méta d'un contenant : « BAIE 19" · 12U » — vide si rien à dire. */
const RACK_TYPE_LABEL: Record<string, string> = {
  STANDARD: 'BAIE 19"',
  FLIGHT_CASE_CLASSIC: "FLIGHT",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "PELICASE",
  CAP: "MOBILIER",
};

function rackMeta(rack: BomTableRack): string | null {
  const parts: string[] = [];
  if (rack.rackType) parts.push(RACK_TYPE_LABEL[rack.rackType] ?? rack.rackType);
  if (rack.isRackable !== false && rack.totalU) parts.push(`${rack.totalU}U`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function buildBomTable(
  racks: ReadonlyArray<BomTableRack>,
  locations: ReadonlyArray<BomTableLocation>,
  options: BomTableOptions,
): BomTable {
  // L'ordre des colonnes du document est celui du réglage, pas celui du
  // référentiel : les pastilles se réordonnent au glisser-déposer (les
  // colonnes à totaux restant épinglées en fin de ligne).
  //
  // Les colonnes couvertes par les bandes de groupe sont retirées ICI, donc
  // pour toutes les sorties d'un coup : c'est la seule définition des colonnes
  // effectives du document.
  const covered = columnsCoveredByGroups(options.groupBy);
  const colByKey = new Map(BOM_TABLE_COLUMNS.map((c) => [c.key, c]));
  const cols: BomTableColumn[] = orderWithTotalsLast(options.columnOrder)
    .filter((k) => options.columns.includes(k) && !covered.has(k))
    .map((k) => colByKey.get(k))
    .filter((c): c is (typeof BOM_TABLE_COLUMNS)[number] => c != null)
    .map((c) => ({
      key: c.key,
      label: c.label,
      numeric: !!c.numeric,
      totaled: !!c.totaled,
    }));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const kept = racks.filter((r) => options.includeFree || !r.isVirtual);

  // Groupement : emplacement → contenants. Un contenant sans emplacement
  // tombe dans un groupe dédié, toujours en fin de liste.
  type Bucket = { key: string; label: string; racks: BomTableRack[] };
  const buckets: Bucket[] = [];
  const byKey = new Map<string, Bucket>();
  for (const rack of kept) {
    const key = rack.locationId ?? "__none__";
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: rack.locationId
          ? (locationName.get(rack.locationId) ?? NO_LOCATION_LABEL)
          : NO_LOCATION_LABEL,
        racks: [],
      };
      byKey.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.racks.push(rack);
  }
  buckets.sort((a, b) => {
    if (a.key === "__none__") return 1;
    if (b.key === "__none__") return -1;
    return 0;
  });

  const rows: BomTableRow[] = [];
  let itemCount = 0;

  const cellsFor = (
    item: BomTableItem,
    rack: BomTableRack,
    bucketLabel: string,
  ): Array<string | number> =>
    cols.map((c) => {
      switch (c.key) {
        case "location":
          return bucketLabel;
        case "container":
          return rack.isVirtual ? FREE_CONTAINER_LABEL : rack.name;
        case "type":
          return KIND_LABEL[item.kind];
        case "name":
          return item.name;
        case "brand":
          return item.brandName ?? "";
        case "category":
          return item.category ?? "";
        case "quantity":
          return item.quantity;
        case "heightU":
          return item.heightU ?? "";
        case "weight":
          return item.weightKg ?? "";
        case "power":
          return item.powerW ?? "";
      }
    });

  /** Ligne de titre : libellé dans la 1re colonne, reste vide. */
  const groupRow = (label: string): Array<string | number> =>
    cols.map((_, i) => (i === 0 ? label : ""));

  /**
   * Ligne de sous-total : libellé en colonne « Désignation » si présente, puis
   * les seules colonnes CUMULÉES. La colonne « Quantité » reste vide — on
   * n'additionne pas des quantités d'items hétérogènes.
   */
  const subtotalRow = (
    label: string,
    totals: Totals,
  ): Array<string | number> => {
    const nameIdx = cols.findIndex((c) => c.key === "name");
    return cols.map((c, i) => {
      if (c.key === "weight") return fmtWeight(totals.weightKg);
      if (c.key === "power") return fmtPower(totals.powerW);
      if (i === (nameIdx === -1 ? 0 : nameIdx)) return label;
      return "";
    });
  };

  /** Items exportables d'un contenant (les composants suivent leur châssis). */
  const itemsOf = (rack: BomTableRack): BomTableItem[] =>
    (rack.bom ?? []).filter((it) => it.hostItemId == null);

  for (const bucket of buckets) {
    const bucketTotals = emptyTotals();
    const bucketHasItems = bucket.racks.some((r) => itemsOf(r).length > 0);
    if (!bucketHasItems) continue;

    if (options.groupBy !== "none") {
      const label = bucket.label.toUpperCase();
      rows.push({ kind: "group-location", label, cells: groupRow(label) });
    }

    for (const rack of bucket.racks) {
      const items = itemsOf(rack);
      if (items.length === 0) continue;
      const rackTotals = emptyTotals();

      if (options.groupBy === "container") {
        const label = rack.isVirtual ? FREE_CONTAINER_LABEL : rack.name;
        rows.push({
          kind: "group-container",
          label,
          meta: rack.isVirtual ? null : rackMeta(rack),
          free: !!rack.isVirtual,
          cells: groupRow(label),
        });
      }
      for (const item of items) {
        rows.push({
          kind: "item",
          cells: cellsFor(item, rack, bucket.label),
        });
        addTotals(rackTotals, item);
        addTotals(bucketTotals, item);
        itemCount += 1;
      }
      if (options.subtotals && options.groupBy === "container") {
        rows.push({
          kind: "subtotal",
          label: "Sous-total",
          totals: rackTotals,
          cells: subtotalRow("Sous-total contenant", rackTotals),
        });
      }
    }

    if (options.subtotals && options.groupBy !== "none") {
      const label = `TOTAL — ${bucket.label.toUpperCase()}`;
      rows.push({
        kind: "total",
        label,
        totals: bucketTotals,
        cells: subtotalRow(label, bucketTotals),
      });
    }
  }

  // Sans regroupement, un total général reste utile.
  if (options.groupBy === "none" && options.subtotals && rows.length > 0) {
    const all = emptyTotals();
    for (const rack of kept) for (const it of itemsOf(rack)) addTotals(all, it);
    rows.push({
      kind: "total",
      label: "TOTAL",
      totals: all,
      cells: subtotalRow("Total", all),
    });
  }

  return { columns: cols, rows, itemCount, groupBy: options.groupBy };
}

/** Libellés de colonnes — sorties tabulaires plates (CSV, XLSX, aperçu). */
export function bomColumnLabels(table: BomTable): string[] {
  return table.columns.map((c) => c.label);
}

/** Lignes à plat — sorties tabulaires (toutes natures de lignes confondues). */
export function bomFlatRows(table: BomTable): Array<Array<string | number>> {
  return table.rows.map((r) => r.cells);
}

/** Formatage partagé des totaux (PDF et cellules). */
export const formatBomWeight = fmtWeight;
export const formatBomPower = fmtPower;
