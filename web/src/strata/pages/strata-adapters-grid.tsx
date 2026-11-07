/**
 * Grille Strata des adaptateurs du catalogue (onglet Adaptateurs en interface
 * Strata, vue grille ; spec §6.3, maquette `viewCatalogue`) : dessin entrées →
 * sorties (pictogramme, nom, genre `M` / `F` / `N`, quantité), fonction et
 * nombre d'entrées et de sorties.
 *
 * Les éléments sont la liste déjà filtrée et triée de `AdaptersListPanel`.
 */

import { useMemo, type ReactNode } from "react";
import { AdapterDrawing, type AdapterEndDrawing } from "../drawings/adapter-drawing";
import { connectorTypeIndex, drawingGender, useCatalogueLookup, type LookupConnectorType } from "../catalogue-model";
import { CardMeta, StrataCard, StrataGrid } from "./strata-card";

type AdapterEnd = { connectorTypeId: string; gender?: string | null; quantity?: number | null };

/** Adaptateur de `GET /api/tenant/catalogue/adapters`. */
export type StrataAdapterItem = {
  id: string;
  name: string;
  reference: string | null;
  function?: { label: string } | null;
  inputs?: readonly AdapterEnd[] | null;
  outputs?: readonly AdapterEnd[] | null;
};

/** Nombre de connecteurs d'un côté (quantités comprises, 1 par défaut). */
function countEnds(ends: readonly AdapterEnd[]): number {
  return ends.reduce((a, e) => {
    const q = Number(e.quantity);
    return a + (Number.isFinite(q) && q > 0 ? Math.floor(q) : 1);
  }, 0);
}

function AdapterCard<T extends StrataAdapterItem>({
  item,
  href,
  actions,
  types,
}: {
  item: T;
  href: string;
  actions?: ReactNode;
  types: ReadonlyMap<string, LookupConnectorType>;
}) {
  const toDrawing = (e: AdapterEnd): AdapterEndDrawing => {
    const t = types.get(e.connectorTypeId);
    return { connectorName: t?.name ?? "—", iconId: t?.iconId ?? null, gender: drawingGender(e.gender), quantity: e.quantity };
  };
  const inputs = item.inputs ?? [];
  const outputs = item.outputs ?? [];
  const nIn = countEnds(inputs);
  const nOut = countEnds(outputs);
  const meta = [
    item.function?.label,
    `${nIn} entrée${nIn > 1 ? "s" : ""}`,
    `${nOut} sortie${nOut > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StrataCard
      href={href}
      name={item.name}
      reference={item.reference}
      actions={actions}
      drawing={
        <AdapterDrawing
          adapter={{ name: item.name, inputs: inputs.map(toDrawing), outputs: outputs.map(toDrawing) }}
        />
      }
    >
      <CardMeta>{meta}</CardMeta>
    </StrataCard>
  );
}

export function StrataAdaptersGrid<T extends StrataAdapterItem>({
  items,
  hrefOf,
  renderActions,
}: {
  items: readonly T[];
  hrefOf: (item: T) => string;
  renderActions?: (item: T) => ReactNode;
}) {
  const lookup = useCatalogueLookup();
  // Index calculé une fois par grille, partagé par les cartes.
  const types = useMemo(() => connectorTypeIndex(lookup), [lookup]);
  return (
    <StrataGrid label="Adaptateurs">
      {items.map((it) => (
        <AdapterCard key={it.id} item={it} href={hrefOf(it)} actions={renderActions?.(it)} types={types} />
      ))}
    </StrataGrid>
  );
}
