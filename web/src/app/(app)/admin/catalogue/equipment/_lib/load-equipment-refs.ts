/**
 * arkyo-server: requêtes de référentiels des pages `equipment/[id]` et
 * `equipment/new` d'arkyo (identiques dans les deux pages), passées par l'API,
 * avec les mêmes transformations (`mergePersonalRefs`, `mergeCatalogTypes`).
 *
 * Catalogue unique : les tables `Tenant*` sont les seuls référentiels et
 * portent les colonnes des modèles `Catalog*` (décision 3). Elles prennent la
 * place des requêtes `mainDb.catalog*` (marques, connecteurs, signaux,
 * fonctions, phases, types) : `/api/tenant/catalogue/lookup`, et
 * `/api/tenant/parametres/categories` pour les types (avec `iconId` et
 * `schemaImageUrl`, qu'arkyo lisait sur `CatalogType`). Les requêtes
 * `tenantDb.tenant*` des mêmes référentiels relisaient les mêmes lignes :
 * elles valent `[]` (sinon doublons). Passées par le côté « perso », les lignes
 * perdraient `isIp` / `supportsRedundancy` (signaux) et `iconId` (types).
 * Seul renommage : le Json `connectors` des signaux est `connectorIds`.
 * `cable_safety_depth_mm` vient de `/api/tenant/parametres/application`.
 */

import { api } from "@/lib/api-client";

import { mergeCatalogTypes } from "./merge-catalog-types";
import { mergePersonalRefs } from "./merge-personal-refs";

type Row = Record<string, unknown> & { id: string };

type Lookup = {
  brands: Array<Row & { name: string; logoUrl: string | null }>;
  connectorTypes: Array<Row & { name: string }>;
  signals: Array<Row & { name: string; connectorIds?: unknown }>;
  functions: Array<Row & { label: string; color: string | null }>;
  phases: Row[];
};

type CategoriesResponse = {
  types: {
    personal: Array<{
      id: string;
      name: string;
      functionId: string;
      parentId: string | null;
      iconId?: string | null;
      schemaImageUrl?: string | null;
      sortOrder?: number;
    }>;
  };
};

/** Référentiels communs aux pages `[id]` et `new` (mêmes requêtes dans arkyo). */
export async function loadEquipmentRefs() {
  const [lookup, categories, appConfig] = await Promise.all([
    api.get<Lookup>("/api/tenant/catalogue/lookup"),
    api.get<CategoriesResponse>("/api/tenant/parametres/categories"),
    api.get<Record<string, string> | null>("/api/tenant/parametres/application"),
  ]);
  const functions = lookup.functions;
  const phases = lookup.phases;
  const cableSafetyConfig = appConfig?.cable_safety_depth_mm;

  // Parité catalogue Arkyo/perso : les référentiels PERSONNELS du tenant
  // (marques, connecteurs, signaux) sont proposés au formulaire au même titre
  // que ceux d'Arkyo — dédupliqués par nom, l'entrée Arkyo prime.
  const { brands, connectorTypes, signals } = mergePersonalRefs({
    arkyoBrands: lookup.brands,
    arkyoConnectorTypes: lookup.connectorTypes,
    // Le Json `connectors` de `CatalogSignalType` est la colonne `connectorIds`
    // de `TenantSignalType` (décision 3) : filtre signal ↔ connecteur des ports.
    arkyoSignals: lookup.signals.map((s) => ({ ...s, connectors: s.connectorIds ?? [] })),
    // arkyo-server: catalogue unique — mêmes lignes que ci-dessus (voir l'en-tête).
    tenantBrands: [],
    tenantConnectorTypes: [],
    tenantSignals: [],
  });

  const cableSafetyDefaultMm = Number(cableSafetyConfig ?? 150) || 150;

  // Types de classification = Arkyo (main) + perso (TenantType), fonction
  // résolue main-first. `source` distingue les deux pour l'UI (repère « perso »).
  const types = mergeCatalogTypes({
    arkyoTypes: sortTypes(categories.types.personal),
    tenantTypes: [], // arkyo-server: catalogue unique (voir l'en-tête)
    functions,
    tenantFunctions: [], // arkyo-server: catalogue unique (voir l'en-tête)
  });

  return {
    brands: brands as never,
    connectorTypes: connectorTypes as never,
    signals: signals as never,
    functions: functions as never,
    phases: phases as never,
    types: types as never,
    cableSafetyDefaultMm,
  };
}

/**
 * Ordre de `mainDb.catalogType.findMany` dans arkyo : `functionId`, `sortOrder`,
 * `name` (la route des catégories trie par `sortOrder`, `name`).
 */
function sortTypes<T extends { functionId: string | null; sortOrder?: number; name: string }>(
  types: T[],
): T[] {
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...types].sort(
    (a, b) =>
      byText(a.functionId ?? "", b.functionId ?? "") ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name, "fr"),
  );
}
