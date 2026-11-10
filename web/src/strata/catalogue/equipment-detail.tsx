"use client";

/**
 * Fiche d'un équipement du catalogue, en lecture (Strata v2, maquette
 * `catFiche`) : faces avant / arrière, schéma de principe, ports (genres
 * `M` / `F` / `N`), essentiel, puis les champs rares dans « Avancé »
 * (dimensions, profondeur, poids, BTU/h, double alimentation, ST 2110,
 * capacités IP, DMX, modularité, phases, étiquettes, champs personnalisés,
 * documents, notes). Tout vient de la ligne de la liste
 * (`GET /api/tenant/catalogue/equipment`) : aucune lecture de plus.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { WF_OPTIONS } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { cn } from "@/lib/utils";
import { AdvancedSection } from "../advanced/advanced-section";
import { safeDocumentHref } from "../safe-href";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  fullestFace,
  parseConnectors,
  totalPorts,
  type CatalogueLookup,
} from "../catalogue-model";
import { BlockDiagram } from "../drawings/block-diagram";
import { EquipmentFace, genderLetter } from "../drawings/equipment-face";
import { entryLabel, portCount, type FaceSide } from "../drawings/face-layout";
import { FaceToggle } from "../inspector/equipment-face-card";
import { Kv } from "../manage/manage-ui";
import {
  ColorMark,
  DetailBody,
  DetailHead,
  DetailSection,
  DrawingWell,
  FaceWell,
  FamilyBar,
  listOrDash,
  yesNo,
} from "./catalogue-ui";
import type { CatalogueEquipment } from "./use-catalogue-items";

const FACE_LABEL: Record<ConnectorEntry["face"], string> = {
  FRONT: "avant",
  REAR: "arrière",
  LEFT: "gauche",
  RIGHT: "droite",
  TOP: "dessus",
  BOTTOM: "dessous",
};

const DIRECTION: Record<ConnectorEntry["direction"], string> = { IN: "Entrée", OUT: "Sortie", BOTH: "E/S" };

const IP2110: Record<string, string> = { OOB: "Oui, hors bande (OOB)", IB: "Oui, dans la bande (IB)" };

/** Tableau JSON (déjà analysé, ou texte JSON) ; `[]` sinon. */
export function jsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

const record = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Identifiants de phases de la ligne (`phaseIds`). */
export function phaseIdsOf(item: CatalogueEquipment): string[] {
  return jsonArray(item.phaseIds).filter((x): x is string => typeof x === "string");
}

function customFieldValue(f: Record<string, unknown>): string {
  const v = f.value;
  if (typeof v === "boolean") return yesNo(v);
  if (typeof v === "number") {
    const unit = str(record(f.config)?.unit);
    return unit ? `${fmtNumber(v)} ${unit}` : fmtNumber(v);
  }
  return str(v) || "—";
}

const mm = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? `${fmtNumber(n)} mm` : "—");

