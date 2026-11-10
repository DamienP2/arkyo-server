"use client";

/**
 * Catalogue › Adaptateurs (Strata v2) : liste filtrable et fiche en lecture
 * (dessin entrées → sorties, essentiel, notes dans « Avancé »).
 *
 * Fonctions du panneau d'arkyo (`AdaptersListPanel`), toutes présentes :
 *   - recherche (nom, référence, fonction) ;
 *   - filtres à choix multiples : fonction, connecteur en entrée, connecteur
 *     en sortie (pastilles `Chip` d'arkyo), dans des fenêtres modales aux
 *     mots d'un filtre ; « Réinitialiser les filtres » ; filtres et tri
 *     mémorisés (`strata-catalogue-filters:adapters`) ;
 *   - tri : nom, référence, fonction, croissant ou décroissant ;
 *   - sélection multiple et suppression en lot ; Dupliquer et Supprimer
 *     dans la fiche ; « Nouvel adaptateur » ouvre l'assistant existant.
 */

import { memo, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NewAdapterWizard } from "@/components/adapters/new-adapter-wizard";
import { Cable, Plus, Search } from "@/components/ui/icons";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { AdvancedSection } from "../advanced/advanced-section";
import { connectorTypeIndex, drawingGender, type CatalogueLookup, type LookupConnectorType } from "../catalogue-model";
import { AdapterDrawing, type AdapterEndDrawing } from "../drawings/adapter-drawing";
import { genderLetter } from "../drawings/equipment-face";
import { Kv } from "../manage/manage-ui";
import { useCatalogueActions, useListSelection } from "./catalogue-actions";
import { sortBy, toggleIn, useStoredFilters, type SortDir } from "./catalogue-filters";
import {
  ChipChoices,
  ColorMark,
  countLabel,
  DetailActions,
  DetailBody,
  DetailHead,
  DrawingWell,
  FacetButton,
  FilterDialog,
  ListDetail,
  ListRow,
  NewButton,
  PagedList,
  ResetFiltersButton,
  RowTitle,
  SearchField,
  SelectionBar,
  SortControl,
  Toolbar,
  type RowCheckHandlers,
} from "./catalogue-ui";
import type { CatalogueAdapter, CatalogueItems } from "./use-catalogue-items";

type Picker = "function" | "in" | "out" | null;
type AdapterEnd = CatalogueAdapter["inputs"][number];
type SortKey = "name" | "reference" | "function";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Nom" },
  { id: "reference", label: "Référence" },
  { id: "function", label: "Fonction" },
];

const SORT_VALUE: Record<SortKey, (it: CatalogueAdapter) => string | null | undefined> = {
  name: (it) => it.name,
  reference: (it) => it.reference,
  function: (it) => it.function?.label,
};

const DEFAULTS = {
  functions: [] as string[],
  inputs: [] as string[],
  outputs: [] as string[],
  sort: { key: "name" as string, dir: "asc" as string },
};
type Filters = typeof DEFAULTS;

function valid(f: Filters): Filters {
  return {
    ...f,
    sort: {
      key: SORTS.some((o) => o.id === f.sort.key) ? f.sort.key : "name",
      dir: f.sort.dir === "desc" ? "desc" : "asc",
    },
  };
}

/** Nombre de connecteurs d'un côté (quantités comprises, 1 par défaut). */
function countEnds(ends: readonly AdapterEnd[]): number {
  return ends.reduce((a, e) => {
    const q = Number(e.quantity);
    return a + (Number.isFinite(q) && q > 0 ? Math.floor(q) : 1);
  }, 0);
}

function summary(item: CatalogueAdapter): string {
  const nIn = countEnds(item.inputs ?? []);
  const nOut = countEnds(item.outputs ?? []);
  return [item.function?.label, `${nIn} entrée${nIn > 1 ? "s" : ""}`, `${nOut} sortie${nOut > 1 ? "s" : ""}`]
    .filter(Boolean)
    .join(" · ");
}

