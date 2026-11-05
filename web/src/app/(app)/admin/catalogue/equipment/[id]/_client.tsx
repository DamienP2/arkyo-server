"use client";

/**
 * TenantEquipmentEditorClient — wrapper client autour de l'affichage tenant
 * d'un équipement.
 *
 * Catalogue unifié (2026-07-03) : les items ARKYO purs sont éditables comme
 * les items personnels — le premier enregistrement (autosave compris) crée
 * un fork éclipsant côté API et l'éditeur bascule son id de travail sur le
 * fork sans interrompre la saisie.
 *
 * Pour un fork éclipsant (`shadowsArkyo`) : action « Récupérer la version
 * Arkyo » dans le header, avec mention drift si la source a évolué.
 */

import { EquipmentEditor } from "@/app/(app)/admin/equipment/[id]/equipment-editor";
import { useDeletedItemRedirect } from "../../_lib/use-deleted-item-redirect";
import type {
  Brand,
  CatalogFunctionLite,
  CatalogPhaseLite,
  CatalogTypeLite,
  ConnectorType,
  EquipmentData,
  Signal,
  SignalCategory,
} from "@/app/(app)/admin/equipment/[id]/_editor/types";

type Props = {
  item: EquipmentData;
  source: "PERSONAL" | "ARKYO";
  isAccessible: boolean;
  /** Fork éclipsant — active « Récupérer la version Arkyo ». */
  shadowsArkyo?: boolean;
  /** La source Arkyo a évolué depuis le fork (mention discrète). */
  arkyoDrift?: boolean;
  /** La source Arkyo a disparu — l'item est autonome (traité comme perso). */
  arkyoSourceGone?: boolean;
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
const TENANT_BACK_URL = "/admin/catalogue?tab=equipment";

export function TenantEquipmentEditorClient({
  item,
  source,
  isAccessible: _isAccessible,
  shadowsArkyo,
  arkyoDrift,
  arkyoSourceGone,
  brands,
  connectorTypes,
  signals,
  functions,
  phases,
  types,
  cableSafetyDefaultMm,
}: Props) {
  void _isAccessible;

  // Collaboration : fork supprimé par un autre client (« Récupérer la
  // version Arkyo » ou suppression) → bascule d'URL au lieu d'un id mort.
  useDeletedItemRedirect(item.id, "/admin/catalogue/equipment", TENANT_BACK_URL);

  return (
    <EquipmentEditor
      equipment={item}
      brands={brands}
      connectorTypes={connectorTypes}
      signals={signals}
      signalCategories={[] as SignalCategory[]}
      uHeights={U_HEIGHTS}
      cableSafetyDefaultMm={cableSafetyDefaultMm}
      backUrl={TENANT_BACK_URL}
      saveApiBase="/api/tenant/catalogue/equipment"
      functions={functions}
      phases={phases}
      types={types}
      showDistribution={false}
      tenantContext={{
        isTenantMode: true,
        isArkyoSource: source === "ARKYO",
        shadowsArkyo: shadowsArkyo === true,
        arkyoDrift: arkyoDrift === true,
        arkyoSourceGone: arkyoSourceGone === true,
      }}
    />
  );
}
