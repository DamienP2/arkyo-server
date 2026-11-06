import type { ReactNode } from "react";

export type WorkspaceId = "design" | "synoptic" | "construction" | "print";

/**
 * Workspaces actuellement affichés dans le shell rack-editor.
 *
 * Le mode "construction" est conservé dans le type `WorkspaceId` pour la
 * rétro-compatibilité (URL, localStorage, code interne) mais n'apparaît plus
 * dans la barre d'onglets — il sera réutilisé plus tard pour un onglet projet
 * "Construction" global. Si l'état pointe vers `"construction"`, le shell
 * redirige silencieusement vers `"design"` (cf global-topbar.tsx).
 */
export const VISIBLE_WORKSPACES: WorkspaceId[] = ["design", "synoptic"];

export interface ToolVariant {
  id: string;
  label: string;
  icon?: string;
  description?: string;
}

export interface ToolDef {
  id: string;
  label: string;
  shortcut?: string;
  icon: string;
  description?: string;
  variants?: ToolVariant[];
  defaultVariantId?: string;
  renderContextualTopbar?: (variantId: string | null) => ReactNode;
}

export interface ToolDividerDef {
  id: string;
  divider: true;
}

export type ToolEntry = ToolDef | ToolDividerDef;

export function isDivider(e: ToolEntry): e is ToolDividerDef {
  return "divider" in e && e.divider === true;
}

export interface ToolRegistry {
  workspace: WorkspaceId;
  tools: ToolEntry[];
}

export function resolveTool(reg: ToolRegistry, toolId: string | null): ToolDef | null {
  if (!toolId) return null;
  const entry = reg.tools.find((t) => t.id === toolId);
  if (!entry || isDivider(entry)) return null;
  return entry;
}

export function resolveVariant(
  reg: ToolRegistry,
  toolId: string | null,
  variantId: string | null,
): ToolVariant | null {
  const tool = resolveTool(reg, toolId);
  if (!tool || !tool.variants || tool.variants.length === 0) return null;
  const targetId = variantId ?? tool.defaultVariantId ?? tool.variants[0].id;
  return tool.variants.find((v) => v.id === targetId) ?? null;
}