/** Connecteurs présents d'un côté des adaptateurs (comme arkyo). */
function connectorsOf(
  items: readonly CatalogueAdapter[],
  types: ReadonlyMap<string, LookupConnectorType>,
  side: "inputs" | "outputs",
): { id: string; label: string }[] {
  const ids = new Set<string>();
  for (const it of items) for (const e of it[side] ?? []) if (e.connectorTypeId) ids.add(e.connectorTypeId);
  return [...ids]
    .map((id) => ({ id, label: types.get(id)?.name ?? "—" }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function AdaptersTab({
  list,
  lookup,
  selectedId,
  onSelect,
  canWrite,
}: {
  list: CatalogueItems<CatalogueAdapter>;
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
}) {
  const items = list.items;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [f, setF] = useStoredFilters("adapters", DEFAULTS, valid);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const actions = useCatalogueActions("adapters", { reload: list.refresh, removeLocal: list.removeLocal });

  const types = useMemo(() => connectorTypeIndex(lookup), [lookup]);
  const functions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of items) if (it.function && !seen.has(it.function.id)) seen.set(it.function.id, it.function);
    return [...seen.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [items]);
  const inConnectors = useMemo(() => connectorsOf(items, types, "inputs"), [items, types]);
  const outConnectors = useMemo(() => connectorsOf(items, types, "outputs"), [items, types]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = items.filter((it) => {
      if (q && ![it.name, it.reference ?? "", it.function?.label ?? ""].join(" ").toLowerCase().includes(q)) return false;
      if (f.functions.length && !f.functions.includes(it.function?.id ?? it.functionId ?? "")) return false;
      if (f.inputs.length && !(it.inputs ?? []).some((p) => f.inputs.includes(p.connectorTypeId))) return false;
      if (f.outputs.length && !(it.outputs ?? []).some((p) => f.outputs.includes(p.connectorTypeId))) return false;
      return true;
    });
    return sortBy(out, SORT_VALUE[f.sort.key as SortKey], f.sort.dir as SortDir);
  }, [items, search, f]);

  const filterCount = (f.functions.length ? 1 : 0) + (f.inputs.length ? 1 : 0) + (f.outputs.length ? 1 : 0);
  const reset = () => {
    setSearch("");
    setF((p) => ({ ...DEFAULTS, sort: p.sort }));
  };
  const filterKey = `${search}|${JSON.stringify(f)}`;
  const selected = items.find((it) => it.id === selectedId) ?? filtered[0] ?? null;
  const { selection, checks, bulkDelete, total } = useListSelection(filtered, canWrite, actions);
  const openWizard = () => setWizardOpen(true);
  const close = (o: boolean) => {
    if (!o) setPicker(null);
  };
  const names = (ids: string[], opts: { id: string; label: string }[]) =>
    ids.length ? ids.map((id) => opts.find((o) => o.id === id)?.label ?? "?").join(", ") : null;

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-[var(--muted-foreground)]">Adaptateurs : entrées et sorties.</p>
        {canWrite && <NewButton label="Nouvel adaptateur" onClick={openWizard} />}
      </div>
      <Toolbar count={countLabel(filtered.length, items.length)}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Rechercher dans les adaptateurs"
          placeholder="Nom, référence, fonction…"
        />
        <FacetButton
          label="Fonction"
          value={names(f.functions, functions)}
          onOpen={() => setPicker("function")}
          onClear={() => setF((p) => ({ ...p, functions: [] }))}
        />
        <FacetButton
          label="Connecteur en entrée"
          value={names(f.inputs, inConnectors)}
          onOpen={() => setPicker("in")}
          onClear={() => setF((p) => ({ ...p, inputs: [] }))}
        />
        <FacetButton
          label="Connecteur en sortie"
          value={names(f.outputs, outConnectors)}
          onOpen={() => setPicker("out")}
          onClear={() => setF((p) => ({ ...p, outputs: [] }))}
        />
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
        icon={<Cable strokeWidth={1.5} />}
        title="Aucun adaptateur"
        description="Ajoutez votre premier adaptateur personnel."
        action={
          canWrite ? (
            <EmptyStateAction onClick={openWizard}>
              <Plus className="h-3.5 w-3.5" />
              Créer mon premier adaptateur
            </EmptyStateAction>
          ) : undefined
        }
      />
    );
  } else if (filtered.length === 0) {
    listNode = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun adaptateur pour ces filtres"
        description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
        action={<EmptyStateAction onClick={reset}>Réinitialiser les filtres</EmptyStateAction>}
        className="py-16"
      />
    );
  } else {
    listNode = (
      <PagedList
        label="Adaptateurs"
        items={filtered}
        resetKey={filterKey}
        renderItem={(it) => (
          <AdapterRow
            key={it.id}
            item={it}
            selected={it.id === selected?.id}
            onSelect={onSelect}
            checked={canWrite ? selection.isSelected(it.id) : null}
            onCheck={checks}
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
            <AdapterDetail
              key={selected.id}
              item={selected}
              types={types}
              actions={
                canWrite ? (
                  <DetailActions
                    href={`/admin/catalogue/adapters/${selected.id}`}
                    onDuplicate={() => void actions.duplicate(selected)}
                    onDelete={() => void actions.remove(selected)}
                  />
                ) : null
              }
            />
          ) : (
            <EmptyState icon={<Cable strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
          )
        }
      />

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
          onToggle={(id) => setF((p) => ({ ...p, functions: toggleIn(p.functions, id) }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "in"}
        onOpenChange={close}
        title="Filtrer par connecteur en entrée"
        count={f.inputs.length}
        onClear={() => setF((p) => ({ ...p, inputs: [] }))}
      >
        <ChipChoices
          options={inConnectors}
          selected={f.inputs}
          onToggle={(id) => setF((p) => ({ ...p, inputs: toggleIn(p.inputs, id) }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "out"}
        onOpenChange={close}
        title="Filtrer par connecteur en sortie"
        count={f.outputs.length}
        onClear={() => setF((p) => ({ ...p, outputs: [] }))}
      >
        <ChipChoices
          options={outConnectors}
          selected={f.outputs}
          onToggle={(id) => setF((p) => ({ ...p, outputs: toggleIn(p.outputs, id) }))}
        />
      </FilterDialog>

      <NewAdapterWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/adapters/${id}`);
          else list.refresh();
        }}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/adapters/new");
        }}
      />
    </>
  );
}

const AdapterRow = memo(function AdapterRow({
  item,
  selected,
  onSelect,
  checked,
  onCheck,
}: {
  item: CatalogueAdapter;
  selected: boolean;
  onSelect: (id: string) => void;
  checked: boolean | null;
  onCheck: RowCheckHandlers;
}) {
  return (
    <ListRow
      id={item.id}
      selected={selected}
      onSelect={onSelect}
      check={checked === null ? undefined : { ...onCheck, checked, label: `Sélectionner ${item.name}` }}
    >
      <ColorMark color={item.function?.color} />
      <RowTitle name={item.name} meta={summary(item)} />
      {item.reference ? (
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">{item.reference}</span>
      ) : null}
    </ListRow>
  );
});

function AdapterDetail({
  item,
  types,
  actions,
}: {
  item: CatalogueAdapter;
  types: ReadonlyMap<string, LookupConnectorType>;
  actions?: ReactNode;
}) {
  const toDrawing = (e: AdapterEnd): AdapterEndDrawing => {
    const t = types.get(e.connectorTypeId);
    return { connectorName: t?.name ?? "—", iconId: t?.iconId ?? null, gender: drawingGender(e.gender), quantity: e.quantity };
  };
  const endText = (ends: readonly AdapterEnd[]) =>
    ends.length
      ? ends
          .map((e) => {
            const q = Number(e.quantity);
            const n = `${types.get(e.connectorTypeId)?.name ?? "—"} ${genderLetter(drawingGender(e.gender))}`;
            return q > 1 ? `${n} ×${q}` : n;
          })
          .join(", ")
      : "—";
  const inputs = item.inputs ?? [];
  const outputs = item.outputs ?? [];

  return (
    <>
      <DetailHead
        eyebrow={item.function?.label ? `Adaptateur · ${item.function.label}` : "Adaptateur"}
        title={item.name}
        subtitle={item.reference}
        actions={actions}
      />
      <DetailBody>
        <DrawingWell>
          <AdapterDrawing adapter={{ name: item.name, inputs: inputs.map(toDrawing), outputs: outputs.map(toDrawing) }} />
        </DrawingWell>
        <div role="group" aria-label="Essentiel">
          <Kv
            rows={[
              [
                "Fonction",
                item.function ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ColorMark color={item.function.color} />
                    {item.function.label}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Entrées", endText(inputs)],
              ["Sorties", endText(outputs)],
            ]}
          />
        </div>
        <AdvancedSection kind="catalogue-adapter" summary="Libellés des extrémités, notes">
          <Kv
            rows={[
              ["Libellés", [...inputs, ...outputs].map((e) => e.label).filter(Boolean).join(", ") || "—"],
              ["Notes", item.notes?.trim() ? <span className="whitespace-pre-wrap">{item.notes}</span> : "—"],
            ]}
          />
        </AdvancedSection>
      </DetailBody>
    </>
  );
}
