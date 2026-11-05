import { Suspense } from "react";
import { Navigate } from "react-router"; // arkyo-server: garde de page côté client

// arkyo-server: `requireTenantPermissionPage` (serveur) remplacé par le contexte
// de permissions, via la garde commune des pages du catalogue.
import { LoadingState } from "@/components/ui/loading-state";
import { usePageTitle } from "@/lib/hooks/use-page-title";

import { useCatalogAdminGuard } from "./_lib/client-page";
import { CatalogueClient } from "./catalogue-client";

/**
 * /admin/catalogue — items catalogue Arkyo visibles par ce tenant.
 *
 * Server component mince : vérifie le rôle ADMIN puis délègue au client qui
 * gère les 4 onglets (Équipements / Cordons / Adaptateurs / Connecteurs).
 *
 * Les listes elles-mêmes sont chargées côté client via
 * `/api/tenant/catalogue/*` qui filtre par plan d'abonnement du tenant.
 *
 * arkyo-server: SPA sans SSR — composant client. La garde `catalog:admin`
 * attend la fin du chargement des permissions, puis renvoie vers `/dashboard`
 * comme `requireTenantPermissionPage`.
 */
export default function AdminCataloguePage() {
  usePageTitle(); // arkyo-server: titre d'onglet par défaut (pas de metadata dans arkyo)
  // Réservé au OWNER du tenant (ou collaborateur Arkyo en ghost, lecture seule).
  const guard = useCatalogAdminGuard();
  if (guard === "loading") return <LoadingState className="px-8 pt-10" />;
  if (guard === "denied") return <Navigate to="/dashboard" replace />;

  return (
    <Suspense>
      <CatalogueClient />
    </Suspense>
  );
}
