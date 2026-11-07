/**
 * Grille Strata des équipements du catalogue (`/admin/catalogue` en interface
 * Strata, vue grille ; spec §6.3, maquette `viewCatalogue`). Chaque carte
 * dessine la face de l'équipement depuis sa connectique catalogue, puis :
 * nom et référence, marque · catégorie · type, caractéristiques (U, poids,
 * puissance, ports, double alimentation, ST 2110) et la barre des ports par
 * famille de signal.
 *
 * Les éléments sont la liste déjà filtrée et triée du panneau existant
 * (`EquipmentListPanel`) : recherche et filtres s'appliquent tels quels. Le
 * clic ouvre l'éditeur existant ; les actions de carte du panneau restent.
 */

import { useMemo, type ReactNode } from "react";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { EquipmentFace } from "../drawings/equipment-face";
import type { DrawingConnectorType, DrawingSignal } from "../drawings/face-layout";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  parseConnectors,
  portFamilies,
  totalPorts,
  useCatalogueLookup,
  type CatalogueLookup,
} from "../catalogue-model";
import { CardMeta, StrataCard, StrataGrid } from "./strata-card";

/** Équipement de `GET /api/tenant/catalogue/equipment` (ligne enrichie). */
export type StrataEquipmentItem = {
  id: string;
  name: string;
  reference: string | null;
  brand?: { name: string } | null;
  category?: string | null;
  equipmentCategory?: { name: string } | null;
  type?: { name: string } | null;
  heightU?: number | null;
  isRackable?: boolean;
  weight?: number | null;
  powerW?: number | null;
  hasDualPsu?: boolean | null;
  is2110?: boolean | null;
  dimLmm?: number | null;
  dimWmm?: number | null;
  dimHmm?: number | null;
  /** Colonne JSON `connectors` (entrées de connectique). */
  connectors?: unknown;
};

/** Face dessinée sur la carte : la plus garnie (avant à égalité). */
export function cardFace(connectors: readonly ConnectorEntry[]): "FRONT" | "REAR" {
  const ports = (face: ConnectorEntry["face"]) => totalPorts(connectors.filter((c) => c.face === face));
  return ports("REAR") > ports("FRONT") ? "REAR" : "FRONT";
}

/** Barre fine des ports par famille de signal (couleurs des fonctions). */
export function FamilyBar({
  connectors,
  lookup,
  className,
}: {
  connectors: readonly ConnectorEntry[];
  lookup: CatalogueLookup | null;
  className?: string;
}) {
  const families = portFamilies(connectors, lookup);
  const total = families.reduce((a, f) => a + f.count, 0);
  return (
    <div
      aria-hidden
      className={`flex h-1.5 overflow-hidden rounded-[2px] bg-[var(--muted)] ${className ?? ""}`}
    >
      {families.map((f) => (
        <i
          key={f.key}
          data-family={f.key}
          title={`${f.label} · ${f.count} port${f.count > 1 ? "s" : ""}`}
          className="block h-full"
          style={{ width: `${Number(((f.count / total) * 100).toFixed(2))}%`, background: f.color }}
        />
      ))}
    </div>
  );
}

function EquipmentCard<T extends StrataEquipmentItem>({
  item,
  href,
  actions,
  lookup,
  connectorTypes,
  signals,
}: {
  item: T;
  href: string;
  actions?: ReactNode;
  lookup: CatalogueLookup | null;
  connectorTypes: readonly DrawingConnectorType[];
  signals: readonly DrawingSignal[];
}) {
  const connectors = useMemo(() => parseConnectors(item.connectors), [item.connectors]);
  const ports = totalPorts(connectors);
  const rackable = item.isRackable !== false;
  const meta = [item.brand?.name, item.equipmentCategory?.name ?? item.category, item.type?.name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" · ");
  const dims = [item.dimLmm, item.dimWmm, item.dimHmm].filter((d) => typeof d === "number" && d > 0);

  return (
    <StrataCard
      href={href}
      name={item.name}
      reference={item.reference}
      actions={actions}
      drawing={
        <EquipmentFace
          equipment={{
            name: item.name,
            brand: item.brand?.name,
            heightU: item.heightU,
            isRackable: rackable,
            dims: dims.length ? dims : null,
            connectors,
          }}
          face={cardFace(connectors)}
          connectorTypes={connectorTypes}
          signals={signals}
        />
      }
    >
      {meta ? <CardMeta>{meta}</CardMeta> : null}
      <ul
        aria-label="Caractéristiques"
        className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--muted-foreground)] tabular-nums"
      >
        <Spec>
          {rackable ? (
            <>
              <b className="font-medium text-[var(--foreground)]">{fmtNumber(item.heightU)}</b> U
            </>
          ) : (
            <b className="font-medium text-[var(--foreground)]">Pose libre</b>
          )}
        </Spec>
        <Spec value={item.weight} unit="kg" />
        <Spec value={item.powerW} unit="W" />
        <Spec value={ports} unit={ports > 1 ? "ports" : "port"} />
        {item.hasDualPsu ? <Spec>Double alim.</Spec> : null}
        {item.is2110 ? <Spec>ST 2110</Spec> : null}
      </ul>
      <FamilyBar connectors={connectors} lookup={lookup} />
    </StrataCard>
  );
}

function Spec({ value, unit, children }: { value?: number | null; unit?: string; children?: ReactNode }) {
  return (
    <li>
      {children ?? (
        <>
          <b className="font-medium text-[var(--foreground)]">{fmtNumber(value)}</b> {unit}
        </>
      )}
    </li>
  );
}

export function StrataCatalogueGrid<T extends StrataEquipmentItem>({
  items,
  hrefOf,
  renderActions,
}: {
  items: readonly T[];
  hrefOf: (item: T) => string;
  renderActions?: (item: T) => ReactNode;
}) {
  const lookup = useCatalogueLookup();
  // Référentiels des dessins calculés une fois par grille, partagés par les cartes.
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);
  return (
    <StrataGrid label="Équipements">
      {items.map((it) => (
        <EquipmentCard
          key={it.id}
          item={it}
          href={hrefOf(it)}
          actions={renderActions?.(it)}
          lookup={lookup}
          connectorTypes={connectorTypes}
          signals={signals}
        />
      ))}
    </StrataGrid>
  );
}
