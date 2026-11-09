"use client";

/**
 * Gérer › Matériel (spec v2 §4.2, §7 « Inventaire, nomenclature ») :
 *   - Inventaire : les lignes d'inventaire du projet groupées par emplacement
 *     puis par contenant (comme l'onglet Inventaire d'arkyo), équipements
 *     libres du lieu à part, contenants sans emplacement en fin ; position en
 *     U lue dans le `canvas-data` des contenants rackables ; filtre ;
 *   - détail de la ligne sélectionnée (`?sel=`) : position (« Voir dans le
 *     rack » / « Placer dans un rack », « Voir sur le synoptique »), faces et
 *     connectique (`EquipmentFaceCard`), puis « Avancé » replié ;
 *   - Nomenclature : la table d'arkyo (`buildBomTable`), avec les réglages
 *     mémorisés par l'export de l'onglet Inventaire ;
 *   - « Ajouter du catalogue » ouvre le parcours d'ajout existant : l'onglet
 *     Inventaire, outil Équipements (catalogue à glisser dans un contenant).
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import type { InventaireBomItem, InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import { EmptyState } from "@/components/ui/empty-state";
import { Box as BoxIcon, MapPin, MousePointer2, Plus, Server, Workflow } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { AdvancedSection } from "../advanced/advanced-section";
import { plural } from "./format";
import { ADD_BTN, Kv, PageHead, Pill, SECTION_LABEL, SMALL_BTN, TabPanel, Tabs, useTabIds } from "./manage-ui";
import { equipmentCount, isRackableContainer, placementOf, slotStartU, type Placement } from "./todo-model";
import { MaterielFaces } from "./materiel-faces";
import { Nomenclature } from "./materiel-nomenclature";
import type { ManageNav, ManageState } from "./use-manage";

type MaterielTab = "inventaire" | "nomenclature";

const KIND_LABEL: Record<InventaireBomItem["kind"], string> = {
  equipment: "Équipement",
  panel: "Panel",
  adapter: "Adaptateur",
  accessory: "Accessoire",
};

/** Ligne d'inventaire et son contexte. */
type Row = {
  item: InventaireBomItem;
  rack: InventaireRack;
  placement: Placement;
};

type Group = {
  key: string;
  name: string;
  containers: { rack: InventaireRack; rows: Row[] }[];
  /** Équipements libres du lieu (rack virtuel). */
  free: Row[];
};

/** Repères en U des slots posés (« U1 », « U10, U12 »). */
function unitsOf(p: Placement, canvas: ManageState["canvas"][string]): string {
  const us = p.slots.map((s) => slotStartU(s, canvas)).filter((u): u is number => u != null);
  return us.length ? [...new Set(us)].sort((a, b) => a - b).map((u) => `U${u}`).join(", ") : "—";
}

function groupsOf(data: ManageState): Group[] {
  const rowsOf = (rack: InventaireRack): Row[] =>
    rack.bom.map((item) => ({ item, rack, placement: placementOf(item, rack, data) }));
  const containers = data.racks.filter((r) => !r.isVirtual);
  const groups: Group[] = [...data.locations]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => {
      const virtual = l.virtualRackId ? data.racks.find((r) => r.id === l.virtualRackId) : undefined;
      return {
        key: l.id,
        name: l.name,
        containers: containers.filter((r) => r.locationId === l.id).map((rack) => ({ rack, rows: rowsOf(rack) })),
        free: virtual ? rowsOf(virtual) : [],
      };
    });
  const known = new Set(data.locations.map((l) => l.id));
  const orphans = containers.filter((r) => !r.locationId || !known.has(r.locationId));
  if (orphans.length > 0)
    groups.push({ key: "__none__", name: "À affecter", containers: orphans.map((rack) => ({ rack, rows: rowsOf(rack) })), free: [] });
  return groups;
}

