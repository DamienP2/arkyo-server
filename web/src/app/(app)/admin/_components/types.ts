/**
 * Types partagés entre les onglets admin extraits.
 * Source unique pour éviter la duplication — à maintenir en miroir
 * avec les props acceptées par `AdminClient`.
 */

import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";

export type SignalType = {
  id: string;
  name: string;
  category: string;
  color: string;
  connectors: unknown;
  isDefault: boolean;
  isActive: boolean;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
  protocol?: string | null;
  bandwidth?: string | null;
  categoryId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  pinned?: boolean;
  sortOrder?: number;
  visibleFromPlan?: string | null;
  createdAt: Date;
};

export type SignalCategory = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
  sourceType?: string | null;
  pinned?: boolean;
  visibleFromPlan?: string | null;
  createdAt: Date;
};

export type Brand = {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  sourceType?: string | null;
  visibleFromPlan?: string | null;
};

export type EquipmentItem = {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  brandId: string | null;
  brand?: { id: string; name: string; logoUrl: string | null } | null;
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  widthFraction: string;
  dimLmm: number | null;
  dimWmm: number | null;
  dimHmm: number | null;
  weight: number | null;
  powerW: number | null;
  hasDualPsu: boolean;
  is2110: boolean;
  ip2110Mode: string | null;
  connectors: unknown;
  imageUrl: string | null;
  /** Override équipement — nom lucide curated ou URL uploadée. Hérite de la catégorie si null. */
  iconUrl?: string | null;
  notes: string | null;
  tags: unknown;
  isActive: boolean;
  sourceType?: string | null;
  sourceId?: string | null;
  pinned?: boolean;
  sortOrder?: number;
  visibleFromPlan?: string | null;
  /** Indicateur "lumière" — uniquement côté supervisor (CatalogEquipment). */
  isLightingFixture?: boolean;
  /** FK vers CatalogType — uniquement côté supervisor. */
  typeId?: string | null;
  /** Type rattaché (CatalogType) — uniquement côté supervisor. */
  type?: { id: string; name: string; functionId: string | null } | null;
  /** Jointure M:N CatalogEquipment ⇄ CatalogFunction — uniquement supervisor. */
  functions?: Array<{
    functionId: string;
    function?: { id: string; key: string; label: string; color: string };
  }>;
};

export type CustomSymbol = {
  id: string;
  label: string;
  svgUrl: string;
  hasGeneric: boolean;
  hasNeutrikD: boolean;
  isBuiltin: boolean;
  sourceType?: string | null;
  visibleFromPlan?: string | null;
};

export type ConnectorCategory = {
  id: string;
  key: string;
  label: string;
  color: string;
  sortOrder: number;
};

export type EquipmentCategory = {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
  children?: EquipmentCategory[];
  visibleFromPlan?: string | null;
  /** Icône associée — nom lucide curated ou URL uploadée (commence par `/` ou `http`). */
  iconId?: string | null;
};

export type ConnectorType = {
  id: string;
  name: string;
  version: string | null;
  category: string;
  iconId: string;
  color: string;
  hasNeutrikD: boolean;
  notes: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  pinned?: boolean;
  sortOrder?: number;
  visibleFromPlan?: string | null;
};

export type UserSafe = {
  id: string;
  /** Id du Membership tenant — utilisé pour les opérations /api/tenant/members. */
  membershipId: string;
  email: string;
  name: string | null;
  /** Tier dénormalisé (enum) — conservé pour compat ; la source de vérité est `roleKey`. */
  role: "OWNER" | "ADMIN" | "CHEF_PROJET" | "TECHNICIEN" | "CONSULTATION";
  /** Clé du TenantRole — source de vérité RBAC. Null tant que non backfillé. */
  roleKey: string | null;
  isActive: boolean;
  /** Invitation envoyée mais pas encore acceptée. */
  isPending: boolean;
  createdAt: Date;
};

// ── RBAC tenant ────────────────────────────────────────────────────────────────

export type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";

/** Rôle tenant tel qu'exposé par `/api/tenant/roles` (consommé côté client). */
export type TenantRoleSafe = {
  id: string;
  key: string;
  label: string;
  color: string;
  isOwner: boolean;
  isBuiltin: boolean;
  permissions: Record<TenantDomain, TenantLevel>;
  memberCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type AdminSection =
  | "cablage/signals"
  | "cablage/connectors"
  | "cablage/categories"
  | "cablage/symbols"
  | "cablage/numbering"
  | "cablage/adapters"
  | "cablage/cables"
  | "users/list"
  | "users/groups"
  | "users/roles"
  | "equipment/active"
  | "equipment/archived"
  | "equipment/brands"
  | "equipment/categories"
  | "print/synoptic"
  | "print/labels"
  | "units/rack"
  | "units/cabling"
  | "config/app";

export type AdminView = "grid" | "list";
