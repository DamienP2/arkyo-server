// arkyo-server: bouchon tâche 12, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/rack-card-canvas.tsx).
// Exports lus par la fiche de lieu et les panneaux de propriétés : les types
// (`RackCardData`…), `RACK_TYPE_LABEL`, `RACK_TYPE_COLOR`, `computeRackTotals`
// et `formatNum` sont recopiés d'arkyo (:40-193). `BomList` ne liste que les
// noms et quantités des lignes de premier niveau ; les rows éditables, la
// réglette des châssis et le glisser-déposer arrivent avec la copie.

// ── Types ────────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";

/** arkyo:…/rack-mini-svg.tsx:19-30 (`RackMiniSlot`). */
type RackMiniSlot = {
  id: string;
  startU: number;
  heightU: number;
  view?: "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE" | null;
  widthFraction?: WidthFraction | null;
  column?: number | null;
  category?: string | null;
};

export type RackCardSlot = RackMiniSlot & {
  equipmentName?: string | null;
  equipmentReference?: string | null;
  brandName?: string | null;
};

export type RackCardBomItem = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /** Identité catalogue — sert à numéroter les exemplaires d'un même hôte. */
  refId?: string;
  quantity: number;
  name: string;
  reference: string | null;
  brandName: string | null;
  category: string | null;
  /** Couleur hex de la catégorie/fonction primaire (CatalogFunction.color). */
  categoryColor?: string | null;
  isRackable?: boolean;
  heightU?: number | null;
  depthMm?: number | null;
  weightKg?: number | null;
  powerW?: number | null;
  snapshotId?: string | null;
  // ── Composants modulaires (châssis type Ross openGear) ──────────────────────
  /** Non-null si cet item est un composant installé dans un hôte (pointe l'hôte). */
  hostItemId?: string | null;
  /** Position (0-based) occupée dans l'hôte — null si non imbriqué. */
  hostSlotIndex?: number | null;
  /** L'équipement de cet item peut-il accueillir des composants ? */
  isComponentHost?: boolean;
  /** Nombre de slots internes de l'hôte — null si non applicable. */
  hostSlotCount?: number | null;
  /** Cet équipement est-il conçu pour être installé comme composant ? */
  isComponent?: boolean;
  /** Nombre de slots occupés dans l'hôte une fois installé. */
  componentSlotSpan?: number;
};

export type RackCardData = {
  id: string;
  name: string;
  rackType: RackType;
  totalU: number;
  depthMm: number;
  /** Largeur extérieure mm — non-rackable (flight, pelicase, mobilier). */
  widthMm?: number | null;
  /** Hauteur extérieure mm — non-rackable. */
  heightMm?: number | null;
  /** Poids à vide du contenant (kg) — base du total poids affiché. */
  emptyWeightKg?: number | null;
  slotsCount: number;
  isRackable?: boolean;
  /** Slots pour le mini SVG + liste expanded (vide = card vide). */
  slots?: RackCardSlot[];
  /** BOM agrégé (items ajoutés via drag&drop, pré-placement). */
  bom?: RackCardBomItem[];
  /** Compteurs pour les non-rackable. Optionnels. */
  panelsCount?: number;
  accessoriesCount?: number;
};

// ── Maps statiques (alignées sur inventaire-client.tsx) ─────────────────────

const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: 'Baie standard 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_COLOR: Record<RackType, string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

// ── Totaux d'un contenant ────────────────────────────────────────────────────

const U_HEIGHT_MM = 44.45;
const RACK_WIDTH_19_MM = 600;

export type RackTotals = {
  /** U occupés par les items rackables (composants exclus). */
  usedU: number;
  /** Poids à vide + BOM (kg). */
  weightKg: number;
  /** Consommation cumulée du BOM (W). */
  powerW: number;
  /** Volume estimé (m³) — 0 si indéterminable. */
  volumeM3: number;
};

/**
 * Sous-ensemble suffisant pour les totaux — accepte aussi bien un
 * `RackCardData` qu'un `InventaireRack` (dont les slots ont une autre forme).
 */
export type RackTotalsInput = {
  isRackable?: boolean;
  totalU: number;
  depthMm: number;
  widthMm?: number | null;
  heightMm?: number | null;
  emptyWeightKg?: number | null;
  bom?: RackCardBomItem[];
};

/** Agrège les totaux affichés dans l'en-tête d'un contenant et du lieu. */
export function computeRackTotals(rack: RackTotalsInput): RackTotals {
  const bom = rack.bom ?? [];
  let usedU = 0;
  let weightKg = rack.emptyWeightKg ?? 0;
  let powerW = 0;
  for (const it of bom) {
    // Les composants occupent des slots internes de leur châssis, pas des U.
    if (it.hostItemId == null && it.isRackable && typeof it.heightU === "number") {
      usedU += it.heightU * it.quantity;
    }
    if (typeof it.weightKg === "number") weightKg += it.weightKg * it.quantity;
    if (typeof it.powerW === "number") powerW += it.powerW * it.quantity;
  }
  let mm3 = 0;
  if (rack.isRackable && rack.totalU > 0 && rack.depthMm > 0) {
    mm3 = RACK_WIDTH_19_MM * (rack.totalU * U_HEIGHT_MM) * rack.depthMm;
  } else if (rack.widthMm && rack.heightMm && rack.depthMm > 0) {
    mm3 = rack.widthMm * rack.heightMm * rack.depthMm;
  }
  return { usedU, weightKg, powerW, volumeM3: mm3 / 1e9 };
}

/** Format FR compact (max 2 décimales, séparateur de milliers fine). */
export function formatNum(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export { RACK_TYPE_LABEL, RACK_TYPE_COLOR };

// ── BomList (bouchon) ────────────────────────────────────────────────────────

export type SlotVariant = "lines" | "ruler";

export function BomList({
  bom,
  emptyLabel = "Aucun équipement.",
}: {
  rackId: string;
  bom: RackCardBomItem[];
  slotVariant?: SlotVariant;
  /** Texte affiché quand le BOM est vide. */
  emptyLabel?: string;
}) {
  if (bom.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-5 text-center">
        <p className="text-[11px] text-[var(--muted-foreground)]">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 px-2 py-2">
      {bom
        .filter((it) => !it.hostItemId)
        .map((it) => (
          <li key={it.id} className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{it.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)] tabular-nums">
              ×{it.quantity}
            </span>
          </li>
        ))}
    </ul>
  );
}
