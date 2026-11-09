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
import SettingsPage from "@/app/(app)/settings/page";
import LegacyProjectRedirect from "@/app/(app)/projects/[id]/page";
import RacksRedirect from "@/app/(app)/racks/page";
import RigsRedirect from "@/app/(app)/rigs/page";
import PanelsRedirect from "@/app/(app)/panels/page";
import ProjectLayout from "@/app/(fullscreen)/project/[id]/layout";
import { ComingSoon } from "@/components/coming-soon";
import { LoadingState } from "@/components/ui/loading-state";
import { InterfaceSwitch } from "@/strata/interface-switch";

// Pages du catalogue (phase 2) : chargées à la demande, hors du bundle principal.
const ParametresPage = lazy(() => import("@/app/(app)/admin/parametres/page"));
const CataloguePage = lazy(() => import("@/app/(app)/admin/catalogue/page"));
const NewEquipmentPage = lazy(() => import("@/app/(app)/admin/catalogue/equipment/new/page"));
const EquipmentPage = lazy(() => import("@/app/(app)/admin/catalogue/equipment/[id]/page"));
const NewCablePage = lazy(() => import("@/app/(app)/admin/catalogue/cables/new/page"));
const CablePage = lazy(() => import("@/app/(app)/admin/catalogue/cables/[id]/page"));
const NewAdapterPage = lazy(() => import("@/app/(app)/admin/catalogue/adapters/new/page"));
const AdapterPage = lazy(() => import("@/app/(app)/admin/catalogue/adapters/[id]/page"));
const UsersPage = lazy(() => import("@/app/(app)/admin/users/page"));
const EspacePage = lazy(() => import("@/app/(app)/admin/espace/page"));
const ProfilePage = lazy(() => import("@/app/(app)/profile/page"));
// Phase 3 : tableau de bord, liste des projets, modèles (`/templates`) et
// détail de régie.
const DashboardPage = lazy(() => import("@/app/(app)/dashboard/page"));
// Interface Strata : page Projets à la place du tableau de bord et de la liste.
const StrataProjectsPage = lazy(() => import("@/strata/pages/projects-page"));
const ProjectsPage = lazy(() => import("@/app/(app)/projects/page"));
const TemplatesPage = lazy(() => import("@/app/(app)/templates/page"));
const RigDetailPage = lazy(() => import("@/app/(app)/rigs/[id]/page"));
// Éditeur de panel (plein écran).
const PanelEditorPage = lazy(() => import("@/app/(fullscreen)/panels/[id]/page"));
// Phase 4 : éditeur projet (plein écran).
const ProjectEditorPage = lazy(() => import("@/app/(fullscreen)/project/[id]/page"));

// arkyo:app/(app)/settings/page.tsx ne rend rien : `redirect()` lève toujours
// (type `() => void`), l'`errorElement` suit la redirection.
const SettingsRedirect = SettingsPage as unknown as React.ComponentType;

const errorElement = <NavigationErrorElement />;

/** `/dashboard` : tableau de bord d'arkyo en Classique, page Projets en Strata. */
function DashboardRoute() {
  return <InterfaceSwitch classique={<DashboardPage />} strata={<StrataProjectsPage />} />;
}

/** `/projects` : liste des projets d'arkyo en Classique, page Projets en Strata. */
function ProjectsRoute() {
  return <InterfaceSwitch classique={<ProjectsPage />} strata={<StrataProjectsPage />} />;
}

/** Page chargée à la demande (`lazy()`), avec `<LoadingState>` en attendant.
 *  `path` absent : page index de son parent. */
function lazyPage(path: string | null, Page: React.ComponentType): RouteObject {
  const element = (
    <Suspense fallback={<LoadingState className="px-8 pt-10" />}>
      <Page />
    </Suspense>
  );
  return path === null ? { index: true, element, errorElement } : { path, element, errorElement };
}

/** Page pas encore portée (`back` : plein écran, avec « Retour »). */
function soon(path: string, back = false): RouteObject {
  return { path, element: <ComingSoon back={back} />, errorElement };
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
          lazyPage("dashboard", DashboardRoute),
          lazyPage("projects", ProjectsRoute),
          // Les redirections d'arkyo (garde, puis `redirect()`) sont chargées
          // d'emblée, comme `/settings`.
          { path: "projects/:id", element: <LegacyProjectRedirect />, errorElement },
          lazyPage("templates", TemplatesPage),
          { path: "racks", element: <RacksRedirect />, errorElement },
          { path: "rigs", element: <RigsRedirect />, errorElement },
          lazyPage("rigs/:id", RigDetailPage),
          { path: "panels", element: <PanelsRedirect />, errorElement },
          // Éditeur de rack : phase 4.
          soon("racks/:rackId"),
          soon("rigs/:id/rack/:rackId"),
          { path: "admin/systeme", element: <SystemePage />, errorElement },
          lazyPage("admin/parametres", ParametresPage),
          lazyPage("admin/catalogue", CataloguePage),
          lazyPage("admin/catalogue/equipment/new", NewEquipmentPage),
          lazyPage("admin/catalogue/equipment/:id", EquipmentPage),
          lazyPage("admin/catalogue/cables/new", NewCablePage),
          lazyPage("admin/catalogue/cables/:id", CablePage),
          lazyPage("admin/catalogue/adapters/new", NewAdapterPage),
          lazyPage("admin/catalogue/adapters/:id", AdapterPage),
          lazyPage("admin/users", UsersPage),
          lazyPage("admin/espace", EspacePage),
          soon("admin/*"),
          // `/settings` → `/admin/espace` (arkyo:app/(app)/settings/page.tsx) ;
          // `/settings/catalog-updates` (mises à jour du catalogue Arkyo, SaaS)
          // n'est pas repris.
          { path: "settings", element: <SettingsRedirect />, errorElement },
          lazyPage("profile", ProfilePage),
        ],
      },

      {
        element: <FullscreenLayout />,
        errorElement,
        // `project/:id` : éditeur projet, sous le layout d'arkyo (garde
        // `projects:read`, `ConfirmProvider`) ; ses sous-routes
        // (`inventaire/rack/:rackId`, `inventaire/synoptique` : phase 4d ;
        // `cartographie` : phase 5) restent « Bientôt disponible ».
        // `panels/:id` : éditeur de panel.
        children: [
          {
            path: "project/:id",
            element: <ProjectLayout />,
            errorElement,
            children: [lazyPage(null, ProjectEditorPage), soon("*", true)],
          },
          lazyPage("panels/:id", PanelEditorPage),
        ],
      },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
