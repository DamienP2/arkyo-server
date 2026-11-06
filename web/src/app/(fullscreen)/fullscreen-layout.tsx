/**
 * Layout `(fullscreen)` : arkyo:app/(fullscreen)/layout.tsx rendu côté client —
 * éditeurs plein écran sans sidebar ni topbar.
 *
 * Mêmes gardes que le layout `(app)` (session, `mustChangePassword`).
 * Retiré d'arkyo (SaaS) : `BugReportWidget`.
 */

import { Navigate, Outlet } from "react-router";
import { AppSync } from "@/components/app-sync";
import { PresenceProvider } from "@/components/presence/presence-provider";
import { TenantPermissionsProvider } from "@/components/tenant-permissions-context";
import { useShellGate } from "@/app/(app)/app-layout";

// Layout plein écran — sans sidebar, sans overflow qui casse position:fixed sur iOS
export default function FullscreenLayout() {
  const gate = useShellGate();

  if (gate === "loading") return null;
  if (gate.kind === "auth") return <Navigate to="/auth" replace />;
  if (gate.kind === "password") return <Navigate to="/auth/password" replace />;

  // arkyo-server: permissions du layout pour la garde des pages plein écran
  // (`ClientPage`, à la place de `requireTenantPermissionPage` côté serveur).
  return (
    <TenantPermissionsProvider initialPermissions={gate.permissions}>
      <PresenceProvider>
        <Outlet />
        <AppSync />
      </PresenceProvider>
    </TenantPermissionsProvider>
  );
}