export function EquipmentDetail({
  item,
  lookup,
  actions,
}: {
  item: CatalogueEquipment;
  lookup: CatalogueLookup | null;
  /** Modifier, Dupliquer, Supprimer (écriture seulement). */
  actions?: ReactNode;
}) {
  const connectors = useMemo(() => parseConnectors(item.connectors), [item.connectors]);
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);
  const typeName = useMemo(() => new Map(connectorTypes.map((t) => [t.id, t.name])), [connectorTypes]);
  const signalColor = useMemo(() => new Map(signals.map((s) => [s.name, s.color])), [signals]);
  // Une autre fiche repart de sa face la plus garnie.
  const [faceOf, setFaceOf] = useState<{ id: string; face: FaceSide } | null>(null);
  const face = faceOf?.id === item.id ? faceOf.face : fullestFace(connectors);
  const [hoverEntry, setHoverEntry] = useState<number | null>(null);

  const rackable = item.isRackable !== false;
  const fns = item.functions ?? [];
  const brand = item.brand?.name ?? null;
  const ports = totalPorts(connectors);
  const dims = [item.dimLmm, item.dimWmm, item.dimHmm].filter((d): d is number => typeof d === "number" && d > 0);
  const faceEquipment = {
    name: item.name,
    brand,
    heightU: item.heightU,
    isRackable: rackable,
    dims: dims.length ? dims : null,
    connectors,
  };

  return (
    <>
      <DetailHead
        eyebrow={[fns[0]?.label, item.type?.name].filter(Boolean).join(" · ") || "Équipement"}
        title={item.name}
        subtitle={[brand, item.reference].filter(Boolean).join(" · ") || null}
        actions={actions}
      />
      <DetailBody>
        <DetailSection
          label="Faces"
          aside={connectors.length ? <FaceToggle value={face} onChange={(f) => setFaceOf({ id: item.id, face: f })} /> : null}
        >
          {connectors.length ? (
            <FaceWell>
              <EquipmentFace
                equipment={faceEquipment}
                face={face}
                connectorTypes={connectorTypes}
                signals={signals}
                hoverEntry={hoverEntry}
                onEntryHover={setHoverEntry}
              />
            </FaceWell>
          ) : (
            <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">Aucune connectique.</p>
          )}
        </DetailSection>

        {connectors.length > 0 && (
          <DetailSection label="Schéma de principe">
            <DrawingWell>
              <BlockDiagram
                connectors={connectors}
                connectorTypes={connectorTypes}
                signals={signals}
                name={item.name}
                brand={brand}
                is2110={item.is2110}
                hoverEntry={hoverEntry}
                onEntryHover={setHoverEntry}
              />
            </DrawingWell>
          </DetailSection>
        )}

        {connectors.length > 0 && (
          <DetailSection label={`Ports · ${ports}`}>
            <FamilyBar connectors={connectors} lookup={lookup} />
            <table aria-label="Ports" className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {["Libellé", "Face", "Signal", "Connecteur", "Sens", "Qté"].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        "border-b border-[var(--border)] px-1.5 py-1.5 text-left text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap text-[var(--text-tertiary)] uppercase first:pl-0",
                        h === "Qté" && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {connectors.map((c, i) => (
                  <tr
                    key={`${c.id}-${i}`}
                    onMouseEnter={() => setHoverEntry(i)}
                    onMouseLeave={() => setHoverEntry(null)}
                    className={cn(hoverEntry === i && "bg-[var(--muted)]")}
                  >
                    <td className="border-b border-[var(--border)] py-1.5 pr-1.5 font-medium text-[var(--foreground)]">
                      {entryLabel(c)}
                    </td>
                    <td className="border-b border-[var(--border)] px-1.5 py-1.5 text-[var(--muted-foreground)]">
                      {FACE_LABEL[c.face]}
                    </td>
                    <td className="border-b border-[var(--border)] px-1.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <ColorMark color={signalColor.get(c.signalName)} />
                        {c.signalName || "—"}
                      </span>
                    </td>
                    <td className="border-b border-[var(--border)] px-1.5 py-1.5 font-mono text-[11.5px]">
                      {`${typeName.get(c.connectorTypeId) ?? "—"} ${genderLetter(c.gender)}`}
                    </td>
                    <td className="border-b border-[var(--border)] px-1.5 py-1.5 text-[var(--muted-foreground)]">
                      {DIRECTION[c.direction]}
                    </td>
                    <td className="border-b border-[var(--border)] py-1.5 pl-1.5 text-right font-mono tabular-nums">
                      {portCount(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DetailSection>
        )}

        <div role="group" aria-label="Essentiel">
          <Kv
            rows={[
              ["Hauteur", rackable ? `${fmtNumber(item.heightU)} U` : "Pose libre"],
              ["Consommation", item.powerW != null ? `${fmtNumber(item.powerW)} W` : "—"],
              ["Fonctions", listOrDash(fns.map((f) => f.label))],
              ["Type", item.type?.name ?? "—"],
              ["Catégorie", item.equipmentCategory?.name ?? item.category ?? "—"],
            ]}
          />
        </div>

        <AdvancedSection
          kind="catalogue-equipment"
          summary="Dimensions, poids, BTU/h, double alim., ST 2110, DMX, phases, champs personnalisés, documents"
        >
          <EquipmentAdvanced item={item} lookup={lookup} />
        </AdvancedSection>
      </DetailBody>
    </>
  );
}

function EquipmentAdvanced({ item, lookup }: { item: CatalogueEquipment; lookup: CatalogueLookup | null }) {
  const rackable = item.isRackable !== false;
  const phaseLabel = new Map((lookup?.phases ?? []).map((p) => [p.id, p.label]));
  const phases = phaseIdsOf(item).map((id) => phaseLabel.get(id) ?? null);
  const tags = jsonArray(item.tags).map((t) => (typeof t === "string" ? t : null));
  const capacities = jsonArray(item.signalCapacities).flatMap((c) => {
    const r = record(c);
    if (!r || !str(r.signalName)) return [];
    return [`${str(r.signalName)} : ${fmtNumber(Number(r.in) || 0)} en entrée, ${fmtNumber(Number(r.out) || 0)} en sortie`];
  });
  const dmxModes = jsonArray(item.dmxModes).flatMap((m) => {
    const r = record(m);
    return r && str(r.name) ? [`${str(r.name)} (${fmtNumber(Number(r.channels) || 0)} canaux)`] : [];
  });
  const custom = jsonArray(item.customFields).flatMap((f) => {
    const r = record(f);
    return r && str(r.label) ? [[str(r.label), customFieldValue(r)] as [string, string]] : [];
  });
  const documents = jsonArray(item.documents).flatMap((d) => {
    const r = record(d);
    return r && str(r.url) ? [{ title: str(r.title) || str(r.url), url: str(r.url) }] : [];
  });
  const dims = [item.dimLmm, item.dimWmm, item.dimHmm];
  const width = WF_OPTIONS.find((o) => o.value === item.widthFraction)?.label ?? "1/1";

  const rows: [string, ReactNode][] = [
    ["Dimensions", dims.some((d) => typeof d === "number" && d > 0) ? `${dims.map((d) => fmtNumber(d)).join(" × ")} mm` : "—"],
  ];
  if (rackable) {
    rows.push(["Profondeur", mm(item.depthMm)]);
    rows.push(["Réserve arrière", item.rearCableDepthMm != null ? mm(item.rearCableDepthMm) : "Réglage du site"]);
    rows.push(["Largeur", width]);
  }
  rows.push(
    ["Poids", item.weight != null ? `${fmtNumber(item.weight)} kg` : "—"],
    ["Dissipation", item.heatBtuH != null ? `${fmtNumber(item.heatBtuH)} BTU/h` : "—"],
    ["Double alim.", yesNo(item.hasDualPsu)],
    ["ST 2110", item.is2110 ? (IP2110[item.ip2110Mode ?? ""] ?? "Oui") : "Non"],
  );
  if (capacities.length) rows.push(["Capacités IP", capacities.join(" · ")]);
  if (item.isLightingFixture) {
    rows.push([
      "DMX",
      [item.dmxChannelsDefault != null ? `${fmtNumber(item.dmxChannelsDefault)} canaux` : null, ...dmxModes]
        .filter(Boolean)
        .join(" · ") || "Oui",
    ]);
  }
  if (item.isComponentHost) rows.push(["Châssis modulaire", `${fmtNumber(item.hostSlotCount)} emplacements`]);
  if (item.isComponent) rows.push(["Composant", `${fmtNumber(item.componentSlotSpan ?? 1)} emplacement(s)`]);
  rows.push(["Phases", listOrDash(phases)], ["Étiquettes", listOrDash(tags)], ...custom);
  if (documents.length) {
    rows.push([
      "Documents",
      <span className="flex flex-col gap-0.5">
        {documents.map((d, i) => {
          const href = safeDocumentHref(d.url);
          return href ? (
            <a
              key={`${d.url}-${i}`}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--accent-strong)] underline-offset-2 hover:underline"
            >
              {d.title}
            </a>
          ) : (
            <span key={`${d.url}-${i}`} className="break-all">
              {d.title === d.url ? d.url : `${d.title} (${d.url})`}
            </span>
          );
        })}
      </span>,
    ]);
  }
  if (item.notes?.trim()) rows.push(["Notes", <span className="whitespace-pre-wrap">{item.notes}</span>]);
  return <Kv rows={rows} />;
}
