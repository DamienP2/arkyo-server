"use client";

/**
 * NewTenantEquipmentClient — wrapper client autour de `EquipmentEditor`
 * en mode CREATE pour le tenant.
 *
 * Différences clés vs. la page `[id]/_client.tsx` :
 *  - Pas de prop `equipment` → l'éditeur démarre vide.
 *  - `createRedirectPath` redirige vers `/admin/catalogue/equipment/[newId]`
 *    après la création (passage automatique en mode édition).
 *  - `tenantContext.isTenantMode = true` désactive l'auto-save et impose
 *    la sauvegarde manuelle via le bouton « Enregistrer ».
 */

import { EquipmentEditor } from "@/app/(app)/admin/equipment/[id]/equipment-editor";
import type {
  Brand,
  CatalogFunctionLite,
  CatalogPhaseLite,
  CatalogTypeLite,
  ConnectorType,
  Signal,
  SignalCategory,
} from "@/app/(app)/admin/equipment/[id]/_editor/types";

type Props = {
  brands: Brand[];
  connectorTypes: ConnectorType[];
  signals: Signal[];
  functions: CatalogFunctionLite[];
  phases: CatalogPhaseLite[];
  types: CatalogTypeLite[];
  /** Global « Sécurité câblage » (mm) du tenant, défaut 150. */
  cableSafetyDefaultMm?: number;
};

const U_HEIGHTS = [1, 2, 4, 8, 10, 12, 16, 24, 42];

export function NewTenantEquipmentClient({
  brands,
  connectorTypes,
  signals,
  functions,
  phases,
  types,
  cableSafetyDefaultMm,
}: Props) {
  return (
    <EquipmentEditor
      equipment={null}
      brands={brands}
      connectorTypes={connectorTypes}
      signals={signals}
      signalCategories={[] as SignalCategory[]}
      uHeights={U_HEIGHTS}
      cableSafetyDefaultMm={cableSafetyDefaultMm}
      backUrl="/admin/catalogue?tab=equipment"
      saveApiBase="/api/tenant/catalogue/equipment"
      functions={functions}
      phases={phases}
      types={types}
      showDistribution={false}
      tenantContext={{
        isTenantMode: true,
        isArkyoSource: false,
      }}
      createRedirectPath={(id) => `/admin/catalogue/equipment/${id}`}
    />
  );
}
