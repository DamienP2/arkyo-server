"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MemberRole } from "@/lib/prisma/main-client";

type TenantMembershipCtx = {
  tenantSlug: string | null;
  tenantName: string | null;
  role: MemberRole | null;
};

const Ctx = createContext<TenantMembershipCtx>({
  tenantSlug: null,
  tenantName: null,
  role: null,
});

export function TenantMembershipProvider({
  tenantSlug,
  tenantName,
  role,
  children,
}: TenantMembershipCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ tenantSlug, tenantName, role }}>{children}</Ctx.Provider>;
}

export function useTenantMembership() {
  return useContext(Ctx);
}
