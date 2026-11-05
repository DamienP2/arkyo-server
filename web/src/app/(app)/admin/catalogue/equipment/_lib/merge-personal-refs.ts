/**
 * Fusion des référentiels Arkyo (main DB) + PERSONNELS (tenant DB) pour les
 * formulaires du catalogue — marques, types de connecteurs, types de signaux.
 *
 * Règle de parité : tout ce que le tenant a créé dans ses paramètres doit
 * être proposé au même titre que le catalogue Arkyo. Déduplication par nom
 * (insensible à la casse), l'entrée Arkyo prime — un doublon perso d'une
 * marque Arkyo ne crée pas deux entrées.
 *
 * Les entrées perso sont mappées vers la forme minimale que les éditeurs
 * consomment (`_editor/types.ts` : Brand / ConnectorType / Signal) — les
 * champs main-only absents restent vides, aucun composant n'en dépend pour
 * une entrée sélectionnable.
 */

const collator = new Intl.Collator("fr", { sensitivity: "base" });

type Named = { id: string; name: string };

function appendUnique<A extends Named, P extends Named, M>(
  arkyo: A[],
  personal: P[],
  map: (p: P) => M,
): Array<A | M> {
  const taken = new Set(arkyo.map((a) => a.name.trim().toLowerCase()));
  const extras = personal
    .filter((p) => !taken.has(p.name.trim().toLowerCase()))
    .map(map);
  return [...arkyo, ...extras];
}

export function mergePersonalRefs<
  B extends Named,
  C extends Named,
  S extends Named,
>(input: {
  arkyoBrands: B[];
  arkyoConnectorTypes: C[];
  arkyoSignals: S[];
  tenantBrands: Array<{ id: string; name: string; logoUrl: string | null }>;
  tenantConnectorTypes: Array<{
    id: string;
    name: string;
    versions: string[];
    iconId: string | null;
    svgUrl: string | null;
    color: string | null;
    functionIds: unknown;
  }>;
  tenantSignals: Array<{
    id: string;
    name: string;
    color: string | null;
    functionId: string | null;
    connectorIds: unknown;
  }>;
}) {
  const brands = appendUnique(input.arkyoBrands, input.tenantBrands, (b) => ({
    id: b.id,
    name: b.name,
    logoUrl: b.logoUrl,
  })).sort((a, b) => collator.compare(a.name, b.name));

  const connectorTypes = appendUnique(
    input.arkyoConnectorTypes,
    input.tenantConnectorTypes,
    (c) => ({
      id: c.id,
      name: c.name,
      version: null,
      versions: c.versions,
      category: "",
      iconId: c.iconId,
      svgUrl: c.svgUrl,
      color: c.color,
      functionIds: Array.isArray(c.functionIds)
        ? (c.functionIds as string[])
        : [],
    }),
  ).sort((a, b) => collator.compare(a.name, b.name));

  // Les signaux Arkyo gardent leur ordre éditorial (sortOrder) ; les perso
  // s'ajoutent à la suite, triés par nom.
  const signals = appendUnique(input.arkyoSignals, input.tenantSignals, (s) => ({
    id: s.id,
    name: s.name,
    category: "",
    functionId: s.functionId,
    color: s.color ?? "#6b7280",
    connectors: Array.isArray(s.connectorIds) ? s.connectorIds : [],
  }));

  return { brands, connectorTypes, signals };
}
