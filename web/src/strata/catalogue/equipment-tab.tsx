"use client";

/**
 * Catalogue › Équipements (Strata v2) : liste filtrable et fiche en lecture.
 *
 * Filtres d'arkyo (`EquipmentListPanel`), filtrés côté client : recherche
 * (nom, référence, marque, catégorie, fonctions), marque, fonction, type
 * (avec ses sous-types), format (rackable / pose libre), options ST 2110 et
 * Lumière ; plus la phase (maquette). Marque, fonction, type et phase se
 * choisissent dans les pickers modaux d'arkyo, jamais dans un `<select>`.
 * « Nouvel équipement » ouvre l'assistant existant (`NewEquipmentWizard`).
 */

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandPickerModal } from "@/components/catalogue/brand-picker-modal";
import { FunctionPickerModal } from "@/components/catalogue/function-picker-modal";
import { PhasePickerModal } from "@/components/catalogue/phase-picker-modal";
import { TypePickerModal, type TypePickerType } from "@/components/catalogue/type-picker-modal";
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
import {
  ChoiceGroup,
  countLabel,
  FacetButton,
  FaceWell,
  ListDetail,
  ListRow,
  NewButton,
  PagedList,
  RowFigure,
  RowTitle,
  SearchField,
  ToggleChip,
  Toolbar,
} from "./catalogue-ui";
import { EquipmentDetail, phaseIdsOf } from "./equipment-detail";
import type { CatalogueEquipment } from "./use-catalogue-items";

type Format = "all" | "rack" | "libre";
type Picker = "brand" | "function" | "type" | "phase" | null;

const FORMATS: { id: Format; label: string }[] = [
  { id: "all", label: "Tous les formats" },
  { id: "rack", label: "Rackable" },
  { id: "libre", label: "Pose libre" },
];

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr");

