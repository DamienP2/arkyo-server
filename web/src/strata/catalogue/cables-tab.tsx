"use client";

/**
 * Catalogue › Cordons (Strata v2) : liste filtrable des cordons et fiche en
 * lecture (dessin, essentiel, et le modèle de câble dans « Avancé »). Le mot
 * est celui d'arkyo pour cette liste (onglet « Cordons », « Nouveau cordon »).
 *
 * Fonctions du panneau d'arkyo (`CablesListPanel`), toutes présentes :
 *   - recherche (nom, référence, marque, modèle, fonction) ;
 *   - filtres à choix multiples : marque (`BrandMultiSelect`), fonction,
 *     connecteur gauche, connecteur droit (pastilles `Chip`), dans des
 *     fenêtres modales aux mots d'un filtre ; cas d'usage ; « Réinitialiser
 *     les filtres » ; filtres et tri mémorisés
 *     (`strata-catalogue-filters:cables`) ;
 *   - tri : nom, référence, marque, fonction, croissant ou décroissant ;
 *   - sélection multiple et suppression en lot ; Dupliquer et Supprimer
 *     dans la fiche ; « Nouveau cordon » ouvre l'assistant existant.
 */

import { memo, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BrandMultiSelect } from "@/app/(app)/admin/_components/list-toolbar-helpers";
import { CONDUCTOR_LABEL, JACKET_LABEL, SHIELDING_LABEL } from "@/components/catalogue/cabling/cabling-card";
import { NewCableWizard } from "@/components/cables/new-cable-wizard";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { Plus, Search, Spline } from "@/components/ui/icons";
import { AdvancedSection } from "../advanced/advanced-section";
import {
  connectorTypeIndex,
  drawingGender,
  fmtNumber,
  type CatalogueLookup,
  type LookupCableModel,
  type LookupConnectorType,
} from "../catalogue-model";
import { CableDrawing } from "../drawings/cable-drawing";
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
  listOrDash,
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
  type RowCheckHandlers,
} from "./catalogue-ui";
import type { CatalogueCable, CatalogueItems } from "./use-catalogue-items";

type Picker = "brand" | "function" | "left" | "right" | null;
type UseCase = "PRESTATION" | "INSTALLATION";
type SortKey = "name" | "reference" | "brand" | "function";

const USE_CASE_LABEL: Record<string, string> = { PRESTATION: "Prestation", INSTALLATION: "Installation" };

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Nom" },
  { id: "reference", label: "Référence" },
  { id: "brand", label: "Marque" },
  { id: "function", label: "Fonction" },
];

const SORT_VALUE: Record<SortKey, (it: CatalogueCable) => string | null | undefined> = {
  name: (it) => it.name,
  reference: (it) => it.reference,
  brand: (it) => it.brand?.name,
  function: (it) => it.function?.label,
};

const DEFAULTS = {
  brands: [] as string[],
  functions: [] as string[],
  left: [] as string[],
  right: [] as string[],
  useCases: [] as string[],
  sort: { key: "name" as string, dir: "asc" as string },
};
type Filters = typeof DEFAULTS;

