"use client";

/**
 * Catalogue › Équipements (Strata v2) : liste filtrable et fiche en lecture.
 *
 * Fonctions du panneau d'arkyo (`EquipmentListPanel`), toutes présentes :
 *   - recherche (nom, référence, marque, catégorie, fonctions, type) ;
 *   - filtres à choix multiples : marque (`BrandMultiSelect` d'arkyo),
 *     fonction, type (hiérarchie Fonction → Type) et phase (pastilles `Chip`
 *     d'arkyo), dans des fenêtres modales aux mots d'un filtre ; format,
 *     ST 2110 et Lumière ; « Réinitialiser les filtres » ; filtres et tri
 *     mémorisés (`strata-catalogue-filters:equipment`) ;
 *   - tri : nom, marque, référence, catégorie, hauteur (U), puissance (W),
 *     croissant ou décroissant ;
 *   - sélection multiple et suppression en lot ; Dupliquer et Supprimer
 *     dans la fiche ; « Nouvel équipement » ouvre l'assistant existant.
 */

import { memo, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BrandMultiSelect } from "@/app/(app)/admin/_components/list-toolbar-helpers";
import { NewEquipmentWizard } from "@/components/equipment/new-equipment-wizard";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { Package, Plus, Search } from "@/components/ui/icons";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  fullestFace,
  parseConnectors,
  totalPorts,
  type CatalogueLookup,
} from "../catalogue-model";
import { EquipmentFace } from "../drawings/equipment-face";
import type { DrawingConnectorType, DrawingSignal } from "../drawings/face-layout";
import { useCatalogueActions, useListSelection } from "./catalogue-actions";
import { sortBy, toggleIn, useStoredFilters, type SortDir } from "./catalogue-filters";
import {
  ChipChoices,
  ChoiceGroup,
  countLabel,
  DetailActions,
  FacetButton,
  FaceWell,
  FilterDialog,
  ListDetail,
  ListRow,
  NewButton,
  PagedList,
  ResetFiltersButton,
  RowFigure,
  RowTitle,
  SearchField,
  SelectionBar,
  SortControl,
  ToggleChip,
  Toolbar,
  type RowCheck,
} from "./catalogue-ui";
import { EquipmentDetail, phaseIdsOf } from "./equipment-detail";
import type { CatalogueEquipment, CatalogueItems } from "./use-catalogue-items";

type Format = "all" | "rack" | "libre";
type Picker = "brand" | "function" | "type" | "phase" | null;
type SortKey = "name" | "brand" | "reference" | "category" | "height" | "power";

