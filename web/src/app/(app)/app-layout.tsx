/**
 * Layout `(app)` : arkyo:app/(app)/layout.tsx rendu côté client.
 *
 * Le layout d'arkyo est un Server Component qui lit la session, le tenant et
 * les permissions avant de rendre la coquille. Ici, la session vient de
 * `useSession()` et le reste de l'API, avant le premier rendu de la coquille :
 *   - pas de session → `/auth` ;
 *   - `GET /api/tenant/me/permissions` → 403 `PASSWORD_CHANGE_REQUIRED` →
 *     `/auth/password` (garde `mustChangePassword`) ;
 *   - sinon ces permissions sont les `initialPermissions` du provider (même
 *     anti-flash qu'arkyo), et `GET /api/site` donne le nom affiché en topbar.
 *
 * Contexte tenant unique : `TenantPlanProvider plan="ENTERPRISE"` (tout débloqué),
 * `TenantMembershipProvider tenantSlug="local"`, `GhostModeProvider isGhost={false}`.
 * Retirés d'arkyo (SaaS) : `ImpersonationBanner`, `BugReportWidget`, l'écran
 * « Espace suspendu / archivé / supprimé » et la redirection hors membership.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";
import { useSession } from "next-auth/react";
import { useRefresh } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { AppSync } from "@/components/app-sync";
import { PresenceProvider } from "@/components/presence/presence-provider";
import { ViewProvider } from "@/lib/view-context";
import { TopbarTabsProvider } from "@/lib/topbar-tabs-context";
import { TenantMembershipProvider } from "@/lib/tenant-membership-context";
import { GhostModeProvider } from "@/lib/ghost-mode-context";
import { TenantPlanProvider } from "@/lib/tenant-plan-context";
import { TenantPermissionsProvider } from "@/components/tenant-permissions-context";
import type { TenantPermissions } from "@/lib/tenant-permissions";
import type { MemberRole } from "@/lib/prisma/main-client";

const MEMBER_ROLES: readonly MemberRole[] = ["OWNER", "CHEF_PROJET", "TECHNICIEN", "CONSULTATION"];

export type ShellGate =
  | { kind: "ok"; permissions: TenantPermissions; siteName: string }
  | { kind: "auth" }
  | { kind: "password" };

/**
 * Lit les permissions (et le garde `mustChangePassword`) puis le nom du site.
 * Partagé avec le layout `(fullscreen)`.
 */
export async function loadShell(): Promise<ShellGate> {
  const res = await fetch("/api/tenant/me/permissions", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (res.status === 401) return { kind: "auth" };
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "PASSWORD_CHANGE_REQUIRED") return { kind: "password" };
  }
  const permissions = res.ok ? ((await res.json()) as TenantPermissions) : null;
  let siteName = "";
  try {
    const site = await fetch("/api/site", { headers: { Accept: "application/json" } });
    if (site.ok) siteName = ((await site.json()) as { name?: string }).name ?? "";
  } catch {
    // Nom du site facultatif : la topbar n'affiche alors que le lockup.
  }
  return {
    kind: "ok",
    permissions: permissions ?? {
      isOwner: false,
      roleKey: null,
      permissions: { projects: "none", design: "none", catalog: "none", members: "none", settings: "none" },
    },
    siteName,
  };
}

/** Garde commune des layouts : session, puis `loadShell()`. */
export function useShellGate(): ShellGate | "loading" {
  const { data: session, status } = useSession();
  const [gate, setGate] = useState<ShellGate | "loading">("loading");
  const signedIn = !!session;

  const load = useCallback(() => {
    let cancelled = false;
    loadShell()
      .then((g) => {
        if (!cancelled) setGate(g);
      })
      .catch(() => {
        if (!cancelled) setGate({ kind: "auth" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (signedIn) return load();
  }, [signedIn, load]);

  // `router.refresh()` : relit le nom du site (et les permissions).
  useRefresh(() => {
    if (signedIn) load();
  });

  if (status === "loading") return "loading";
  if (!session) return { kind: "auth" };
  return gate;
}

export default function AppLayout() {
  const { data: session } = useSession();
  const gate = useShellGate();

  if (gate === "loading") return null;
  if (gate.kind === "auth") return <Navigate to="/auth" replace />;
  if (gate.kind === "password") return <Navigate to="/auth/password" replace />;

  const role = MEMBER_ROLES.find((r) => r === session?.user.role) ?? null;

  const layoutContent = (
    <PresenceProvider>
      <ViewProvider>
        <TopbarTabsProvider>
        <div className="flex h-screen bg-[var(--background)]">
          {/* Topbar pleine largeur (z-40) */}
          <Suspense>
            <Topbar />
          </Suspense>

          {/* Rail gauche — sous la topbar */}
          <Suspense>
            <Sidebar />
          </Suspense>

          {/* Contenu principal */}
          <main
            id="main-content"
            className="min-w-0 flex-1 overflow-y-auto"
            style={{ marginLeft: "var(--rail-width)", marginTop: "var(--topbar-bottom)" }}
          >
            <Outlet />
          </main>

          <AppSync />
        </div>
        </TopbarTabsProvider>
      </ViewProvider>
    </PresenceProvider>
  );

  return (
    // GhostModeProvider conservé (consommé par plusieurs composants) mais le
    // ghost mode est supprimé → toujours false : plus rien n'est en lecture seule.
    <GhostModeProvider isGhost={false}>
      <TenantPlanProvider plan="ENTERPRISE">
        <TenantMembershipProvider
          tenantSlug="local"
          tenantName={gate.siteName || null}
          role={role}
        >
          <TenantPermissionsProvider initialPermissions={gate.permissions}>
            {layoutContent}
          </TenantPermissionsProvider>
        </TenantMembershipProvider>
      </TenantPlanProvider>
    </GhostModeProvider>
  );
}
