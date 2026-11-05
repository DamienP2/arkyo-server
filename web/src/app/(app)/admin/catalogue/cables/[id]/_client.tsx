"use client";

/**
 * TenantCableEditorClient — wrapper client pour l'affichage tenant d'un cordon.
 *
 * Catalogue unifié (2026-07-03) : les items ARKYO purs sont éditables comme
 * les items personnels — le premier enregistrement (autosave compris) crée un
 * fork éclipsant côté API et l'éditeur bascule son id de travail sur le fork
 * sans interrompre la saisie.
 *
 * La lecture pure (`isReadOnly`) ne subsiste QUE pour un item Arkyo hors plan
 * (non accessible) → consultation seule + bandeau plan.
 *
 * Pour un fork éclipsant (`shadowsArkyo`) : action « Récupérer la version
 * Arkyo » dans le header, avec mention drift si la source a évolué.
 */

import {
  CableEditor,
  type CableEditorBrandRef,
  type CableEditorConnectorRef,
  type CableEditorFunctionRef,
  type CableEditorInitial,
} from "./cable-editor";
import { useDeletedItemRedirect } from "../../_lib/use-deleted-item-redirect";

type Item = CableEditorInitial & {
  id: string;
  name: string;
  function?: { id: string; label: string; color: string } | null;
  brand?: { id: string; name: string; logoUrl?: string | null } | null;
  leftConnector?:
    | { id: string; name: string; color?: string | null; iconId?: string | null }
    | null;
  rightConnector?:
    | { id: string; name: string; color?: string | null; iconId?: string | null }
    | null;
};

type Props = {
  item: Item;
  source: "PERSONAL" | "ARKYO";
  isAccessible: boolean;
  /** Fork éclipsant — active « Récupérer la version Arkyo ». */
  shadowsArkyo?: boolean;
  /** La source Arkyo a évolué depuis le fork (mention discrète). */
  arkyoDrift?: boolean;
  /** La source Arkyo a disparu — l'item est autonome (traité comme perso). */
  arkyoSourceGone?: boolean;
  connectors: CableEditorConnectorRef[];
  functions: CableEditorFunctionRef[];
  brands: CableEditorBrandRef[];
};

const TENANT_BACK_URL = "/admin/catalogue?tab=cables";

export function TenantCableEditorClient({
  item,
  source,
  isAccessible,
  shadowsArkyo,
  arkyoDrift,
  arkyoSourceGone: _arkyoSourceGone,
  connectors,
  functions,
  brands,
}: Props) {
  void _arkyoSourceGone;
  const isArkyo = source === "ARKYO";

  // Collaboration : fork supprimé par un autre client (« Récupérer la
  // version Arkyo » ou suppression) → bascule d'URL au lieu d'un id mort.
  useDeletedItemRedirect(item.id, "/admin/catalogue/cables", TENANT_BACK_URL);

  return (
    <CableEditor
      initial={item}
      connectors={connectors}
      functions={functions}
      brands={brands}
      backUrl={TENANT_BACK_URL}
      // Lecture pure UNIQUEMENT pour un item Arkyo hors plan : consultation +
      // bandeau plan. Un item Arkyo accessible est éditable (fork-on-edit).
      isReadOnly={isArkyo && !isAccessible}
      notIncludedInPlan={isArkyo && !isAccessible}
      arkyoSource={isArkyo}
      shadowsArkyo={shadowsArkyo === true}
      arkyoDrift={arkyoDrift === true}
    />
  );
}
