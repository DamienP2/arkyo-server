import { Suspense } from "react";

// arkyo-server: `mainDb` / `requireTenantPermissionPage` (serveur) remplacés
// par `ClientPage` (contexte de permissions) et l'API ; plus de `redirect`
// (le site existe toujours).
import { ClientPage } from "@/components/client-page";
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { Building2 } from "@/components/ui/icons";
import { api } from "@/lib/api-client";

import { EspaceClient, type EspaceTenant } from "./espace-client";

/**
 * /admin/espace — page « Espace » du tenant (ex-onglet « Espace » des Paramètres).
 *
 * Server Component mince :
 *  - garde ADMIN
 *  - fetch initial : infos tenant + rôle membership (pour distinguer OWNER vs autres)
 *  - délègue à `EspaceClient` qui orchestre les 5 sub-tabs.
 *
 * Sub-tabs :
 *   Dashboard       (vue d'ensemble : hero + équipe + catalogue + activité)
 *   Informations    (édition nom + logo — OWNER uniquement)
 *   Abonnements     (plan actuel, plans dispo, demande de changement)
 *   Factures        (liste paiements avec filtres année/statut)
 *   Suppression     (zone dangereuse : purge référentiels + suppression espace)
 *
 * Les données fines (subscription, payments, …) sont chargées côté client
 * via `/api/tenant/espace/...` pour réduire le poids du SSR.
 *
 * arkyo-server: SPA sans SSR — le Server Component devient un composant client
 * (`ClientPage` : garde `settings:admin` → `/dashboard`, `<LoadingState>`,
 * erreur avec « Réessayer »). Le site vient de
 * `GET /api/tenant/espace/informations` (`{ id, name, logoUrl }`) ; `isOwner`
 * du contexte de permissions. Seul l'onglet Informations est repris (pas
 * d'abonnement, de factures ni de suppression de l'espace).
 */
export default function AdminEspacePage() {
  // Réservé au OWNER du tenant (ou collaborateur Arkyo en ghost, lecture seule).
  const { isOwner } = useTenantPermissions(); // arkyo-server: OWNER lu dans le contexte de permissions

  return (
    <ClientPage
      permission={SETTINGS_ADMIN}
      icon={<Building2 strokeWidth={1.5} />}
      fallbackError="Impossible de charger les informations de l'espace."
      load={loadTenant}
    >
      {(tenant) => (
        <Suspense>
          <EspaceClient tenant={tenant} isOwner={isOwner} />
        </Suspense>
      )}
    </ClientPage>
  );
}

// arkyo-server: garde et chargement de la page.
const SETTINGS_ADMIN = ["settings", "admin"] as const;

function loadTenant(): Promise<EspaceTenant> {
  return api.get<EspaceTenant>("/api/tenant/espace/informations");
}
