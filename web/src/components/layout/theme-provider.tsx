"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { UnsavedChangesProvider } from "@/lib/unsaved-changes";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      // En dev, SessionProvider polle /api/auth/session toutes les ~minutes
      // et re-fetch à chaque focus de fenêtre — 5-10 GET supplémentaires par
      // chargement, ce qui sature le pool Postgres de Next.js (Turbopack).
      // refetchInterval=0 désactive le poll, refetchOnWindowFocus=false évite
      // le re-fetch au focus. La session sera quand même rafraîchie lors des
      // navigations RSC (suffisant en pratique).
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <NextThemesProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <ToastProvider>
          <ConfirmProvider>
            <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
          </ConfirmProvider>
        </ToastProvider>
      </NextThemesProvider>
    </SessionProvider>
  );
}