export function MaterielPage({
  data,
  nav,
  onOpenCatalogue,
}: {
  data: ManageState;
  nav: ManageNav;
  /** Ouvre l'outil Équipements de l'Inventaire (état de l'éditeur, pas seulement le stockage local). */
  onOpenCatalogue: () => void;
}) {
  const [tab, setTab] = useState<MaterielTab>("inventaire");
  const [query, setQuery] = useState("");
  const idBase = useTabIds();
  const groups = useMemo(() => groupsOf(data), [data]);
  const allRows = useMemo(
    () => groups.flatMap((g) => [...g.containers.flatMap((c) => c.rows), ...g.free]),
    [groups],
  );
  const selected = allRows.find((r) => r.item.id === nav.sel) ?? null;
  const containers = data.racks.filter((r) => !r.isVirtual).length;

  const q = query.trim().toLowerCase();
  const match = (r: Row) =>
    !q ||
    [r.item.name, r.item.brandName, r.item.reference, r.item.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  const shown = allRows.filter(match).length;

  // Le parcours d'ajout d'arkyo : l'onglet Inventaire, outil Équipements.
  const addFromCatalogue = () => {
    onOpenCatalogue();
    nav.goToTab("inventaire");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Matériel"
        subtitle={[
          plural(equipmentCount(data.racks), "équipement"),
          plural(data.locations.length, "emplacement"),
          plural(containers, "contenant"),
        ].join(" · ")}
        actions={
          <button type="button" onClick={addFromCatalogue} className={ADD_BTN}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter du catalogue
          </button>
        }
      >
        <Tabs
          label="Matériel"
          idBase={idBase}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "inventaire", label: "Inventaire", count: allRows.length },
            { id: "nomenclature", label: "Nomenclature" },
          ]}
        />
      </PageHead>

      <TabPanel
        idBase={idBase}
        value={tab}
        className={cn(
          "grid min-h-0 flex-1",
          tab === "inventaire" ? "grid-cols-[minmax(0,1fr)_clamp(340px,32vw,420px)]" : "grid-cols-1",
        )}
      >
        {tab === "inventaire" ? (
          <>
            <section
              aria-label="Inventaire du projet"
              className="flex min-w-0 flex-col gap-3.5 overflow-auto px-6 pt-3.5 pb-24"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="Filtrer le matériel"
                  placeholder="Filtrer le matériel"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                  className="h-8 w-[260px] rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12.5px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <span className="flex-1" />
                {allRows.length > 0 && (
                  <span className="text-[12px] text-[var(--muted-foreground)]">{`${shown} affichés`}</span>
                )}
              </div>
              {allRows.length === 0 ? (
                <EmptyState icon={<BoxIcon strokeWidth={1.5} />} title="Aucun équipement" />
              ) : (
                groups.map((g) => (
                  <LocationGroup
                    key={g.key}
                    group={g}
                    data={data}
                    nav={nav}
                    match={match}
                    filtering={!!q}
                  />
                ))
              )}
            </section>
            <aside
              aria-label="Détail"
              className="min-w-0 overflow-auto border-l border-[var(--border)] bg-[var(--card)]"
            >
              {selected ? (
                <ItemDetail key={selected.item.id} row={selected} data={data} nav={nav} />
              ) : (
                <EmptyState icon={<MousePointer2 strokeWidth={1.5} />} title="Aucune sélection" />
              )}
            </aside>
          </>
        ) : (
          <Nomenclature data={data} />
        )}
      </TabPanel>
    </div>
  );
}

const TABLE = "w-full table-fixed border-collapse text-[12.5px]";
const CELL = "overflow-hidden border-t border-[var(--border)] px-3.5 py-[7px] text-ellipsis whitespace-nowrap";

function LocationGroup({
  group,
  data,
  nav,
  match,
  filtering,
}: {
  group: Group;
  data: ManageState;
  nav: ManageNav;
  match: (r: Row) => boolean;
  filtering: boolean;
}) {
  const containers = group.containers.map((c) => ({ ...c, rows: c.rows.filter(match) }));
  const free = group.free.filter(match);
  const empty = group.containers.length === 0 && group.free.length === 0;
  // Filtre actif : seuls les contenants qui ont une ligne retenue.
  const shownContainers = filtering ? containers.filter((c) => c.rows.length > 0) : containers;
  if (filtering && shownContainers.length === 0 && free.length === 0) return null;

  return (
    <section
      role="group"
      aria-label={group.name}
      className="rounded-[10px] border border-[var(--border)] bg-[var(--card)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-[11px]">
        <MapPin aria-hidden className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        <h3 className="m-0 flex-1 text-[13px] font-bold text-[var(--foreground)]">{group.name}</h3>
      </header>
      {empty && <EmptyState icon={<BoxIcon strokeWidth={1.5} />} title="Aucun équipement" className="py-8" />}
      {shownContainers.map(({ rack, rows }) => (
        <div key={rack.id}>
          <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1">
            <span className={SECTION_LABEL}>{rack.name}</span>
            {!rack.isRackable && <span className="text-[11.5px] text-[var(--text-tertiary)]">non rackable</span>}
            <span className="flex-1" />
            {isRackableContainer(rack) && (
              <button type="button" onClick={() => nav.goToRack(rack.id)} className={SMALL_BTN}>
                <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                Élévation
              </button>
            )}
          </div>
          <ItemTable label={rack.name} rows={rows} data={data} nav={nav} />
        </div>
      ))}
      {free.length > 0 && (
        <div>
          <div className="px-3.5 pt-2.5 pb-1">
            <span className={SECTION_LABEL}>Hors contenant</span>
          </div>
          <ItemTable label="Hors contenant" rows={free} data={data} nav={nav} />
        </div>
      )}
    </section>
  );
}

