/**
 * Types partagés entre les panels du catalogue tenant (Équipements / Cordons /
 * Adaptateurs).
 *
 * L'API tenant renvoie systématiquement `{ arkyo, personal }`. Côté UI on
 * fusionne en une liste unique avec un champ `source` discriminant pour le
 * filtrage et la décoration (badge Arkyo, lock overlay plan).
 */

import type { ConnectorRef, EquipmentCardItem, FunctionRef } from "@/components/catalogue/types";

/** Source d'un item du catalogue tenant — discriminant pour les filtres. */
export type CatalogueSource = "ARKYO" | "PERSONAL";

/** Décoration source ajoutée par l'API. */
export type SourceMeta = {
  source: CatalogueSource;
  /** Pour ARKYO : true si visible dans le plan courant. Pour PERSONAL : toujours true. */
  isAccessible: boolean;
};

/**
 * Métadonnées de fork (catalogue unifié) — présentes sur les items PERSONAL.
 *
 * - `shadowsArkyo` : fork post-refonte qui éclipse son original Arkyo dans la
 *   liste fusionnée (l'API ne renvoie plus l'original tant que le fork existe).
 * - `arkyoDrift` : la source Arkyo a été mise à jour depuis le fork.
 * - `arkyoSourceGone` : la source Arkyo a disparu → l'item est autonome
 *   (traité comme un item perso : supprimable, pas de restore).
 * - Les duplications historiques (`clonedFromArkyoId` + `shadowsArkyo=false`)
 *   gardent le comportement perso classique.
 */
export type ForkMeta = {
  clonedFromArkyoId?: string | null;
  shadowsArkyo?: boolean;
  arkyoDrift?: boolean;
  arkyoSourceGone?: boolean;
};

/** True si l'item est un fork éclipsant actif (restore possible, delete bloqué). */
export function isShadowingFork(item: ForkMeta): boolean {
  return item.shadowsArkyo === true && item.arkyoSourceGone !== true;
}

/** Wrap les responses `{ arkyo, personal }` que l'API tenant renvoie. */
export type CatalogueListResponse<T> = {
  arkyo: (T & SourceMeta)[];
  personal: (T & SourceMeta)[];
};

/** Item équipement tenant unifié — `EquipmentCardItem` + `SourceMeta` + classifications. */
export type TenantEquipmentItem = EquipmentCardItem &
  SourceMeta &
  ForkMeta & {
    visibleFromPlan?: string | null;
    functions?: (FunctionRef & { sortOrder?: number })[];
    /** Soft-FK fonction (utile pour les items personal qui n'ont qu'un functionId). */
    functionId?: string | null;
    /** Soft-FK type d'équipement (CatalogType / TenantEquipment.typeId). */
    typeId?: string | null;
    /** Options métier exposées pour les filtres tenant — alignées sur supervisor. */
    isLightingFixture?: boolean | null;
  };

/** Forme partielle d'un cordon dans la liste tenant. */
export type TenantCableItem = {
  id: string;
  name: string;
  reference: string | null;
  function: (FunctionRef & { sortOrder?: number }) | null;
  functionId?: string | null;
  leftConnector?: ConnectorRef | null;
  leftConnectorId?: string | null;
  leftGender?: string | null;
  rightConnector?: ConnectorRef | null;
  rightConnectorId?: string | null;
  rightGender?: string | null;
  brand?: { id: string; name: string } | null;
  brandId?: string | null;
  model?: string | null;
  useCases?: string[];
  availableLengths?: number[];
  customMinLength?: number | null;
  customMaxLength?: number | null;
  visibleFromPlan?: string | null;
} & SourceMeta &
  ForkMeta;

/** Forme partielle d'un adaptateur dans la liste tenant. */
export type TenantAdapterItem = {
  id: string;
  name: string;
  reference: string | null;
  function: (FunctionRef & { sortOrder?: number }) | null;
  functionId?: string | null;
  inputs: Array<{ connectorTypeId: string; gender: "MALE" | "FEMALE" | "NEUTRAL"; quantity: number; label?: string }>;
  outputs: Array<{ connectorTypeId: string; gender: "MALE" | "FEMALE" | "NEUTRAL"; quantity: number; label?: string }>;
  visibleFromPlan?: string | null;
} & SourceMeta &
  ForkMeta;

/** Helper : fusionne `{ arkyo, personal }` en une seule liste tagguée. */
export function mergeCatalogueResponse<T>(
  resp: CatalogueListResponse<T> | null | undefined,
): (T & SourceMeta)[] {
  if (!resp) return [];
  return [...(resp.arkyo ?? []), ...(resp.personal ?? [])];
}
