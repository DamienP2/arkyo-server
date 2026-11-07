/**
 * Grille Strata des cordons du catalogue (onglet Cordons en interface Strata,
 * vue grille ; spec §6.3, maquette `viewCatalogue`, `.cable-card`) : dessin du
 * câble (extrémités, genres `M` / `F` / `N`, bague à la couleur de la
 * fonction), données du modèle de câble (`lookup.cableModels`) et longueurs.
 *
 * Les éléments sont la liste déjà filtrée et triée de `CablesListPanel`.
 */

import { useMemo, type ReactNode } from "react";
import { CONDUCTOR_LABEL, JACKET_LABEL, SHIELDING_LABEL } from "@/components/catalogue/cabling/cabling-card";
import { CableDrawing } from "../drawings/cable-drawing";
import {
  connectorTypeIndex,
  drawingGender,
  fmtNumber,
  useCatalogueLookup,
  type LookupCableModel,
  type LookupConnectorType,
} from "../catalogue-model";
import { StrataCard, StrataGrid } from "./strata-card";

/** Cordon de `GET /api/tenant/catalogue/cables` (ligne enrichie). */
export type StrataCableItem = {
  id: string;
  name: string;
  reference: string | null;
  function?: { label: string; color: string } | null;
  leftConnector?: { name: string } | null;
  leftConnectorId?: string | null;
  leftGender?: string | null;
  rightConnector?: { name: string } | null;
  rightConnectorId?: string | null;
  rightGender?: string | null;
  brand?: { name: string } | null;
  model?: string | null;
  cableModelId?: string | null;
  useCases?: string[];
  availableLengths?: number[];
  customMinLength?: number | null;
  customMaxLength?: number | null;
};

const USE_CASE_LABEL: Record<string, string> = {
  PRESTATION: "Prestation",
  INSTALLATION: "Installation",
};

/** Libellé d'une énumération des réglages (repris de la carte de câblage), la valeur à défaut. */
const label = (labels: Record<string, string>, v: string | null | undefined) => (v ? (labels[v] ?? v) : null);

const join = (parts: (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" · ");

function CableCard<T extends StrataCableItem>({
  item,
  href,
  actions,
  types,
  models,
}: {
  item: T;
  href: string;
  actions?: ReactNode;
  types: ReadonlyMap<string, LookupConnectorType>;
  models: ReadonlyMap<string, LookupCableModel>;
}) {
  const model = item.cableModelId ? models.get(item.cableModelId) : undefined;
  const end = (id: string | null | undefined, ref: { name: string } | null | undefined, g: string | null | undefined) => {
    const t = id ? types.get(id) : undefined;
    return { connectorName: t?.name ?? ref?.name ?? "—", iconId: t?.iconId ?? null, gender: drawingGender(g) };
  };

  const rows: [string, ReactNode][] = [];
  if (item.function) {
    rows.push([
      "Fonction",
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0" style={{ background: item.function.color }} />
        {item.function.label}
      </span>,
    ]);
  }
  const modelName = (model ? [model.brandName, model.name] : [item.brand?.name, item.model])
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" ");
  if (modelName) rows.push(["Modèle", modelName]);
  if (model) {
    const electrical = join([
      model.impedance != null && `${fmtNumber(model.impedance)} Ω`,
      model.bandwidthMHz != null && `${fmtNumber(model.bandwidthMHz)} MHz`,
    ]);
    if (electrical) rows.push(["Électrique", electrical]);
    const construction = join([label(CONDUCTOR_LABEL, model.conductor), label(SHIELDING_LABEL, model.shielding)]);
    if (construction) rows.push(["Construction", construction]);
    const jacket = join([
      label(JACKET_LABEL, model.jacketMaterial),
      model.diameterMm != null && `Ø ${fmtNumber(model.diameterMm)} mm`,
      model.fireRating,
    ]);
    if (jacket) rows.push(["Gaine", jacket]);
  }
  const uses = (item.useCases ?? []).map((u) => USE_CASE_LABEL[u] ?? u);
  if (uses.length) rows.push(["Usage", uses.join(", ")]);

  const lengths = item.availableLengths ?? [];
  const custom = item.customMinLength != null || item.customMaxLength != null;

  return (
    <StrataCard
      href={href}
      name={item.name}
      reference={item.reference}
      actions={actions}
      drawing={
        <CableDrawing
          cable={{
            name: item.name,
            left: end(item.leftConnectorId, item.leftConnector, item.leftGender),
            right: end(item.rightConnectorId, item.rightConnector, item.rightGender),
            color: item.function?.color ?? null,
          }}
        />
      }
    >
      {rows.length > 0 && (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--text-tertiary)]">{k}</dt>
              <dd className="m-0 min-w-0 truncate text-[var(--foreground)]">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {lengths.length > 0 && (
        <ul aria-label="Longueurs" className="flex flex-wrap gap-1">
          {lengths.map((l, i) => (
            <li
              key={`${l}-${i}`}
              className="rounded border border-[var(--border-strong)] px-1.5 py-px font-mono text-[11px] font-medium text-[var(--muted-foreground)]"
            >
              {fmtNumber(l)} m
            </li>
          ))}
        </ul>
      )}
      {custom && (
        <span className="text-xs text-[var(--text-tertiary)]">
          {`Sur mesure ${fmtNumber(item.customMinLength ?? 0)} à ${item.customMaxLength != null ? fmtNumber(item.customMaxLength) : "∞"} m`}
        </span>
      )}
    </StrataCard>
  );
}

export function StrataCablesGrid<T extends StrataCableItem>({
  items,
  hrefOf,
  renderActions,
}: {
  items: readonly T[];
  hrefOf: (item: T) => string;
  renderActions?: (item: T) => ReactNode;
}) {
  const lookup = useCatalogueLookup();
  // Index calculés une fois par grille, partagés par les cartes.
  const types = useMemo(() => connectorTypeIndex(lookup), [lookup]);
  const models = useMemo(() => new Map((lookup?.cableModels ?? []).map((m) => [m.id, m])), [lookup]);
  return (
    <StrataGrid label="Cordons">
      {items.map((it) => (
        <CableCard
          key={it.id}
          item={it}
          href={hrefOf(it)}
          actions={renderActions?.(it)}
          types={types}
          models={models}
        />
      ))}
    </StrataGrid>
  );
}
