/**
 * arkyo-server: socle des pages du catalogue d'administration. Les Server
 * Components d'arkyo (`page.tsx`) deviennent des composants clients : ce module
 * reprend ce qu'ils faisaient côté serveur, au même moment du rendu.
 *
 * - Garde `requireTenantPermissionPage("catalog", "admin")` : on attend la fin
 *   du chargement des permissions, puis `<Navigate to="/dashboard">` (le
 *   `redirect("/dashboard")` d'arkyo).
 * - Chargement des données de la page via l'API (`load`), avec `<LoadingState>`
 *   en attendant. Un 404 rend la page 404 de Next (`notFound()` d'arkyo) ; tout
 *   autre échec affiche l'erreur avec « Réessayer », jamais des valeurs par
 *   défaut prises pour les vraies.
 * - `router.refresh()` (émis par `<AppSync>` à chaque évènement temps réel)
 *   relance le chargement sans démonter la page, comme le re-rendu du Server
 *   Component qui passe de nouvelles props aux éditeurs (`useServerReconcile`).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { NotFoundPage, useRefresh } from "next/navigation";

import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { Package } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiError, getApiErrorMessage } from "@/lib/api-client";
import { usePageTitle } from "@/lib/hooks/use-page-title";

type State<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/**
 * Page d'administration du catalogue chargée côté client.
 *
 * @param load  Requêtes de la page (équivalent des requêtes Prisma d'arkyo).
 * @param loadKey  Identité des données (ex. l'id de l'URL) : un changement
 *   relance le chargement depuis l'état d'attente.
 * @param children  Rendu de la page une fois les données chargées.
 */
export function CatalogAdminPage<T>({
  load,
  loadKey = "",
  children,
}: {
  load: () => Promise<T>;
  loadKey?: string;
  children: (data: T) => ReactNode;
}) {
  usePageTitle(); // titre d'onglet par défaut (pas de metadata dans arkyo)
  const { has, loading } = useTenantPermissions();
  const allowed = !loading && has("catalog", "admin");

  const [state, setState] = useState<State<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasData = useRef(false);

  const run = useCallback((silent: boolean) => {
    let cancelled = false;
    loadRef
      .current()
      .then((data) => {
        if (cancelled) return;
        hasData.current = true;
        setState({ kind: "ready", data });
      })
      .catch((e) => {
        if (cancelled) return;
        // Rechargement silencieux (refresh) : on garde les données affichées.
        if (silent && hasData.current) return;
        if (e instanceof ApiError && e.status === 404) {
          setState({ kind: "not-found" });
        } else {
          setState({
            kind: "error",
            message: getApiErrorMessage(e, "Impossible de charger le catalogue."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    hasData.current = false;
    setState({ kind: "loading" });
    return run(false);
  }, [allowed, loadKey, attempt, run]);

  useRefresh(() => {
    if (allowed && hasData.current) run(true);
  });

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Permissions pas encore connues : on attend avant de décider de la garde.
  if (loading) return <LoadingState className="px-8 pt-10" />;
  if (!allowed) return <Navigate to="/dashboard" replace />;
  if (state.kind === "not-found") return <NotFoundPage />;
  if (state.kind === "error") {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Package strokeWidth={1.5} />}
          title="Erreur"
          description={state.message}
          action={<EmptyStateAction onClick={retry}>Réessayer</EmptyStateAction>}
        />
      </div>
    );
  }
  if (state.kind === "loading") return <LoadingState className="px-8 pt-10" />;
  return <>{children(state.data)}</>;
}

/** Garde seule (pages sans données préchargées, comme `/admin/catalogue`). */
export function useCatalogAdminGuard(): "loading" | "denied" | "allowed" {
  const { has, loading } = useTenantPermissions();
  if (loading) return "loading";
  return has("catalog", "admin") ? "allowed" : "denied";
}
