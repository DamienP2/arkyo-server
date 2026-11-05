"use client";

/**
 * TenantAdapterEditorClient — wrapper client pour l'affichage tenant d'un
 * adaptateur.
 *
 * Catalogue unifié (2026-07-03) : les items ARKYO purs sont éditables comme
 * les items personnels — le premier enregistrement (autosave compris) crée
 * un fork éclipsant côté API et l'éditeur bascule son id de travail sur le
 * fork sans interrompre la saisie. La lecture seule ne reste que pour un item
 * Arkyo hors plan (consultation, bannière plan conservée).
 *
 * Pour un fork éclipsant (`shadowsArkyo`) : action « Récupérer la version
 * Arkyo » dans le header, avec mention drift si la source a évolué.
 */

import {
  AdapterEditor,
  type AdapterEditorConnectorRef,
  type AdapterEditorFunctionRef,
  type AdapterEditorInitial,
} from "./adapter-editor";
import { useDeletedItemRedirect } from "../../_lib/use-deleted-item-redirect";

const TENANT_BACK_URL = "/admin/catalogue?tab=adapters";

type Item = AdapterEditorInitial & {
  id: string;
  name: string;
  function?: { id: string; label: string; color: string } | null;
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
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
};

export function TenantAdapterEditorClient({
  item,
  source,
  isAccessible,
  shadowsArkyo,
  arkyoDrift,
  arkyoSourceGone: _arkyoSourceGone,
  connectors,
  functions,
}: Props) {
  void _arkyoSourceGone;
  const isArkyo = source === "ARKYO";

  // Collaboration : fork supprimé par un autre client (« Récupérer la
  // version Arkyo » ou suppression) → bascule d'URL au lieu d'un id mort.
  useDeletedItemRedirect(item.id, "/admin/catalogue/adapters", TENANT_BACK_URL);

  return (
    <AdapterEditor
      initial={item}
      connectors={connectors}
      functions={functions}
      backUrl={TENANT_BACK_URL}
      // Lecture seule UNIQUEMENT pour un item Arkyo hors plan (consultation).
      isReadOnly={isArkyo && !isAccessible}
      notIncludedInPlan={isArkyo && !isAccessible}
      arkyoSource={isArkyo}
      shadowsArkyo={shadowsArkyo === true}
      arkyoDrift={arkyoDrift === true}
    />
  );
}
