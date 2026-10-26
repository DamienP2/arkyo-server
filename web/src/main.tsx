/**
 * Point d'entrée de la SPA. Pour l'instant une page minimale qui prouve que le
 * design system d'arkyo compile (Task 7 : routeur et coquille de l'application).
 *
 * Ordre des providers repris de arkyo:app/layout.tsx :
 * NextIntlClientProvider > IconProvider > ThemeProvider.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { NextIntlClientProvider } from "next-intl";
import { NavigationErrorElement } from "next/navigation";
import { IconProvider } from "@/components/ui/icon-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { EmptyState } from "@/components/ui/empty-state";
import "./app/globals.css";
import "./fonts.css";

function Root() {
  return (
    <NextIntlClientProvider>
      <IconProvider>
        <ThemeProvider>
          <EmptyState title="arkyo" description="Bientôt disponible" />
        </ThemeProvider>
      </IconProvider>
    </NextIntlClientProvider>
  );
}

const router = createBrowserRouter([
  { path: "*", element: <Root />, errorElement: <NavigationErrorElement /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
