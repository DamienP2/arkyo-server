/**
 * arkyo-server: socle des pages reprises d'arkyo chargées côté client
 * (catalogue d'administration, utilisateurs, espace, profil). Les Server
 * Components d'arkyo (`page.tsx`) deviennent des composants clients : ce module
 * reprend ce qu'ils faisaient côté serveur, au même moment du rendu.
 *
 * - Garde `requireTenantPermissionPage(domain, level)` : on attend la fin
 *   du chargement des permissions, puis `<Navigate to="/dashboard">` (le
 *   `redirect("/dashboard")` d'arkyo). `permission={null}` : session seule
 *   (assurée par le layout).
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
import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiError, getApiErrorMessage } from "@/lib/api-client";
import { usePageTitle } from "@/lib/hooks/use-page-title";

type State<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type ClientPageProps<T> = {
  /** Requêtes de la page (équivalent des requêtes Prisma d'arkyo). */
  load: () => Promise<T>;
  /** Identité des données (ex. l'id de l'URL) : un changement relance le
   *  chargement depuis l'état d'attente. */
  loadKey?: string;
  /** Rendu de la page une fois les données chargées. */
  children: (data: T) => ReactNode;
};

/**
 * Page chargée côté client, gardée par `permission` (`null` : session seule).
 *
 * @param icon  Icône de l'état d'erreur.
 * @param fallbackError  Message d'erreur quand l'API n'en donne pas.
 */
export function ClientPage<T>({
  permission,
  icon,
  fallbackError,
  load,
  loadKey = "",
  children,
}: ClientPageProps<T> & {
  permission: readonly [TenantDomain, TenantLevel] | null;
  icon: ReactNode;
  fallbackError: string;
}) {
  usePageTitle(); // titre d'onglet par défaut (pas de metadata dans arkyo)
  const { has, loading } = useTenantPermissions();
  const allowed = !loading && (permission === null || has(permission[0], permission[1]));
  const fallbackRef = useRef(fallbackError);
  fallbackRef.current = fallbackError;

  const [state, setState] = useState<State<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasData = useRef(false);
  // Numéro du dernier chargement lancé : seule sa réponse est appliquée (deux
  // refresh rapprochés peuvent se résoudre dans le désordre).
  const seqRef = useRef(0);

  const run = useCallback((silent: boolean) => {
    const seq = ++seqRef.current;
    let cancelled = false;
    loadRef
      .current()
      .then((data) => {
        if (cancelled || seq !== seqRef.current) return;
        hasData.current = true;
        setState({ kind: "ready", data });
      })
      .catch((e) => {
        if (cancelled || seq !== seqRef.current) return;
        // Rechargement silencieux (refresh) : on garde les données affichées.
        if (silent && hasData.current) return;
        if (e instanceof ApiError && e.status === 404) {
          setState({ kind: "not-found" });
        } else {
          setState({
            kind: "error",
            message: getApiErrorMessage(e, fallbackRef.current),
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
          icon={icon}
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

/** Page d'administration du catalogue (garde `catalog:admin`). */
export function CatalogAdminPage<T>(props: ClientPageProps<T>) {
  return (
    <ClientPage
      permission={CATALOG_ADMIN}
      icon={<Package strokeWidth={1.5} />}
      fallbackError="Impossible de charger le catalogue."
      {...props}
    />
  );
}

const CATALOG_ADMIN = ["catalog", "admin"] as const;

/** Garde seule (pages sans données préchargées, comme `/admin/catalogue`). */
export function useCatalogAdminGuard(): "loading" | "denied" | "allowed" {
  const { has, loading } = useTenantPermissions();
  if (loading) return "loading";
  return has("catalog", "admin") ? "allowed" : "denied";
}
