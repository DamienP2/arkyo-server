/**
 * lib/types/catalog.ts — Shapes "Lite" des entités catalogue (main DB),
 * consommées par les composants tenant après refacto cross-DB.
 *
 * Le tenant DB stocke uniquement des soft-FK (`catalogEquipmentId`,
 * `catalogAdapterId`, `catalogConnectorTypeId`) sans relation Prisma cross-DB.
 * Toute lecture passe désormais soit par enrichissement SSR (page serveur qui
 * fetch `mainDb.catalogXxx.findMany`), soit par lookup runtime via
 * `POST /api/tenant/catalogue/lookup` (hook `useCatalogLookup`).
 *
 * Les types `*Lite` ne reflètent QUE les champs effectivement consommés par les
 * éditeurs (rack-editor / synoptic-view / panel-editor) et leurs composants
 * dérivés. Si tu ajoutes un champ dans un canvas, ajoute-le ici puis assure-toi
 * que la route `/api/tenant/catalogue/lookup` le renvoie.
 *
 * Les champs `Json` natifs Postgres (connectors, inputs, outputs, tags,
 * customFields) sont typés `unknown` côté client — le bord de l'API doit
 * type-guarder via `Array.isArray()` / `typeof === "object"`.
 */

// ── Brand (catégorie / fabricant) ─────────────────────────────────────────

export type CatalogBrandLite = {
  id: string;
  name: string;
};

// ── Equipment ─────────────────────────────────────────────────────────────

/**
 * Sous-ensemble de `CatalogEquipment` consommé par rack-editor /
 * synoptic-view / inventaire-client. Les champs nullable suivent la shape
 * Prisma (la majorité des dimensions/poids sont optionnels en catalogue).
 */
export type CatalogEquipmentLite = {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  categoryId: string | null;
  heightU: number | null;
  widthFraction: string | null;
  depthMm: number | null;
  /** Override de la réserve câblage arrière (mm). `null` = hérite du global `cable_safety_depth_mm`. */
  rearCableDepthMm?: number | null;
  /** Dimensions free-standing (mm) — utilisées par draggable-items pour le rendu hors-rack. */
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  isRackable: boolean;
  /** Châssis modulaire — peut accueillir des composants. */
  isComponentHost?: boolean;
  /** Nombre de slots internes de l'hôte. */
  hostSlotCount?: number | null;
  /** Est un composant (s'insère dans un hôte, pas d'empreinte rack propre). */
  isComponent?: boolean;
  /** Slots occupés dans l'hôte. */
  componentSlotSpan?: number;
  /** Array<ConnectorEntry> sérialisé Postgres Json — type-guard au consommateur. */
  connectors: unknown;
  imageUrl: string | null;
  rackSymbolUrl: string | null;
  rackSymbolRearUrl: string | null;
  rackPhotoFrontUrl: string | null;
  rackPhotoRearUrl: string | null;
  brand: CatalogBrandLite | null;
  /**
   * Origine de l'item résolu : `"ARKYO"` = `CatalogEquipment` (main DB),
   * `"PERSONAL"` = `TenantEquipment` (tenant DB), résolu en fallback quand
   * l'id est absent de la main DB. Champ additif — absent = `"ARKYO"` pour
   * les appels historiques qui ne passent pas de client tenant.
   * Cf. `fetchCatalogEquipmentMap` (`lib/services/catalog-enrich.ts`).
   */
  source?: "ARKYO" | "PERSONAL";
};

// ── Adapter ────────────────────────────────────────────────────────────────

/**
 * Sous-ensemble de `CatalogAdapter` — utilisé par SynopticAdapterNode et
 * l'inventaire. `inputs` / `outputs` sont des `AdapterIO[]` sérialisés.
 */
export type CatalogAdapterLite = {
  id: string;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  /** AdapterIO[] (face = "left"|"right" implicite, connectorTypeId pointe main DB). */
  inputs: unknown;
  outputs: unknown;
  notes: string | null;
  /** Cf. `CatalogEquipmentLite.source` — même convention (additif, fallback tenant). */
  source?: "ARKYO" | "PERSONAL";
};

// ── ConnectorType ──────────────────────────────────────────────────────────

/**
 * Sous-ensemble de `CatalogConnectorType` — utilisé par les nœuds panel
 * (synoptic), les icônes de connecteur, le picker d'adaptateur.
 */
export type CatalogConnectorTypeLite = {
  id: string;
  name: string;
  versions: string[];
  iconId: string;
  color: string;
  category: string | null;
  /**
   * Dérivé du symbole référencé (iconId/svgUrl → CatalogSymbol) — JAMAIS un
   * champ stocké, cf. app/api/_lib/connector-dtype.ts. Consommé par le panel
   * editor (`panel-editor.tsx`) pour n'autoriser la pose en coque Neutrik D
   * que sur les connecteurs qui existent effectivement en version D.
   */
  hasNeutrikD: boolean;
  /** URL du SVG « version D » du symbole (override/custom) — null = rendu
   *  code `ConnectorIcon dType` côté client. */
  dTypeSvgUrl: string | null;
};

// ── Discriminant pour la route /api/tenant/catalogue/lookup ────────────────

export type CatalogLookupKind = "equipment" | "adapter" | "connectorType";

export type CatalogLookupResultMap = {
  equipment: CatalogEquipmentLite;
  adapter: CatalogAdapterLite;
  connectorType: CatalogConnectorTypeLite;
};

export type CatalogLookupResult<K extends CatalogLookupKind> = CatalogLookupResultMap[K];
