/**
 * Arbre des URL d'arkyo (`arkyo:app/**`), en routes react-router.
 *
 * - `(app)` (sidebar + topbar) : dashboard, projets, racks, rigs, panels,
 *   templates, admin, settings, profile.
 * - `(fullscreen)` (sans chrome) : éditeur projet et éditeur panel.
 * - `/auth`, `/auth/setup`, `/auth/password` : hors coquille, comme la page
 *   d'auth de la plateforme arkyo.
 * - `/` → `/dashboard` (arkyo:app/page.tsx).
 *
 * Chaque page pas encore portée rend `<ComingSoon />` ; les phases suivantes
 * remplacent ces éléments un par un. Les URL SaaS d'arkyo (`/support`,
 * `/proposals`, `/dev`, `/shell-demo`, supervisor, site) ne sont pas reprises.
 *
 * `NavigationErrorElement` est l'`errorElement` de chaque niveau : il traduit
 * les `redirect()` / `notFound()` levés par les pages copiées d'arkyo.
 */

import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { NavigationErrorElement, NotFoundPage } from "next/navigation";
import { Root } from "@/app/root";
import AppLayout from "@/app/(app)/app-layout";
import FullscreenLayout from "@/app/(fullscreen)/fullscreen-layout";
import AuthPage from "@/app/auth/auth-page";
import SetupPage from "@/app/auth/setup-page";
import PasswordPage from "@/app/auth/password-page";
import SystemePage from "@/app/(app)/admin/systeme/systeme-page";
import { ComingSoon } from "@/components/coming-soon";
import { LoadingState } from "@/components/ui/loading-state";

// Pages du catalogue (phase 2) : chargées à la demande, hors du bundle principal.
const ParametresPage = lazy(() => import("@/app/(app)/admin/parametres/page"));

const errorElement = <NavigationErrorElement />;

/** Page chargée à la demande (`lazy()`), avec `<LoadingState>` en attendant. */
function lazyPage(path: string, Page: React.ComponentType): RouteObject {
  return {
    path,
    element: (
      <Suspense fallback={<LoadingState className="px-8 pt-10" />}>
        <Page />
      </Suspense>
    ),
    errorElement,
  };
}

/** Page pas encore portée. */
function soon(path: string): RouteObject {
  return { path, element: <ComingSoon />, errorElement };
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },

      { path: "auth", element: <AuthPage />, errorElement },
      { path: "auth/setup", element: <SetupPage />, errorElement },
      { path: "auth/password", element: <PasswordPage />, errorElement },

      {
        element: <AppLayout />,
        errorElement,
        children: [
          soon("dashboard"),
          soon("projects/*"),
          soon("racks/*"),
          soon("rigs/*"),
          soon("panels"),
          soon("templates"),
          { path: "admin/systeme", element: <SystemePage />, errorElement },
          lazyPage("admin/parametres", ParametresPage),
          soon("admin/*"),
          soon("settings/*"),
          soon("profile"),
        ],
      },

      {
        element: <FullscreenLayout />,
        errorElement,
        children: [soon("project/:id/*"), soon("panels/:id")],
      },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
