"use client";

/**
 * Catalogue › Adaptateurs (Strata v2) : liste filtrable et fiche en lecture
 * (dessin entrées → sorties, essentiel, notes dans « Avancé »).
 *
 * Filtres d'arkyo (`AdaptersListPanel`) : recherche (nom, référence,
 * fonction), fonction, connecteur en entrée, connecteur en sortie, par les
 * pickers modaux d'arkyo. « Nouvel adaptateur » ouvre l'assistant existant
 * (`NewAdapterWizard`).
 */

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectorMultiPickerModal } from "@/components/catalogue/connector-multi-picker-modal";
import { FunctionPickerModal } from "@/components/catalogue/function-picker-modal";
import { NewAdapterWizard } from "@/components/adapters/new-adapter-wizard";
import { Cable, Plus, Search } from "@/components/ui/icons";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { AdvancedSection } from "../advanced/advanced-section";
import { connectorTypeIndex, drawingGender, type CatalogueLookup, type LookupConnectorType } from "../catalogue-model";
import { AdapterDrawing, type AdapterEndDrawing } from "../drawings/adapter-drawing";
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
  NewButton,
  PagedList,
  RowTitle,
  SearchField,
  Toolbar,
} from "./catalogue-ui";
import type { CatalogueAdapter } from "./use-catalogue-items";

type Picker = "function" | "in" | "out" | null;
type AdapterEnd = CatalogueAdapter["inputs"][number];

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr");

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

export function AdaptersTab({
  items,
  lookup,
  selectedId,
  onSelect,
  canWrite,
  onCreated,
}: {
  items: readonly CatalogueAdapter[];
  lookup: CatalogueLookup | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [functionId, setFunctionId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const types = useMemo(() => connectorTypeIndex(lookup), [lookup]);
  const functions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of items) if (it.function && !seen.has(it.function.id)) seen.set(it.function.id, it.function);
    return [...seen.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [items]);
  const connectors = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) for (const e of [...(it.inputs ?? []), ...(it.outputs ?? [])]) ids.add(e.connectorTypeId);
    return (lookup?.connectorTypes ?? []).filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, name: t.name, iconId: t.iconId }));
  }, [items, lookup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ins = new Set(inputs);
    const outs = new Set(outputs);
    return items
      .filter((it) => {
        if (q && ![it.name, it.reference ?? "", it.function?.label ?? ""].join(" ").toLowerCase().includes(q)) return false;
        if (functionId && (it.function?.id ?? it.functionId) !== functionId) return false;
        if (ins.size && !(it.inputs ?? []).some((p) => ins.has(p.connectorTypeId))) return false;
        if (outs.size && !(it.outputs ?? []).some((p) => outs.has(p.connectorTypeId))) return false;
        return true;
      })
      .sort(byName);
  }, [items, search, functionId, inputs, outputs]);

  const filterKey = [search, functionId, inputs.join(","), outputs.join(",")].join("|");
  const selected = items.find((it) => it.id === selectedId) ?? filtered[0] ?? null;
  const openWizard = () => setWizardOpen(true);
  const names = (ids: string[]) => (ids.length ? ids.map((id) => types.get(id)?.name ?? "?").join(", ") : null);

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
          value={functions.find((f) => f.id === functionId)?.label ?? null}
          onOpen={() => setPicker("function")}
          onClear={() => setFunctionId(null)}
        />
        <FacetButton
          label="Connecteur en entrée"
          value={names(inputs)}
          onOpen={() => setPicker("in")}
          onClear={() => setInputs([])}
        />
        <FacetButton
          label="Connecteur en sortie"
          value={names(outputs)}
          onOpen={() => setPicker("out")}
          onClear={() => setOutputs([])}
        />
      </Toolbar>
    </>
  );

  let list;
  if (items.length === 0) {
    list = (
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
    list = (
      <EmptyState
        icon={<Search strokeWidth={1.5} />}
        title="Aucun adaptateur pour ces filtres"
        description="Essayez d'élargir votre recherche ou de retirer des filtres."
        className="py-16"
      />
    );
  } else {
    list = (
      <PagedList
        label="Adaptateurs"
        items={filtered}
        resetKey={filterKey}
        renderItem={(it) => <AdapterRow key={it.id} item={it} selected={it.id === selected?.id} onSelect={onSelect} />}
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
            <AdapterDetail key={selected.id} item={selected} types={types} canWrite={canWrite} />
          ) : (
            <EmptyState icon={<Cable strokeWidth={1.5} />} title="Aucune fiche sélectionnée" className="py-16" />
          )
        }
      />

      <FunctionPickerModal
        open={picker === "function"}
        onOpenChange={(o) => !o && setPicker(null)}
        functions={functions.map((f) => ({ id: f.id, label: f.label, color: f.color }))}
        selectedId={functionId}
        onSelect={setFunctionId}
      />
      <ConnectorMultiPickerModal
        open={picker === "in"}
        onOpenChange={(o) => !o && setPicker(null)}
        connectors={connectors}
        selectedIds={inputs}
        onChange={setInputs}
      />
      <ConnectorMultiPickerModal
        open={picker === "out"}
        onOpenChange={(o) => !o && setPicker(null)}
        connectors={connectors}
        selectedIds={outputs}
        onChange={setOutputs}
      />

      <NewAdapterWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id, mode) => {
          if (mode === "complete") router.push(`/admin/catalogue/adapters/${id}`);
          else onCreated();
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
}: {
  item: CatalogueAdapter;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ListRow id={item.id} selected={selected} onSelect={onSelect}>
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
  canWrite,
}: {
  item: CatalogueAdapter;
  types: ReadonlyMap<string, LookupConnectorType>;
  canWrite: boolean;
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
        actions={canWrite ? <EditLink href={`/admin/catalogue/adapters/${item.id}`} /> : null}
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