export function EquipmentTab({
  items,
  lookup,
  selectedId,
  onSelect,
  canWrite,
  onCreated,
}: {
  items: readonly CatalogueEquipment[];
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  /** Fiche créée par l'assistant (« Fermer ») : relire la liste. */
  onCreated: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [functionId, setFunctionId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [phaseIds, setPhaseIds] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>("all");
  const [only2110, setOnly2110] = useState(false);
  const [onlyLighting, setOnlyLighting] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Référentiels des pickers : ceux présents dans la liste (comme arkyo).
  const brands = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; logoUrl?: string | null }>();
    for (const it of items) if (it.brand?.id && it.brand.name) seen.set(it.brand.id, it.brand);
    return [...seen.values()].sort(byName);
  }, [items]);
  const functions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of items) for (const f of it.functions ?? []) if (!seen.has(f.id)) seen.set(f.id, f);
    return [...seen.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [items]);
  const fnKey = useMemo(() => new Map((lookup?.functions ?? []).map((f) => [f.id, f.key ?? undefined])), [lookup]);
  const typeById = useMemo(() => new Map((lookup?.types ?? []).map((t) => [t.id, t])), [lookup]);
  const types = useMemo<TypePickerType[]>(() => {
    const used = new Set<string>();
    for (const it of items) {
      const t = it.typeId ? typeById.get(it.typeId) : undefined;
      if (!t) continue;
      used.add(t.id);
      if (t.parentId) used.add(t.parentId);
    }
    const fnOf = new Map((lookup?.functions ?? []).map((f) => [f.id, f]));
    return (lookup?.types ?? [])
      .filter((t) => used.has(t.id))
      .map((t) => {
        const f = fnOf.get(t.functionId);
        return { ...t, function: f ? { label: f.label, color: f.color ?? "var(--text-tertiary)" } : undefined };
      });
  }, [items, lookup, typeById]);
  const phases = useMemo(() => (lookup?.phases ?? []).map((p) => ({ ...p, key: p.key ?? undefined, color: p.color ?? undefined })), [lookup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const phaseSet = new Set(phaseIds);
    return items
      .filter((it) => {
        if (q) {
          const hay = [
            it.name,
            it.reference ?? "",
            it.brand?.name ?? "",
            it.category ?? "",
            it.type?.name ?? "",
            ...(it.functions ?? []).map((f) => f.label),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (brandId && (it.brand?.id ?? it.brandId) !== brandId) return false;
        if (functionId && !(it.functions ?? []).some((f) => f.id === functionId)) return false;
        if (typeId) {
          const t = it.typeId ? typeById.get(it.typeId) : undefined;
          if (it.typeId !== typeId && t?.parentId !== typeId) return false;
        }
        if (phaseSet.size && !phaseIdsOf(it).some((id) => phaseSet.has(id))) return false;
        if (format === "rack" && it.isRackable === false) return false;
        if (format === "libre" && it.isRackable !== false) return false;
        if (only2110 && !it.is2110) return false;
        if (onlyLighting && it.isLightingFixture !== true) return false;
        return true;
      })
      .sort(byName);
  }, [items, search, brandId, functionId, typeId, typeById, phaseIds, format, only2110, onlyLighting]);

  const filterKey = [search, brandId, functionId, typeId, phaseIds.join(","), format, only2110, onlyLighting].join("|");
  const selected = items.find((it) => it.id === selectedId) ?? filtered[0] ?? null;

  // Dessins des lignes : référentiels calculés une fois.
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);

  const openWizard = () => setWizardOpen(true);
  const brandName = brands.find((b) => b.id === brandId)?.name ?? null;
  const functionLabel = functions.find((f) => f.id === functionId)?.label ?? null;
  const typeName = typeId ? (typeById.get(typeId)?.name ?? null) : null;
  const phaseLabel = phaseIds.length
    ? phaseIds.map((id) => phases.find((p) => p.id === id)?.label ?? "?").join(", ")
    : null;

  const head = (
    <div className="flex flex-wrap items-center gap-2">
      <p className="m-0 flex-1 text-[12.5px] text-[var(--muted-foreground)]">
        Fiches d'équipement avec leur connectique par face.
      </p>
      {canWrite && <NewButton label="Nouvel équipement" onClick={openWizard} />}
    </div>
  );

  const toolbar = (
    <>
      {head}
      <Toolbar count={countLabel(filtered.length, items.length)}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Rechercher dans les équipements"
          placeholder="Nom, référence, marque, catégorie…"
        />
        <FacetButton label="Fabricant" value={brandName} onOpen={() => setPicker("brand")} onClear={() => setBrandId(null)} />
        <FacetButton
          label="Fonction"
          value={functionLabel}
          onOpen={() => setPicker("function")}
          onClear={() => setFunctionId(null)}
        />
        <FacetButton label="Type" value={typeName} onOpen={() => setPicker("type")} onClear={() => setTypeId(null)} />
        <FacetButton label="Phase" value={phaseLabel} onOpen={() => setPicker("phase")} onClear={() => setPhaseIds([])} />
        <ChoiceGroup label="Format" options={FORMATS} value={format} onChange={setFormat} />
        <ToggleChip label="ST 2110" pressed={only2110} onClick={() => setOnly2110((v) => !v)} />
        <ToggleChip label="Lumière" pressed={onlyLighting} onClick={() => setOnlyLighting((v) => !v)} />
      </Toolbar>
    </>
  );

  let list;
  if (items.length === 0) {
    list = (
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
    list = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun équipement pour ces filtres"
        description="Essayez d'élargir votre recherche ou de retirer des filtres."
        className="py-16"
      />
    );
  } else {
    list = (
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
        list={list}
        detail={
          selected ? (
            <EquipmentDetail key={selected.id} item={selected} lookup={lookup} canWrite={canWrite} />
          ) : (
            <EmptyState icon={<Package strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
          )
        }
      />

      <BrandPickerModal
        open={picker === "brand"}
        onOpenChange={(o) => !o && setPicker(null)}
        brands={brands}
        selectedId={brandId}
        onSelect={setBrandId}
      />
      <FunctionPickerModal
        open={picker === "function"}
        onOpenChange={(o) => !o && setPicker(null)}
        functions={functions.map((f) => ({ id: f.id, label: f.label, color: f.color, key: fnKey.get(f.id) }))}
        selectedId={functionId}
        onSelect={(id) => {
          setFunctionId(id);
          // Le type suit la fonction (hiérarchie d'arkyo : Fonction → Type).
          if (id && typeId && typeById.get(typeId)?.functionId !== id) setTypeId(null);
        }}
      />
      <TypePickerModal
        open={picker === "type"}
        onOpenChange={(o) => !o && setPicker(null)}
        types={types}
        functionFilterId={functionId}
        selectedId={typeId}
        onSelect={setTypeId}
      />
      <PhasePickerModal
        open={picker === "phase"}
        onOpenChange={(o) => !o && setPicker(null)}
        phases={phases}
        selectedIds={phaseIds}
        onChange={setPhaseIds}
      />

      <NewEquipmentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/equipment/${id}`);
          else onCreated();
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
  connectorTypes,
  signals,
}: {
  item: CatalogueEquipment;
  selected: boolean;
  onSelect: (id: string) => void;
  connectorTypes: readonly DrawingConnectorType[];
  signals: readonly DrawingSignal[];
}) {
  const connectors = useMemo(() => parseConnectors(item.connectors), [item.connectors]);
  const rackable = item.isRackable !== false;
  const ports = totalPorts(connectors);
  const meta = [item.brand?.name, item.functions?.[0]?.label ?? item.type?.name].filter(Boolean).join(" · ");
  return (
    <ListRow id={item.id} selected={selected} onSelect={onSelect}>
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
