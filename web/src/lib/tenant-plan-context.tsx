"use client";

import { createContext, useContext } from "react";

type PlanLevel = "FREE" | "PRO" | "ENTERPRISE";

type TenantPlanContextValue = {
  plan: PlanLevel;
  planRank: number;
  canAccess: (requiredPlan: string) => boolean;
};

const PLAN_RANK: Record<string, number> = { FREE: 0, PRO: 1, ENTERPRISE: 2 };

const TenantPlanContext = createContext<TenantPlanContextValue>({
  plan: "FREE",
  planRank: 0,
  canAccess: () => true,
});

export function TenantPlanProvider({
  plan,
  children,
}: {
  plan: PlanLevel;
  children: React.ReactNode;
}) {
  const planRank = PLAN_RANK[plan] ?? 0;
  const canAccess = (requiredPlan: string) => planRank >= (PLAN_RANK[requiredPlan] ?? 0);

  return (
    <TenantPlanContext.Provider value={{ plan, planRank, canAccess }}>
      {children}
    </TenantPlanContext.Provider>
  );
}

export function useTenantPlan() {
  return useContext(TenantPlanContext);
}