function ItemTable({ label, rows, data, nav }: { label: string; rows: Row[]; data: ManageState; nav: ManageNav }) {
  if (rows.length === 0) return <EmptyState icon={<BoxIcon strokeWidth={1.5} />} title="Contenant vide" className="py-6" />;
  return (
    <table aria-label={label} className={TABLE}>
      <colgroup>
        <col className="w-[72px]" />
        <col />
        <col className="w-[44px]" />
        <col className="w-[28%]" />
        <col className="w-[96px]" />
      </colgroup>
      <tbody>
        {rows.map((r) => {
          const on = r.item.id === nav.sel;
          const open = () => nav.select(r.item.id);
          return (
            <tr
              key={r.item.id}
              tabIndex={0}
              aria-current={on ? "true" : undefined}
              onClick={open}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  open();
                }
              }}
              className={cn(
                "cursor-pointer outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]",
                on && "bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]",
              )}
            >
              <td className={cn(CELL, "font-mono text-[11.5px] text-[var(--muted-foreground)]")}>
                {r.placement.status === "component" ? "—" : unitsOf(r.placement, data.canvas[r.rack.id])}
              </td>
              <td className={CELL}>
                <strong className="font-semibold text-[var(--foreground)]">{r.item.name}</strong>
              </td>
              <td className={cn(CELL, "text-right font-mono text-[11.5px] text-[var(--muted-foreground)]")}>
                {r.item.quantity > 1 ? `×${r.item.quantity}` : ""}
              </td>
              <td className={cn(CELL, "text-[var(--muted-foreground)]")}>{r.item.brandName ?? ""}</td>
              <td className={cn(CELL, "text-right")}>
                {r.placement.missing > 0 && <Pill tone="warn">{`${r.placement.missing} à placer`}</Pill>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Où se trouve la ligne : contenant, U, ou lieu (libre). */
function positionText(row: Row, data: ManageState): string {
  const { rack, placement } = row;
  const location = data.locations.find((l) => l.id === rack.locationId || l.virtualRackId === rack.id);
  switch (placement.status) {
    case "free":
      return `${location?.name ?? "Lieu"} · hors contenant`;
    case "container":
      return `${rack.name} · contenant non rackable`;
    case "component":
      return `${rack.name} · composant d'un châssis`;
    case "none":
    case "unavailable":
      return `${rack.name} · lecture impossible`;
    case "loading":
      return rack.name;
    case "unplaced":
      return `${rack.name} · ${placement.missing} à placer`;
    default: {
      const units = unitsOf(placement, data.canvas[rack.id]);
      return `${rack.name} · ${units}${placement.missing > 0 ? ` · ${placement.missing} à placer` : ""}`;
    }
  }
}

function ItemDetail({ row, data, nav }: { row: Row; data: ManageState; nav: ManageNav }) {
  const { item, rack, placement } = row;
  const isEquipment = item.kind === "equipment";
  const location = data.locations.find((l) => l.id === rack.locationId || l.virtualRackId === rack.id);
  const rackable = isRackableContainer(rack);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[2] flex flex-col gap-1 border-b border-[var(--border)] bg-[var(--card)] px-[18px] pt-4 pb-3">
        <span className={SECTION_LABEL}>{item.category ?? KIND_LABEL[item.kind]}</span>
        <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em] text-[var(--foreground)]">{item.name}</h2>
        {item.brandName && <span className="text-[12.5px] text-[var(--muted-foreground)]">{item.brandName}</span>}
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] pt-3.5 pb-10">
        <div className="flex flex-col gap-2">
          <span className={SECTION_LABEL}>Position</span>
          <div className="text-[12.5px] text-[var(--foreground)]">{positionText(row, data)}</div>
          {(isEquipment || rackable) && placement.status !== "none" && placement.status !== "component" && (
            <div className="flex flex-wrap gap-1.5">
              {rackable && (
                <button type="button" onClick={() => nav.goToRack(rack.id)} className={SMALL_BTN}>
                  <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  {placement.missing > 0 ? "Placer dans un rack" : "Voir dans le rack"}
                </button>
              )}
              {(isEquipment || item.kind === "panel") && (
                <button type="button" onClick={() => nav.goToTab("synoptique")} className={SMALL_BTN}>
                  <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  Voir sur le synoptique
                </button>
              )}
            </div>
          )}
        </div>

        <Kv
          rows={[
            ["Quantité", String(item.quantity)],
            ["Emplacement", location?.name ?? "—"],
            ["Contenant", rack.isVirtual ? "Hors contenant" : rack.name],
          ]}
        />

        {isEquipment && (
          <MaterielFaces item={item} rack={rack} placed={placement.slots} data={data} locationName={location?.name ?? null} />
        )}

        <AdvancedSection kind="materiel" summary="Référence, type, identifiants">
          <Kv
            rows={[
              ["Référence", item.reference || "—"],
              ["Type", KIND_LABEL[item.kind]],
              ["Catégorie", item.category || "—"],
              ["Hauteur", item.heightU ? `${item.heightU} U` : item.isRackable ? "—" : "pose libre"],
              ["Profondeur", item.depthMm ? `${item.depthMm} mm` : "—"],
              ["Fiche du catalogue", <span className="font-mono text-[11.5px]">{item.refId ?? "—"}</span>],
              ["Ligne d'inventaire", <span className="font-mono text-[11.5px]">{item.id}</span>],
            ]}
          />
        </AdvancedSection>
      </div>
    </div>
  );
}
