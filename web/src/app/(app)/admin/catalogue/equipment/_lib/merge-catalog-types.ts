import type { CatalogTypeLite } from "@/app/(app)/admin/equipment/[id]/_editor/types";

/**
 * Fusionne les types Arkyo (main DB) et les types perso du tenant
 * (`TenantType`) en une liste unique `CatalogTypeLite[]`, Arkyo d'abord puis
 * perso, chacun marqué par `source`.
 *
 * Résolution de la fonction (main-first) : un `TenantType` n'a pas de relation
 * Prisma vers sa fonction — son `functionId` (scalaire, éventuellement nul pour
 * un sous-type) est mappé vers `{ label, color }` en cherchant d'abord dans les
 * `CatalogFunction` (main), puis dans les `TenantFunction` (tenant).
 *
 * Un sous-type perso dont le `functionId` est nul hérite de celui de son parent
 * (perso ou Arkyo). Une entrée perso qu'on ne parvient pas à rattacher à une
 * fonction est ignorée (impossible à classer dans l'UI).
 */

type ArkyoTypeRow = {
  id: string;
  name: string;
  functionId: string;
  parentId: string | null;
  iconId?: string | null;
  schemaImageUrl?: string | null;
  function?: { label: string; color: string } | null;
};

type TenantTypeRow = {
  id: string;
  name: string;
  functionId: string | null;
  parentId: string | null;
};

type FunctionRow = { id: string; label: string; color: string | null };

const DEFAULT_COLOR = "#6366f1";

export function mergeCatalogTypes({
  arkyoTypes,
  tenantTypes,
  functions,
  tenantFunctions = [],
}: {
  arkyoTypes: ArkyoTypeRow[];
  tenantTypes: TenantTypeRow[];
  functions: FunctionRow[];
  tenantFunctions?: FunctionRow[];
}): CatalogTypeLite[] {
  // Map functionId → { label, color }. Tenant d'abord, main ensuite pour que
  // la définition main l'emporte en cas de collision d'id.
  const fnMap = new Map<string, { label: string; color: string }>();
  for (const f of tenantFunctions) {
    fnMap.set(f.id, { label: f.label, color: f.color ?? DEFAULT_COLOR });
  }
  for (const f of functions) {
    fnMap.set(f.id, { label: f.label, color: f.color ?? DEFAULT_COLOR });
  }

  const arkyo: CatalogTypeLite[] = arkyoTypes.map((t) => ({
    id: t.id,
    name: t.name,
    functionId: t.functionId,
    parentId: t.parentId ?? null,
    source: "ARKYO",
    iconId: t.iconId ?? null,
    schemaImageUrl: t.schemaImageUrl ?? null,
    function:
      t.function ?? fnMap.get(t.functionId) ?? { label: "", color: DEFAULT_COLOR },
  }));

  const tenantById = new Map(tenantTypes.map((t) => [t.id, t]));
  const arkyoById = new Map(arkyoTypes.map((t) => [t.id, t]));

  // functionId effectif d'un TenantType : le sien, sinon hérité du parent
  // (perso puis Arkyo). Garde de profondeur pour éviter tout cycle.
  const resolveFunctionId = (t: TenantTypeRow, depth = 0): string | null => {
    if (t.functionId) return t.functionId;
    if (t.parentId && depth < 4) {
      const parentTenant = tenantById.get(t.parentId);
      if (parentTenant) return resolveFunctionId(parentTenant, depth + 1);
      const parentArkyo = arkyoById.get(t.parentId);
      if (parentArkyo) return parentArkyo.functionId;
    }
    return null;
  };

  const personal: CatalogTypeLite[] = [];
  for (const t of tenantTypes) {
    const fnId = resolveFunctionId(t);
    if (!fnId) continue;
    personal.push({
      id: t.id,
      name: t.name,
      functionId: fnId,
      parentId: t.parentId ?? null,
      source: "PERSONAL",
      function: fnMap.get(fnId) ?? { label: "", color: DEFAULT_COLOR },
    });
  }

  return [...arkyo, ...personal];
}
