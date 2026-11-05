import { Suspense, useEffect, useState } from "react"; // arkyo-server: page cliente (useEffect, useState)
import { Navigate } from "react-router"; // arkyo-server: garde de page côté client

// arkyo-server: `requireTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par le contexte de permissions et l'API.
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { LoadingState } from "@/components/ui/loading-state";
import { api } from "@/lib/api-client";
import { usePageTitle } from "@/lib/hooks/use-page-title";

import { ParametresClient } from "./parametres-client";

/**
 * /admin/parametres — page Paramètres du tenant.
 *
 * Server component qui charge l'app config locale tenant.
 * Les référentiels (catégories / marques / symboles / signaux / câblage /
 * dimensions) sont chargés côté client via `/api/tenant/parametres/...`
 * pour réduire le poids du SSR.
 *
 * Note : l'ancien onglet « Espace » a été déplacé vers la page dédiée
 * `/admin/espace` (avec ses propres sub-tabs Dashboard/Informations/
 * Abonnements/Factures/Suppression).
 *
 * arkyo-server: SPA sans SSR — le Server Component devient un composant client.
 * La garde `settings:admin` lit le contexte de permissions (redirection vers
 * `/dashboard` comme `requireTenantPermissionPage`) ; l'app config vient de
 * `GET /api/tenant/parametres/application` (mêmes clés que `db.appConfig`),
 * avec `<LoadingState>` pendant le chargement.
 */
export default function AdminParametresPage() {
  usePageTitle(); // arkyo-server: titre d'onglet par défaut (pas de metadata dans arkyo)
  const { has } = useTenantPermissions();
  const allowed = has("settings", "admin");

  const [appConfigMap, setAppConfigMap] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api
      .get<Record<string, string>>("/api/tenant/parametres/application")
      .then((configs) => {
        if (!cancelled) setAppConfigMap(configs ?? {});
      })
      .catch(() => {
        // Clés absentes : les onglets retombent sur leurs valeurs par défaut.
        if (!cancelled) setAppConfigMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  if (!allowed) return <Navigate to="/dashboard" replace />;

  if (!appConfigMap) return <LoadingState className="px-8 pt-10" />;

  return (
    <Suspense>
      <ParametresClient appConfig={appConfigMap} />
    </Suspense>
  );
}
