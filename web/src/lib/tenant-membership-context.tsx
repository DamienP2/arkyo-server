"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MemberRole } from "@/lib/prisma/main-client";

type TenantMembershipCtx = {
  tenantSlug: string | null;
  tenantName: string | null;
  // arkyo-server: logo du site (`AppConfig` `site.logoUrl`), affiché en topbar.
  tenantLogoUrl?: string | null;
  role: MemberRole | null;
};

const Ctx = createContext<TenantMembershipCtx>({
  tenantSlug: null,
  tenantName: null,
  tenantLogoUrl: null, // arkyo-server: logo du site
  role: null,
});

export function TenantMembershipProvider({
  tenantSlug,
  tenantName,
  tenantLogoUrl = null, // arkyo-server: logo du site
  role,
  children,
}: TenantMembershipCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ tenantSlug, tenantName, tenantLogoUrl, role }}>{children}</Ctx.Provider>; // arkyo-server: logo du site
}

export function useTenantMembership() {
  return useContext(Ctx);
}
