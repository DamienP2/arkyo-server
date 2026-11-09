"use client";

/**
 * Catalogue › Câbles (Strata v2) : liste filtrable des cordons et fiche en
 * lecture (dessin, essentiel, et le modèle de câble dans « Avancé »).
 *
 * Filtres d'arkyo (`CablesListPanel`) : recherche (nom, référence, marque,
 * modèle, fonction), marque, fonction, connecteurs gauche et droit, cas
 * d'usage. Marque, fonction et connecteurs se choisissent dans les pickers
 * modaux d'arkyo. « Nouveau câble » ouvre l'assistant existant
 * (`NewCableWizard`).
 */

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandPickerModal } from "@/components/catalogue/brand-picker-modal";
import { CONDUCTOR_LABEL, JACKET_LABEL, SHIELDING_LABEL } from "@/components/catalogue/cabling/cabling-card";
import { ConnectorMultiPickerModal } from "@/components/catalogue/connector-multi-picker-modal";
import { FunctionPickerModal } from "@/components/catalogue/function-picker-modal";
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
import {
  ColorMark,
  countLabel,
  DetailBody,
  DetailHead,
  DrawingWell,
  EditLink,
  FacetButton,
  ListDetail,
  ListRow,
  listOrDash,
  NewButton,
  PagedList,
  RowFigure,
  RowTitle,
  SearchField,
  ToggleChip,
  Toolbar,
} from "./catalogue-ui";
import type { CatalogueCable } from "./use-catalogue-items";

type Picker = "brand" | "function" | "left" | "right" | null;
type UseCase = "PRESTATION" | "INSTALLATION";

const USE_CASE_LABEL: Record<string, string> = { PRESTATION: "Prestation", INSTALLATION: "Installation" };

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

