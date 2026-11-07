"use client";

/**
 * Coquille générale de l'interface Strata : topbar à onglets segmentés, barre
 * latérale de bibliothèque et zone principale. Mêmes repères que la coquille
 * Classique (`header`, `aside`, `main#main-content`) et mêmes variables
 * (`--rail-width`, `--topbar-bottom`), pour que les en-têtes fixes des pages
 * (`AdminTabLayout`) restent alignés.
 */

import { Suspense, type ReactNode } from "react";
import { StrataSideNav } from "./strata-side-nav";
import { StrataTopbar } from "./strata-topbar";

export function StrataAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-[var(--background)]">
      <Suspense>
        <StrataTopbar />
      </Suspense>

      <Suspense>
        <StrataSideNav />
      </Suspense>

      <main
        id="main-content"
        className="min-w-0 flex-1 overflow-y-auto"
        style={{ marginLeft: "var(--rail-width)", marginTop: "var(--topbar-bottom)" }}
      >
        {children}
      </main>
    </div>
  );
}
