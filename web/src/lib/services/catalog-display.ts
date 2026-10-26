export type TenantPlan = "FREE" | "PRO" | "ENTERPRISE";

const PLAN_RANK: Record<TenantPlan, number> = { FREE: 0, PRO: 1, ENTERPRISE: 2 };

const PLAN_LABELS: Record<TenantPlan, string> = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

export interface CatalogItemFlags {
  isGhost: boolean;
  isNew: boolean;
  isModified: boolean;
  ghostPlanLabel: string | null;
}

export function getCatalogItemFlags(
  item: {
    sourceType?: string | null;
    visibleFromPlan?: string | null;
    catalogModifiedAt?: Date | string | null;
    catalogPushedAt?: Date | string | null;
  },
  tenantPlan: TenantPlan,
  entityViewedAt: Date | null,
): CatalogItemFlags {
  const isArkyo = item.sourceType === "ARKYO";
  const itemPlan = (item.visibleFromPlan ?? "FREE") as TenantPlan;

  const isGhost = isArkyo && PLAN_RANK[tenantPlan] < PLAN_RANK[itemPlan];

  const pushedAt = item.catalogPushedAt ? new Date(item.catalogPushedAt as string) : null;
  const isNew = isArkyo && !!pushedAt && (!entityViewedAt || pushedAt > entityViewedAt);

  const isModified = isArkyo && !!item.catalogModifiedAt;

  return {
    isGhost,
    isNew,
    isModified,
    ghostPlanLabel: isGhost ? PLAN_LABELS[itemPlan] : null,
  };
}
