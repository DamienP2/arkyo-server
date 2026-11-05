/**
 * Types partagés pour les cards du catalogue (supervisor + tenant).
 *
 * Ces types sont volontairement minces et orientés présentation : ils décrivent
 * la forme attendue par les composants `*-card.tsx` de `components/catalogue/`.
 * Les routes API (supervisor et tenant) doivent retourner les items dans ce
 * shape pour que les cards rendent un design identique partout.
 *
 * Aucune dépendance Prisma ou Next.js — pur TS.
 */

import type { CSSProperties } from "react";

export type Gender = "MALE" | "FEMALE" | "NEUTRAL";

/** Référence connecteur minimale partagée par toutes les cards. */
export type ConnectorRef = {
  id: string;
  name: string;
  color: string | null;
};

/** Fonction catalogue (signature couleur + label) — pivot taxonomique. */
export type FunctionRef = {
  id: string;
  label: string;
  color: string;
};

/** Marque (logo facultatif pour l'EquipmentCard). */
export type BrandRef = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

/** Champs communs à toutes les cards catalogue. */
export type CatalogueCardCommon = {
  id: string;
  name: string;
  reference: string | null;
  /** Fonction associée (couleur + label). null = "Sans fonction". */
  function: FunctionRef | null;
};

// ── Equipment ────────────────────────────────────────────────────────────────

/** Largeur rack (compatible Prisma WidthFraction). */
export type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";

/** Catégorie équipement legacy (relation directe — peu utilisée côté supervisor). */
export type EquipmentCategoryRef = {
  id: string;
  name: string;
  color?: string | null;
};

/**
 * Item équipement présenté dans une `EquipmentCard`.
 *
 * Les champs `category`, `equipmentCategory` et `heightU` sont optionnels pour
 * accommoder à la fois le shape supervisor (riche) et tenant (read-only filtré
 * par plan).
 */
export type EquipmentCardItem = CatalogueCardCommon & {
  brand: BrandRef | null;
  heightU: number | null;
  imageUrl: string | null;
  /** Override icône équipement — nom lucide curated ou URL uploadée. */
  iconUrl?: string | null;
  /** Free-text legacy (souvent null). */
  category: string | null;
  /** Catégorie via FK (legacy, peu utilisé). */
  equipmentCategory: EquipmentCategoryRef | null;
  /** Icône héritée de la catégorie — nom lucide curated ou URL uploadée. */
  categoryIconId?: string | null;
  // Champs optionnels (supervisor uniquement) — exposés pour les badges visuels.
  isRackable?: boolean;
  widthFraction?: WidthFraction | null;
  powerW?: number | null;
  weight?: number | null;
  is2110?: boolean | null;
  /** Source ARKYO (tag visuel dans la liste) — supervisor uniquement. */
  sourceType?: string | null;
  /** ID de l'entité côté Arkyo (utilisé pour le badge "update available"). */
  sourceId?: string | null;
};

// ── Cable ────────────────────────────────────────────────────────────────────

/** Use-case d'un cordon assemblé (catalogue Arkyo). */
export type CableUseCase = "INSTALLATION" | "PRESTATION";

export type CableCardItem = CatalogueCardCommon & {
  leftConnector: ConnectorRef | null;
  leftGender: Gender;
  rightConnector: ConnectorRef | null;
  rightGender: Gender;
  brand: BrandRef | null;
  model: string | null;
  // Optionnel — supervisor expose les use-cases et longueurs presta.
  useCases?: CableUseCase[];
  availableLengths?: number[];
  customMinLength?: number | null;
  customMaxLength?: number | null;
};

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Endpoint d'adaptateur tel que stocké dans le JSON `inputs/outputs`.
 *
 * Note : la BDD stocke `{ connectorTypeId, gender, quantity, label }`. Pour
 * l'affichage dans une card, on a besoin du connecteur résolu — la card
 * accepte donc une `ctMap` (lookup connectorTypeId → ConnectorRef) en plus de
 * l'adapter.
 */
export type AdapterPort = {
  connectorTypeId: string;
  gender: Gender;
  /** Nombre d'instances (1 = par défaut). Une qte de 4 = 4 lignes affichées. */
  quantity: number;
  label?: string;
};

export type AdapterCardItem = CatalogueCardCommon & {
  inputs: AdapterPort[];
  outputs: AdapterPort[];
  /** Source ARKYO — utile pour masquer/afficher des actions côté supervisor. */
  sourceType?: string | null;
  sourceId?: string | null;
};

// ── Connector ────────────────────────────────────────────────────────────────

export type ConnectorCardItem = CatalogueCardCommon & {
  iconId: string;
  /** Override de couleur — hérite de la fonction si null. */
  color: string | null;
};

// ── Grid densities ───────────────────────────────────────────────────────────
//
// Source unique de vérité pour les largeurs minimum des grilles catalogue.
// Utilisée par supervisor ET tenant pour garantir le même nombre de colonnes
// à résolution écran égale. Modifier ici met à jour les deux faces.

/** Largeur min (px) d'une card dans la grille. */
export const CATALOGUE_GRID_MIN = {
  equipment: 260,
  cable: 320,
  adapter: 320,
  connector: 280,
} as const;

/** Helper : style CSS prêt à injecter dans `style={...}`. */
export function catalogueGridStyle(
  kind: keyof typeof CATALOGUE_GRID_MIN,
): CSSProperties {
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${CATALOGUE_GRID_MIN[kind]}px, 1fr))`,
  };
}
