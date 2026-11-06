// arkyo-server: bouchon phase 6, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/_components/dossier-generators.ts).
// Mêmes exports que ceux qu'utilise project-editor.tsx (:646-743), avec les
// types de l'original ; ceux qu'il tire de `dossier-registry.ts`,
// `lib/export/technical-table-pdf.ts` et `lib/export/fiche-pdf.ts` sont
// recopiés ici. Aucun document autonome (fiche, préparation, réseau, recette)
// n'est encore produit : les deux fonctions renvoient un objet vide.
// L'inventaire reste fourni par project-editor.tsx lui-même.

/** arkyo:app/(fullscreen)/project/[id]/_components/dossier-registry.ts:36-56. */
export type DossierDocId =
  | "garde"
  | "fiche"
  | "inventaire"
  | "cablage-cables"
  | "cablage-equipements"
  | "cablage-accessoires"
  | "cablage-panels"
  | "cablage-adaptateurs"
  | "cablage-contenants"
  | "reseau-ip"
  | "reseau-2110"
  | "reseau-dmx"
  | "rack"
  | "synoptique"
  | "cartographie"
  | "schema"
  | "video"
  | "audio"
  | "planfeu"
  | "recette";

/** arkyo:app/(fullscreen)/project/[id]/_components/dossier-registry.ts:109. */
export type DossierGenerator = () => Promise<Blob>;

/** arkyo:lib/export/technical-table-pdf.ts:44-48. */
export type TechnicalPageFormat =
  | "A4_PORTRAIT"
  | "A4_LANDSCAPE"
  | "A3_PORTRAIT"
  | "A3_LANDSCAPE";

/** arkyo:lib/export/fiche-pdf.ts:38-52. */
type FichePdfData = {
  name: string;
  status?: string | null;
  interventionType?: string | null;
  rigType?: string | null;
  clientName?: string | null;
  location?: string | null;
  description?: string | null;
  prestationType?: string | null;
  planningStart?: string | null;
  planningEnd?: string | null;
  shootingDate?: string | null;
  shootingEndDate?: string | null;
  commissioningDate?: string | null;
};

export type DossierDataContext = {
  projectId: string;
  fiche: FichePdfData;
  stamp: string;
  espace?: { name?: string | null; logoUrl?: string | null };
  formats?: Partial<Record<DossierDocId, TechnicalPageFormat>>;
  columns?: Partial<Record<DossierDocId, string[]>>;
  meta?: { projectName: string; location: string | null };
  titles?: Partial<Record<DossierDocId, string>>;
};

export type DossierTableData = {
  kind: "table";
  title: string;
  columns: string[];
  keys?: string[];
  rows: Array<Array<string | number | null | undefined>>;
};

export type DossierBomData = {
  kind: "bom";
  title: string;
  table: BomTableLike;
};

export type BomTableLike = {
  columns: ReadonlyArray<{ label: string; numeric: boolean; totaled: boolean }>;
  rows: ReadonlyArray<BomRowLike>;
};

export type BomRowLike =
  | { kind: "item"; cells: ReadonlyArray<string | number> }
  | { kind: "group-location"; label: string; cells: ReadonlyArray<string | number> }
  | {
      kind: "group-container";
      label: string;
      meta: string | null;
      free: boolean;
      cells: ReadonlyArray<string | number>;
    }
  | {
      kind: "subtotal" | "total";
      label: string;
      cells: ReadonlyArray<string | number>;
    };

export type DossierPreviewData = DossierTableData | DossierBomData;

export function buildDossierDataSources(
  _ctx: DossierDataContext,
): Partial<Record<DossierDocId, () => Promise<DossierPreviewData>>> {
  return {};
}

export function buildDossierDataGenerators(
  _ctx: DossierDataContext,
): Partial<Record<DossierDocId, DossierGenerator>> {
  return {};
}