export function CablesTab({
  items,
  lookup,
  selectedId,
  onSelect,
  canWrite,
  onCreated,
}: {
  items: readonly CatalogueCable[];
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [functionId, setFunctionId] = useState<string | null>(null);
  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

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
  const connectors = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) {
      if (it.leftConnectorId) ids.add(it.leftConnectorId);
      if (it.rightConnectorId) ids.add(it.rightConnectorId);
    }
    return (lookup?.connectorTypes ?? []).filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, name: t.name, iconId: t.iconId }));
  }, [items, lookup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const l = new Set(left);
    const r = new Set(right);
    return items
      .filter((it) => {
        if (q) {
          const hay = [it.name, it.reference ?? "", it.brand?.name ?? "", it.model ?? "", it.function?.label ?? ""]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (brandId && (it.brand?.id ?? it.brandId) !== brandId) return false;
        if (functionId && (it.function?.id ?? it.functionId) !== functionId) return false;
        if (l.size && !l.has(it.leftConnectorId ?? it.leftConnector?.id ?? "")) return false;
        if (r.size && !r.has(it.rightConnectorId ?? it.rightConnector?.id ?? "")) return false;
        if (useCases.length && !(it.useCases ?? []).some((u) => useCases.includes(u as UseCase))) return false;
        return true;
      })
      .sort(byName);
  }, [items, search, brandId, functionId, left, right, useCases]);

  const filterKey = [search, brandId, functionId, left.join(","), right.join(","), useCases.join(",")].join("|");
  const selected = items.find((it) => it.id === selectedId) ?? filtered[0] ?? null;
  const openWizard = () => setWizardOpen(true);
  const toggleUseCase = (u: UseCase) =>
    setUseCases((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));
  const names = (ids: string[]) => (ids.length ? ids.map((id) => types.get(id)?.name ?? "?").join(", ") : null);

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-[var(--muted-foreground)]">
          Cordons : connecteurs, longueurs et modèle de câble.
        </p>
        {canWrite && <NewButton label="Nouveau câble" onClick={openWizard} />}
      </div>
      <Toolbar count={countLabel(filtered.length, items.length)}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Rechercher dans les câbles"
          placeholder="Nom, référence, marque, modèle…"
        />
        <FacetButton
          label="Fabricant"
          value={brands.find((b) => b.id === brandId)?.name ?? null}
          onOpen={() => setPicker("brand")}
          onClear={() => setBrandId(null)}
        />
        <FacetButton
          label="Fonction"
          value={functions.find((f) => f.id === functionId)?.label ?? null}
          onOpen={() => setPicker("function")}
          onClear={() => setFunctionId(null)}
        />
        <FacetButton label="Connecteur gauche" value={names(left)} onOpen={() => setPicker("left")} onClear={() => setLeft([])} />
        <FacetButton label="Connecteur droit" value={names(right)} onOpen={() => setPicker("right")} onClear={() => setRight([])} />
        <ToggleChip label="Prestation" pressed={useCases.includes("PRESTATION")} onClick={() => toggleUseCase("PRESTATION")} />
        <ToggleChip
          label="Installation"
          pressed={useCases.includes("INSTALLATION")}
          onClick={() => toggleUseCase("INSTALLATION")}
        />
      </Toolbar>
    </>
  );

  let list;
  if (items.length === 0) {
    list = (
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
    list = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun cordon pour ces filtres"
        description="Essayez d'élargir votre recherche ou de retirer des filtres."
        className="py-16"
      />
    );
  } else {
    list = (
      <PagedList
        label="Câbles"
        items={filtered}
        resetKey={filterKey}
        renderItem={(it) => (
          <CableRow key={it.id} item={it} selected={it.id === selected?.id} onSelect={onSelect} types={types} />
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
            <CableDetail key={selected.id} item={selected} types={types} models={models} canWrite={canWrite} />
          ) : (
            <EmptyState icon={<Spline strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
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
        functions={functions.map((f) => ({ id: f.id, label: f.label, color: f.color }))}
        selectedId={functionId}
        onSelect={setFunctionId}
      />
      <ConnectorMultiPickerModal
        open={picker === "left"}
        onOpenChange={(o) => !o && setPicker(null)}
        connectors={connectors}
        selectedIds={left}
        onChange={setLeft}
      />
      <ConnectorMultiPickerModal
        open={picker === "right"}
        onOpenChange={(o) => !o && setPicker(null)}
        connectors={connectors}
        selectedIds={right}
        onChange={setRight}
      />

      <NewCableWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/cables/${id}`);
          else onCreated();
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
  types,
}: {
  item: CatalogueCable;
  selected: boolean;
  onSelect: (id: string) => void;
  types: ReadonlyMap<string, LookupConnectorType>;
}) {
  const ends = `${endLabel(types, item.leftConnectorId, item.leftConnector, item.leftGender)} / ${endLabel(
    types,
    item.rightConnectorId,
    item.rightConnector,
    item.rightGender,
  )}`;
  return (
    <ListRow id={item.id} selected={selected} onSelect={onSelect}>
      <ColorMark color={item.function?.color} />
      <RowTitle name={item.name} meta={item.reference} />
      <span className="hidden w-[150px] shrink-0 truncate text-[12px] text-[var(--muted-foreground)] md:inline">
        {item.function?.label ?? "—"}
      </span>
      <RowFigure className="w-[150px] truncate text-right">{ends}</RowFigure>
    </ListRow>
  );
});

function CableDetail({
  item,
  types,
  models,
  canWrite,
}: {
  item: CatalogueCable;
  types: ReadonlyMap<string, LookupConnectorType>;
  models: ReadonlyMap<string, LookupCableModel>;
  canWrite: boolean;
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
        eyebrow={item.function?.label ? `Câble · ${item.function.label}` : "Câble"}
        title={item.name}
        subtitle={[brandModel || null, item.reference].filter(Boolean).join(" · ") || null}
        actions={canWrite ? <EditLink href={`/admin/catalogue/cables/${item.id}`} /> : null}
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
              [
                "Connecteurs",
                `${endLabel(types, item.leftConnectorId, item.leftConnector, item.leftGender)} / ${endLabel(
                  types,
                  item.rightConnectorId,
                  item.rightConnector,
                  item.rightGender,
                )}`,
              ],
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
