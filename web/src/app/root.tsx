/**
 * Racine de la SPA : providers de `arkyo:app/layout.tsx`
 * (NextIntlClientProvider > IconProvider > ThemeProvider), puis la route.
 *
 * Sont retirés de ce layout d'arkyo : `ThemeOverride` (couleurs du supervisor
 * SaaS) et `DevModeBanner` (mode dev de la plateforme SaaS).
 */

import { Outlet } from "react-router";
import { NextIntlClientProvider } from "next-intl";
import { IconProvider } from "@/components/ui/icon-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";

export function Root() {
  return (
    <NextIntlClientProvider>
      <IconProvider>
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
      </IconProvider>
    </NextIntlClientProvider>
  );
}
