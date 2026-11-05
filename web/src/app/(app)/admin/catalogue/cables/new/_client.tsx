"use client";

/**
 * NewTenantCableClient — wrapper client autour de `CableEditor` en mode
 * CREATE pour le tenant.
 *
 * Aligné sur le pattern « Nouvel équipement » :
 *  - Pas de prop `initial` → l'éditeur démarre vide.
 *  - `CableEditor` gère lui-même le POST + la redirection vers
 *    `/admin/catalogue/cables/[newId]` (passage en mode édition).
 *  - `CableEditorDialog` n'est plus utilisé ici — il reste disponible pour
 *    une saisie rapide depuis d'autres vues si besoin.
 */

import {
  CableEditor,
  type CableEditorBrandRef,
  type CableEditorConnectorRef,
  type CableEditorFunctionRef,
} from "@/app/(app)/admin/catalogue/cables/[id]/cable-editor";

type Props = {
  connectors: CableEditorConnectorRef[];
  functions: CableEditorFunctionRef[];
  brands: CableEditorBrandRef[];
};

export function NewTenantCableClient({ connectors, functions, brands }: Props) {
  return (
    <CableEditor
      connectors={connectors}
      functions={functions}
      brands={brands}
      backUrl="/admin/catalogue?tab=cables"
    />
  );
}