function valid(f: Filters): Filters {
  return {
    ...f,
    useCases: f.useCases.filter((u) => u === "PRESTATION" || u === "INSTALLATION"),
    sort: {
      key: SORTS.some((o) => o.id === f.sort.key) ? f.sort.key : "name",
      dir: f.sort.dir === "desc" ? "desc" : "asc",
    },
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr");
const label = (labels: Record<string, string>, v: string | null | undefined) => (v ? (labels[v] ?? v) : null);

/** « BNC M » : connecteur et genre d'une extrémité. */
function endLabel(
  types: ReadonlyMap<string, LookupConnectorType>,
  id: string | null | undefined,
  ref: { name: string } | null | undefined,
  gender: string | null | undefined,
): string {
  const name = (id ? types.get(id)?.name : undefined) ?? ref?.name ?? "—";
  return `${name} ${genderLetter(drawingGender(gender))}`;
}

const endsLabel = (types: ReadonlyMap<string, LookupConnectorType>, it: CatalogueCable) =>
  `${endLabel(types, it.leftConnectorId, it.leftConnector, it.leftGender)} / ${endLabel(
    types,
    it.rightConnectorId,
    it.rightConnector,
    it.rightGender,
  )}`;

/** Connecteurs présents d'un côté des cordons (comme arkyo). */
function connectorsOf(
  items: readonly CatalogueCable[],
  types: ReadonlyMap<string, LookupConnectorType>,
  side: "left" | "right",
): { id: string; label: string; color?: string | null }[] {
  const seen = new Map<string, { id: string; label: string; color?: string | null }>();
  for (const it of items) {
    const ref = side === "left" ? it.leftConnector : it.rightConnector;
    const id = (side === "left" ? it.leftConnectorId : it.rightConnectorId) ?? ref?.id;
    if (id && !seen.has(id)) seen.set(id, { id, label: types.get(id)?.name ?? ref?.name ?? "—", color: ref?.color });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function CablesTab({
  list,
  lookup,
  selectedId,
  onSelect,
  canWrite,
}: {
  list: CatalogueItems<CatalogueCable>;
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
}) {
  const items = list.items;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [f, setF] = useStoredFilters("cables", DEFAULTS, valid);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const actions = useCatalogueActions("cables", { reload: list.refresh, removeLocal: list.removeLocal });

  const types = useMemo(() => connectorTypeIndex(lookup), [lookup]);
  const models = useMemo(() => new Map((lookup?.cableModels ?? []).map((m) => [m.id, m])), [lookup]);

  const brands = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const it of items) if (it.brand?.id && it.brand.name) seen.set(it.brand.id, it.brand);
    return [...seen.values()].sort(byName);
  }, [items]);
  const functions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of items) if (it.function && !seen.has(it.function.id)) seen.set(it.function.id, it.function);
    return [...seen.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [items]);
  const leftConnectors = useMemo(() => connectorsOf(items, types, "left"), [items, types]);
  const rightConnectors = useMemo(() => connectorsOf(items, types, "right"), [items, types]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = items.filter((it) => {
      if (q) {
        const hay = [it.name, it.reference ?? "", it.brand?.name ?? "", it.model ?? "", it.function?.label ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (f.brands.length && !(it.brand?.name && f.brands.includes(it.brand.name))) return false;
      if (f.functions.length && !f.functions.includes(it.function?.id ?? it.functionId ?? "")) return false;
      if (f.left.length && !f.left.includes(it.leftConnectorId ?? it.leftConnector?.id ?? "")) return false;
      if (f.right.length && !f.right.includes(it.rightConnectorId ?? it.rightConnector?.id ?? "")) return false;
      if (f.useCases.length && !(it.useCases ?? []).some((u) => f.useCases.includes(u))) return false;
      return true;
    });
    return sortBy(out, SORT_VALUE[f.sort.key as SortKey], f.sort.dir as SortDir);
  }, [items, search, f]);

  const filterCount =
    (f.brands.length ? 1 : 0) +
    (f.functions.length ? 1 : 0) +
    (f.left.length ? 1 : 0) +
    (f.right.length ? 1 : 0) +
    (f.useCases.length ? 1 : 0);
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
  const toggleUseCase = (u: UseCase) => setF((p) => ({ ...p, useCases: toggleIn(p.useCases, u) }));
  const names = (ids: string[], opts: { id: string; label: string }[]) =>
    ids.length ? ids.map((id) => opts.find((o) => o.id === id)?.label ?? "?").join(", ") : null;

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-[var(--muted-foreground)]">
          Cordons : connecteurs, longueurs et modèle de câble.
        </p>
        {canWrite && <NewButton label="Nouveau cordon" onClick={openWizard} />}
      </div>
      <Toolbar count={countLabel(filtered.length, items.length)}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Rechercher dans les cordons"
          placeholder="Nom, référence, marque, modèle…"
        />
        <FacetButton
          label="Fabricant"
          value={f.brands.length ? f.brands.join(", ") : null}
          onOpen={() => setPicker("brand")}
          onClear={() => setF((p) => ({ ...p, brands: [] }))}
        />
        <FacetButton
          label="Fonction"
          value={names(f.functions, functions)}
          onOpen={() => setPicker("function")}
          onClear={() => setF((p) => ({ ...p, functions: [] }))}
        />
        <FacetButton
          label="Connecteur gauche"
          value={names(f.left, leftConnectors)}
          onOpen={() => setPicker("left")}
          onClear={() => setF((p) => ({ ...p, left: [] }))}
        />
        <FacetButton
          label="Connecteur droit"
          value={names(f.right, rightConnectors)}
          onOpen={() => setPicker("right")}
          onClear={() => setF((p) => ({ ...p, right: [] }))}
        />
        <ToggleChip label="Prestation" pressed={f.useCases.includes("PRESTATION")} onClick={() => toggleUseCase("PRESTATION")} />
        <ToggleChip
          label="Installation"
          pressed={f.useCases.includes("INSTALLATION")}
          onClick={() => toggleUseCase("INSTALLATION")}
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
        icon={<Spline strokeWidth={1.5} />}
        title="Aucun cordon"
        description="Ajoutez votre premier cordon personnel."
        action={
          canWrite ? (
            <EmptyStateAction onClick={openWizard}>
              <Plus className="h-3.5 w-3.5" />
              Créer mon premier cordon
            </EmptyStateAction>
          ) : undefined
        }
      />
    );
  } else if (filtered.length === 0) {
    listNode = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun cordon pour ces filtres"
        description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
        action={<EmptyStateAction onClick={reset}>Réinitialiser les filtres</EmptyStateAction>}
        className="py-16"
      />
    );
  } else {
    listNode = (
      <PagedList
        label="Cordons"
        items={filtered}
        resetKey={filterKey}
        renderItem={(it) => (
          <CableRow
            key={it.id}
            item={it}
            selected={it.id === selected?.id}
            onSelect={onSelect}
            checked={canWrite ? selection.isSelected(it.id) : null}
            onCheck={checks}
            types={types}
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
            <CableDetail
              key={selected.id}
              item={selected}
              types={types}
              models={models}
              actions={
                canWrite ? (
                  <DetailActions
                    href={`/admin/catalogue/cables/${selected.id}`}
                    onDuplicate={() => void actions.duplicate(selected)}
                    onDelete={() => void actions.remove(selected)}
                  />
                ) : null
              }
            />
          ) : (
            <EmptyState icon={<Spline strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
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
          onToggle={(id) => setF((p) => ({ ...p, functions: toggleIn(p.functions, id) }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "left"}
        onOpenChange={close}
        title="Filtrer par connecteur gauche"
        count={f.left.length}
        onClear={() => setF((p) => ({ ...p, left: [] }))}
      >
        <ChipChoices
          options={leftConnectors}
          selected={f.left}
          onToggle={(id) => setF((p) => ({ ...p, left: toggleIn(p.left, id) }))}
        />
      </FilterDialog>
      <FilterDialog
        open={picker === "right"}
        onOpenChange={close}
        title="Filtrer par connecteur droit"
        count={f.right.length}
        onClear={() => setF((p) => ({ ...p, right: [] }))}
      >
        <ChipChoices
          options={rightConnectors}
          selected={f.right}
          onToggle={(id) => setF((p) => ({ ...p, right: toggleIn(p.right, id) }))}
        />
      </FilterDialog>

      <NewCableWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/cables/${id}`);
          else list.refresh();
        }}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/cables/new");
        }}
      />
    </>
  );
}

const CableRow = memo(function CableRow({
  item,
  selected,
  onSelect,
  checked,
  onCheck,
  types,
}: {
  item: CatalogueCable;
  selected: boolean;
  onSelect: (id: string) => void;
  checked: boolean | null;
  onCheck: RowCheckHandlers;
  types: ReadonlyMap<string, LookupConnectorType>;
}) {
  return (
    <ListRow
      id={item.id}
      selected={selected}
      onSelect={onSelect}
      check={checked === null ? undefined : { ...onCheck, checked, label: `Sélectionner ${item.name}` }}
    >
      <ColorMark color={item.function?.color} />
      <RowTitle name={item.name} meta={item.reference} />
      <span className="hidden w-[150px] shrink-0 truncate text-[12px] text-[var(--muted-foreground)] md:inline">
        {item.function?.label ?? "—"}
      </span>
      <RowFigure className="w-[150px] truncate text-right">{endsLabel(types, item)}</RowFigure>
    </ListRow>
  );
});

function CableDetail({
  item,
  types,
  models,
  actions,
}: {
  item: CatalogueCable;
  types: ReadonlyMap<string, LookupConnectorType>;
  models: ReadonlyMap<string, LookupCableModel>;
  actions?: ReactNode;
}) {
  const model = item.cableModelId ? models.get(item.cableModelId) : undefined;
  const end = (id: string | null | undefined, ref: { name: string } | null | undefined, g: string | null | undefined) => {
    const t = id ? types.get(id) : undefined;
    return { connectorName: t?.name ?? ref?.name ?? "—", iconId: t?.iconId ?? null, gender: drawingGender(g) };
  };
  const lengths = item.availableLengths ?? [];
  const custom = item.customMinLength != null || item.customMaxLength != null;
  const brandModel = [item.brand?.name, item.model].filter(Boolean).join(" ");
  const modelName = model ? [model.brandName, model.name].filter(Boolean).join(" ") : null;

  return (
    <>
      <DetailHead
        eyebrow={item.function?.label ? `Cordon · ${item.function.label}` : "Cordon"}
        title={item.name}
        subtitle={[brandModel || null, item.reference].filter(Boolean).join(" · ") || null}
        actions={actions}
      />
      <DetailBody>
        <DrawingWell>
          <CableDrawing
            cable={{
              name: item.name,
              left: end(item.leftConnectorId, item.leftConnector, item.leftGender),
              right: end(item.rightConnectorId, item.rightConnector, item.rightGender),
              color: item.function?.color ?? null,
            }}
          />
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
              ["Connecteurs", endsLabel(types, item)],
              ["Usage", listOrDash((item.useCases ?? []).map((u) => USE_CASE_LABEL[u] ?? u))],
              ["Longueurs", lengths.length ? `${lengths.map((l) => fmtNumber(l)).join(" m · ")} m` : "—"],
              [
                "Sur mesure",
                custom
                  ? `${fmtNumber(item.customMinLength ?? 0)} à ${item.customMaxLength != null ? fmtNumber(item.customMaxLength) : "∞"} m`
                  : "—",
              ],
            ]}
          />
        </div>
        <AdvancedSection
          kind="catalogue-cable"
          summary="Modèle de câble, impédance, bande passante, diamètre, conducteur, blindage, gaine, notes"
        >
          <Kv
            rows={[
              ["Modèle", modelName ?? (brandModel || "—")],
              ["Impédance", model?.impedance != null ? `${fmtNumber(model.impedance)} Ω` : "—"],
              ["Bande passante", model?.bandwidthMHz != null ? `${fmtNumber(model.bandwidthMHz)} MHz` : "—"],
              ["Diamètre", model?.diameterMm != null ? `${fmtNumber(model.diameterMm)} mm` : "—"],
              ["Conducteur", label(CONDUCTOR_LABEL, model?.conductor) ?? "—"],
              ["Blindage", label(SHIELDING_LABEL, model?.shielding) ?? "—"],
              ["Gaine", label(JACKET_LABEL, model?.jacketMaterial) ?? "—"],
              ["Classement feu", model?.fireRating ?? "—"],
              ["Notes", item.notes?.trim() ? <span className="whitespace-pre-wrap">{item.notes}</span> : "—"],
            ]}
          />
        </AdvancedSection>
      </DetailBody>
    </>
  );
}