const FORMATS: { id: Format; label: string }[] = [
  { id: "all", label: "Tous les formats" },
  { id: "rack", label: "Rackable" },
  { id: "libre", label: "Pose libre" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Nom" },
  { id: "brand", label: "Marque" },
  { id: "reference", label: "Référence" },
  { id: "category", label: "Catégorie" },
  { id: "height", label: "Hauteur (U)" },
  { id: "power", label: "Puissance (W)" },
];

const SORT_VALUE: Record<SortKey, (it: CatalogueEquipment) => string | number | null | undefined> = {
  name: (it) => it.name,
  brand: (it) => it.brand?.name,
  reference: (it) => it.reference,
  category: (it) => it.category ?? it.equipmentCategory?.name,
  // Comme la colonne Format d'arkyo : hauteur des rackables, rien pour la pose libre.
  height: (it) => (it.isRackable !== false ? (it.heightU ?? 0) : null),
  power: (it) => it.powerW,
};

const DEFAULTS = {
  brands: [] as string[],
  functions: [] as string[],
  types: [] as string[],
  phases: [] as string[],
  format: "all" as string,
  is2110: false,
  lighting: false,
  sort: { key: "name" as string, dir: "asc" as string },
};
type Filters = typeof DEFAULTS;

function valid(f: Filters): Filters {
  return {
    ...f,
    format: FORMATS.some((o) => o.id === f.format) ? f.format : "all",
    sort: {
      key: SORTS.some((o) => o.id === f.sort.key) ? f.sort.key : "name",
      dir: f.sort.dir === "desc" ? "desc" : "asc",
    },
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr");
const names = (ids: readonly string[], label: (id: string) => string | undefined) =>
  ids.length ? ids.map((id) => label(id) ?? "?").join(", ") : null;

export function EquipmentTab({
  list,
  lookup,
  selectedId,
  onSelect,
  canWrite,
}: {
  list: CatalogueItems<CatalogueEquipment>;
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
}) {
  const items = list.items;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [f, setF] = useStoredFilters("equipment", DEFAULTS, valid);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const actions = useCatalogueActions("equipment", { reload: list.refresh, removeLocal: list.removeLocal });

  // Référentiels des filtres : ceux présents dans la liste (comme arkyo).
  const brands = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const it of items) if (it.brand?.id && it.brand.name) seen.set(it.brand.id, it.brand);
    return [...seen.values()].sort(byName);
  }, [items]);
  const functions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of items) for (const fn of it.functions ?? []) if (!seen.has(fn.id)) seen.set(fn.id, fn);
    return [...seen.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [items]);
  const typeById = useMemo(() => new Map((lookup?.types ?? []).map((t) => [t.id, t])), [lookup]);
  // Types présents, limités aux fonctions choisies (hiérarchie d'arkyo : Fonction → Type).
  const types = useMemo(() => {
    const used = new Set<string>();
    for (const it of items) if (it.typeId) used.add(it.typeId);
    return (lookup?.types ?? [])
      .filter((t) => used.has(t.id) && (f.functions.length === 0 || f.functions.includes(t.functionId)))
      .map((t) => {
        const parent = t.parentId ? typeById.get(t.parentId) : undefined;
        return { id: t.id, label: parent ? `${parent.name} › ${t.name}` : t.name };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items, lookup, typeById, f.functions]);
  const phases = useMemo(() => (lookup?.phases ?? []).map((p) => ({ id: p.id, label: p.label })), [lookup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = items.filter((it) => {
      if (q) {
        const hay = [
          it.name,
          it.reference ?? "",
          it.brand?.name ?? "",
          it.category ?? "",
          it.type?.name ?? "",
          ...(it.functions ?? []).map((fn) => fn.label),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (f.brands.length && !(it.brand?.name && f.brands.includes(it.brand.name))) return false;
      if (f.functions.length && !(it.functions ?? []).some((fn) => f.functions.includes(fn.id))) return false;
      if (f.types.length && !(it.typeId && f.types.includes(it.typeId))) return false;
      if (f.phases.length && !phaseIdsOf(it).some((id) => f.phases.includes(id))) return false;
      if (f.format === "rack" && it.isRackable === false) return false;
      if (f.format === "libre" && it.isRackable !== false) return false;
      if (f.is2110 && !it.is2110) return false;
      if (f.lighting && it.isLightingFixture !== true) return false;
      return true;
    });
    return sortBy(out, SORT_VALUE[f.sort.key as SortKey], f.sort.dir as SortDir);
  }, [items, search, f]);

  const filterCount =
    (f.brands.length ? 1 : 0) +
    (f.functions.length ? 1 : 0) +
    (f.types.length ? 1 : 0) +
    (f.phases.length ? 1 : 0) +
    (f.format !== "all" ? 1 : 0) +
    (f.is2110 ? 1 : 0) +
    (f.lighting ? 1 : 0);
  const reset = () => {
    setSearch("");
    setF((p) => ({ ...DEFAULTS, sort: p.sort }));
  };
  const filterKey = `${search}|${JSON.stringify(f)}`;
  const selected = items.find((it) => it.id === selectedId) ?? filtered[0] ?? null;
  const { selection, bulkDelete, total } = useListSelection(filtered, canWrite, actions);

  // Dessins des lignes : référentiels calculés une fois.
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);
  const fnLabel = (id: string) => functions.find((x) => x.id === id)?.label;
  const close = (o: boolean) => {
    if (!o) setPicker(null);
  };
  const openWizard = () => setWizardOpen(true);

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-[var(--muted-foreground)]">
          Fiches d'équipement avec leur connectique par face.
        </p>
        {canWrite && <NewButton label="Nouvel équipement" onClick={openWizard} />}
      </div>
      <Toolbar count={countLabel(filtered.length, items.length)}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Rechercher dans les équipements"
          placeholder="Nom, référence, marque, catégorie…"
        />
        <FacetButton
          label="Fabricant"
          value={f.brands.length ? f.brands.join(", ") : null}
          onOpen={() => setPicker("brand")}
          onClear={() => setF((p) => ({ ...p, brands: [] }))}
        />
        <FacetButton
          label="Fonction"
          value={names(f.functions, fnLabel)}
          onOpen={() => setPicker("function")}
          onClear={() => setF((p) => ({ ...p, functions: [] }))}
        />
        <FacetButton
          label="Type"
          value={names(f.types, (id) => typeById.get(id)?.name)}
          onOpen={() => setPicker("type")}
          onClear={() => setF((p) => ({ ...p, types: [] }))}
        />
        <FacetButton
          label="Phase"
          value={names(f.phases, (id) => phases.find((p) => p.id === id)?.label)}
          onOpen={() => setPicker("phase")}
          onClear={() => setF((p) => ({ ...p, phases: [] }))}
        />
        <ChoiceGroup
          label="Format"
          options={FORMATS}
          value={f.format as Format}
          onChange={(v) => setF((p) => ({ ...p, format: v }))}
        />
        <ToggleChip label="ST 2110" pressed={f.is2110} onClick={() => setF((p) => ({ ...p, is2110: !p.is2110 }))} />
        <ToggleChip label="Lumière" pressed={f.lighting} onClick={() => setF((p) => ({ ...p, lighting: !p.lighting }))} />
        <SortControl
          options={SORTS}
          value={{ key: f.sort.key as SortKey, dir: f.sort.dir as SortDir }}
          onChange={(sort) => setF((p) => ({ ...p, sort }))}
        />
        {(filterCount > 0 || search) && <ResetFiltersButton onClick={reset} />}
      </Toolbar>
      <SelectionBar
        count={selection.selected.size}
        total={total}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
        onDelete={() => void bulkDelete()}
      />
    </>
  );

  let listNode: ReactNode;
  if (items.length === 0) {
    listNode = (
      <EmptyState
        icon={<Package strokeWidth={1.5} />}
        title="Aucun équipement"
        description="Ajoutez votre premier équipement personnel."
        action={
          canWrite ? (
            <EmptyStateAction onClick={openWizard}>
              <Plus className="h-3.5 w-3.5" />
              Créer mon premier équipement
            </EmptyStateAction>
          ) : undefined
        }
      />
    );
  } else if (filtered.length === 0) {
    listNode = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun équipement pour ces filtres"
        description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
        action={<EmptyStateAction onClick={reset}>Réinitialiser les filtres</EmptyStateAction>}
        className="py-16"
      />
    );
  } else {
    listNode = (
      <PagedList
        label="Équipements"
        items={filtered}
        resetKey={filterKey}
        renderItem={(it) => (
          <EquipmentRow
            key={it.id}
            item={it}
            selected={it.id === selected?.id}
            onSelect={onSelect}
            checked={canWrite ? selection.isSelected(it.id) : null}
            onCheck={selection.onCheckboxClick}
            connectorTypes={connectorTypes}
            signals={signals}
          />
        )}
      />
    );
  }

  return (
    <>
      <ListDetail
        toolbar={toolbar}
        list={listNode}
        detail={
          selected ? (
            <EquipmentDetail
              key={selected.id}
              item={selected}
              lookup={lookup}
              actions={
                canWrite ? (
                  <DetailActions
                    href={`/admin/catalogue/equipment/${selected.id}`}
                    onDuplicate={() => void actions.duplicate(selected)}
                    onDelete={() => void actions.remove(selected)}
                  />
                ) : null
              }
            />
          ) : (
            <EmptyState icon={<Package strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
          )
        }
      />

      <FilterDialog
        open={picker === "brand"}
        onOpenChange={close}
        title="Filtrer par fabricant"
        count={f.brands.length}
        onClear={() => setF((p) => ({ ...p, brands: [] }))}
      >
        <BrandMultiSelect
          brands={brands}
          selected={new Set(f.brands)}
          onToggle={(n) => setF((p) => ({ ...p, brands: toggleIn(p.brands, n) }))}
          onClear={() => setF((p) => ({ ...p, brands: [] }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "function"}
        onOpenChange={close}
        title="Filtrer par fonction"
        count={f.functions.length}
        onClear={() => setF((p) => ({ ...p, functions: [] }))}
      >
        <ChipChoices
          options={functions}
          selected={f.functions}
          onToggle={(id) =>
            setF((p) => {
              const fns = toggleIn(p.functions, id);
              // Le type suit la fonction : un type hors des fonctions choisies est retiré.
              const kept = fns.length ? p.types.filter((t) => fns.includes(typeById.get(t)?.functionId ?? "")) : p.types;
              return { ...p, functions: fns, types: kept };
            })
          }
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "type"}
        onOpenChange={close}
        title="Filtrer par type d'équipement"
        description={f.functions.length ? "Types des fonctions choisies ; plusieurs choix possibles." : undefined}
        count={f.types.length}
        onClear={() => setF((p) => ({ ...p, types: [] }))}
      >
        <ChipChoices
          options={types}
          selected={f.types}
          onToggle={(id) => setF((p) => ({ ...p, types: toggleIn(p.types, id) }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "phase"}
        onOpenChange={close}
        title="Filtrer par phase"
        count={f.phases.length}
        onClear={() => setF((p) => ({ ...p, phases: [] }))}
      >
        <ChipChoices
          options={phases}
          selected={f.phases}
          onToggle={(id) => setF((p) => ({ ...p, phases: toggleIn(p.phases, id) }))}
        />
      </FilterDialog>

      <NewEquipmentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/equipment/${id}`);
          else list.refresh();
        }}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/equipment/new");
        }}
      />
    </>
  );
}

const EquipmentRow = memo(function EquipmentRow({
  item,
  selected,
  onSelect,
  checked,
  onCheck,
  connectorTypes,
  signals,
}: {
  item: CatalogueEquipment;
  selected: boolean;
  onSelect: (id: string) => void;
  /** `null` : pas de coche (lecture seule). */
  checked: boolean | null;
  onCheck: RowCheck["onClick"];
  connectorTypes: readonly DrawingConnectorType[];
  signals: readonly DrawingSignal[];
}) {
  const connectors = useMemo(() => parseConnectors(item.connectors), [item.connectors]);
  const rackable = item.isRackable !== false;
  const ports = totalPorts(connectors);
  const meta = [item.brand?.name, item.functions?.[0]?.label ?? item.type?.name].filter(Boolean).join(" · ");
  return (
    <ListRow
      id={item.id}
      selected={selected}
      onSelect={onSelect}
      check={checked === null ? undefined : { checked, label: `Sélectionner ${item.name}`, onClick: onCheck }}
    >
      <div aria-hidden className="w-[120px] shrink-0">
        <FaceWell className="p-1">
          {connectors.length ? (
            <EquipmentFace
              equipment={{ name: item.name, brand: item.brand?.name, heightU: item.heightU, isRackable: rackable, connectors }}
              face={fullestFace(connectors)}
              connectorTypes={connectorTypes}
              signals={signals}
            />
          ) : (
            <div className="h-6" />
          )}
        </FaceWell>
      </div>
      <RowTitle name={item.name} meta={meta} />
      <RowFigure className="w-12 text-right">{rackable ? `${fmtNumber(item.heightU)} U` : "libre"}</RowFigure>
      <RowFigure className="w-14 text-right">{item.powerW != null ? `${fmtNumber(item.powerW)} W` : "—"}</RowFigure>
      <RowFigure className="hidden w-16 text-right sm:inline">{`${ports} port${ports > 1 ? "s" : ""}`}</RowFigure>
    </ListRow>
  );
});
