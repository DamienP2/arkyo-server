// arkyo-server: `requireTenantPermissionPage` (serveur) remplacé par la garde
// client `useTenantPermissionPage` (contexte de permissions du layout
// `(fullscreen)`) ; `children` devient l'`<Outlet />` de react-router.
import { Outlet } from "react-router";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { useTenantPermissionPage } from "@/components/client-page";

/**
 * Layout du mode PROJET — pleinement plein écran (route group
 * `(fullscreen)`). L'éditeur projet utilise `EditorShell` partagé avec le
 * rack-editor, sans sidebar tenant globale. Les sous-routes lourdes
 * (`inventaire/rack/[rackId]`, `inventaire/synoptique`) restent montées sous
 * cet arbre — chacune charge son propre `RackEditor`.
 *
 * RBAC : chokepoint `projects:read` couvrant l'éditeur projet et toutes ses
 * sous-pages (fiche, inventaire, cartographie…). Le gating plus fin À
 * L'INTÉRIEUR du projet (ex. sous-éditeur rack `design:write`, actions
 * destructives) relève de la Phase C / agent-canvas.
 *
 * `ConfirmProvider` est requis pour le `useConfirm()` utilisé par
 * `inventaire-client.tsx` (suppression de contenants) et par les enfants.
 */
export default function ProjectLayout() {
  const gate = useTenantPermissionPage("projects", "read");
  if (gate) return gate;
  return (
    <ConfirmProvider>
      <Outlet />
    </ConfirmProvider>
  );
}
