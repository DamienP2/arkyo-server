/**
 * arkyo-server: provisoire. L'éditeur de panel
 * (arkyo:app/(fullscreen)/panels/[id]/panel-editor.tsx) est copié à la Task 12
 * de la phase 3, qui remplace ce fichier. En attendant, le chargeur
 * (`page.tsx`) lui passe déjà les props de la page serveur d'arkyo, et l'écran
 * reste `<ComingSoon />`.
 */

import { ComingSoon } from "@/components/coming-soon";

export function PanelEditor(_props: {
  panel: unknown;
  availableConnectors: unknown;
  connectorCategories: unknown;
  tenantName: string | null;
}) {
  return <ComingSoon />;
}
