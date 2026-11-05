import { Suspense, useCallback, useEffect, useState } from "react"; // arkyo-server: page cliente (useCallback, useEffect, useState)
import { Navigate } from "react-router"; // arkyo-server: garde de page côté client

// arkyo-server: `requireTenantDb` / `requireTenantPermissionPage` (serveur) remplacés
// par le contexte de permissions et l'API.
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { Settings } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { api, getApiErrorMessage } from "@/lib/api-client";
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
 * avec `<LoadingState>` pendant le chargement. Un échec de lecture affiche une
 * erreur avec « Réessayer » (jamais des valeurs par défaut prises pour les
 * valeurs enregistrées).
 */
export default function AdminParametresPage() {
  usePageTitle(); // arkyo-server: titre d'onglet par défaut (pas de metadata dans arkyo)
  const { has, loading } = useTenantPermissions();
  const allowed = !loading && has("settings", "admin");

  const [appConfigMap, setAppConfigMap] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api
      .get<Record<string, string> | null>("/api/tenant/parametres/application")
      .then((configs) => {
        // Réponse OK sans corps : aucune clé enregistrée.
        if (!cancelled) setAppConfigMap(configs ?? {});
      })
      .catch((e) => {
        if (!cancelled) {
          setError(getApiErrorMessage(e, "Impossible de charger les paramètres."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, attempt]);

  // Permissions pas encore connues : on attend avant de décider de la garde.
  if (loading) return <LoadingState className="px-8 pt-10" />;

  if (!allowed) return <Navigate to="/dashboard" replace />;

  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Settings strokeWidth={1.5} />}
          title="Erreur"
          description={error}
          action={<EmptyStateAction onClick={retry}>Réessayer</EmptyStateAction>}
        />
      </div>
    );
  }

  if (!appConfigMap) return <LoadingState className="px-8 pt-10" />;

  return (
    <Suspense>
      <ParametresClient appConfig={appConfigMap} />
    </Suspense>
  );
}
