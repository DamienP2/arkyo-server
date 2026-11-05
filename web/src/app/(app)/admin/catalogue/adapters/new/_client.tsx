"use client";

/**
 * NewTenantAdapterClient — wrapper client autour de `AdapterEditor` en mode
 * CREATE pour le tenant.
 *
 * Aligné sur le pattern « Nouvel équipement » :
 *  - Pas de prop `initial` → l'éditeur démarre vide.
 *  - `AdapterEditor` gère lui-même le POST + la redirection vers
 *    `/admin/catalogue/adapters/[newId]` (passage en mode édition).
 *  - `AdapterEditorDialog` n'est plus utilisé ici — il reste disponible pour
 *    une saisie rapide depuis d'autres vues si besoin.
 */

import {
  AdapterEditor,
  type AdapterEditorConnectorRef,
  type AdapterEditorFunctionRef,
} from "@/app/(app)/admin/catalogue/adapters/[id]/adapter-editor";

type Props = {
  connectors: AdapterEditorConnectorRef[];
  functions: AdapterEditorFunctionRef[];
};

export function NewTenantAdapterClient({ connectors, functions }: Props) {
  return (
    <AdapterEditor
      connectors={connectors}
      functions={functions}
      backUrl="/admin/catalogue?tab=adapters"
    />
  );
}
