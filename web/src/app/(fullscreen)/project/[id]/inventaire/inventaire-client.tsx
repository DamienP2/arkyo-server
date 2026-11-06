// arkyo-server: bouchon phase 4a (Task 10), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/inventaire-client.tsx).
// Mêmes exports ; les types `InventaireRack`, `InventaireLocation` et
// `InventaireBomItem` sont recopiés d'arkyo (:43-181), `ProjectEditorData` et
// la route `editor` en dépendent. « Bientôt disponible » dans le canvas.
import { forwardRef, useImperativeHandle } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";

// ── Slot minimal côté server (sans id — on en synthétise un au map) ──────────

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
type RackView = "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE";

type InventaireSlot = {
  startU: number;
  heightU: number;
  widthFraction: WidthFraction;
  view: RackView;
  category?: string | null;
  categoryId?: string | null;
  /** Nom de l'équipement placé sur ce slot — pour la liste expanded de la card. */
  equipmentName?: string | null;
  /** Référence interne de l'équipement (ex. "X-LF8RT2"). */
  equipmentReference?: string | null;
  /** Marque de l'équipement. */
  brandName?: string | null;
  /** Poids de l'équipement (kg) — utilisé pour le total projet du synoptique. */
  weightKg?: number | null;
  /** Conso de l'équipement (W) — utilisée pour le total projet du synoptique. */
  powerW?: number | null;
};

// ── Types ────────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

export type InventaireBomItem = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /**
   * Identité catalogue de la row (catalogEquipmentId / panelId / catalogAdapterId).
   * Utilisée pour regrouper les exemplaires d'un même équipement hôte (badges
   * #1/#2, flux « nouvel exemplaire »). Absent pour les accessoires (pas
   * d'entité catalogue dédiée).
   */
  refId?: string;
  quantity: number;
  name: string;
  reference: string | null;
  brandName: string | null;
  category: string | null;
  /** Couleur de la catégorie/fonction primaire (hex). Source : CatalogFunction.color. */
  categoryColor: string | null;
  /** Attributs physiques (équipement uniquement, sinon null/false). */
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  weightKg: number | null;
  powerW: number | null;
  /**
   * ID du snapshot ProjectCatalogueSnapshot associé (items Arkyo équipement/adaptateur).
   * Utilisé pour détecter et appliquer la dérive (drift) catalogue Arkyo.
   * null pour les items personnels, panels et accessoires.
   */
  snapshotId: string | null;
  // ── Composants modulaires (châssis type Ross openGear) ──────────────────────
  // Optionnels : fournis par l'API GET inventory (via toScopeBomItem), mais
  // omis par les producteurs SSR (project/rack page.tsx, clone-from-template)
  // qui n'enrichissent pas encore ces champs. Le refetch client les remplit.
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

export type InventaireRack = {
  id: string;
  rigConfigId: string;
  name: string;
  rackType: RackType;
  totalU: number;
  depthMm: number;
  /** Largeur extérieure mm — pertinent pour non-rackable (flight, pelicase…). */
  widthMm: number | null;
  /** Hauteur extérieure mm — pertinent pour non-rackable. */
  heightMm: number | null;
  hasWheels: boolean;
  emptyWeightKg: number | null;
  slotsCount: number;
  constructionChecks: number;
  /**
   * true → contenant rackable (baie 19", flight case…) → mode placement disponible.
   * false → pelicase, casquette, etc. → pas de placement physique.
   */
  isRackable: boolean;
  /**
   * true → au moins un équipement placé dans ce contenant possède des
   * connecteurs (Equipment.connectors non vide). Utilisé par le sélecteur
   * de contenant du synoptique pour masquer les contenants sans connectique
   * (vue focus inutile).
   */
  hasConnectors: boolean;
  /** Position canvas X (px logiques). null → auto-layout grille. */
  canvasX: number | null;
  /** Position canvas Y (px logiques). null → auto-layout grille. */
  canvasY: number | null;
  /**
   * Emplacement (lieu) auquel le contenant est affecté. `null` = contenant
   * hérité de la migration, affiché dans la bande « À affecter ».
   */
  locationId?: string | null;
  /**
   * Contenant virtuel d'un lieu — porte les équipements libres. Jamais listé
   * comme contenant (inventaire, dropdown Rack, documents…), mais ses items
   * comptent dans le BOM / les exports.
   */
  isVirtual?: boolean;
  /** Slots minimaux pour la mini SVG (vue front uniquement). */
  slots: InventaireSlot[];
  /** BOM agrégé (items ajoutés via drag&drop, avant placement physique). */
  bom: InventaireBomItem[];
};

/**
 * Emplacement (lieu) d'un projet — régie, nodal, plateau, car…
 * Regroupe des contenants et des équipements libres (portés par son rack
 * virtuel `virtualRackId`).
 */
export type InventaireLocation = {
  id: string;
  name: string;
  /** Code court pour la numérotation câbles (uppercase, ≤5). */
  cableCode: string | null;
  sortOrder: number;
  /** Rack virtuel du lieu — porte les équipements libres. */
  virtualRackId: string | null;
};

// ── Component ────────────────────────────────────────────────────────────────

// ── Component ────────────────────────────────────────────────────────────────

export type InventaireClientHandle = {
  /** Renvoie le handle de la fiche de lieu (focus + capture export). */
  // arkyo-server: `LocationSheetHandle` arrive avec `location-sheet` (Task 10).
  getCanvas: () => unknown | null;
};

export const InventaireClient = forwardRef<
  InventaireClientHandle,
  {
    rigConfigId: string | null;
    addOpen: boolean;
    onAddOpenChange: (open: boolean) => void;
    onRequestCatalog?: () => void;
  }
>(function InventaireClient(_props, ref) {
  useImperativeHandle(ref, () => ({ getCanvas: () => null }), []);
  return <ComingSoonCanvas />;
});
