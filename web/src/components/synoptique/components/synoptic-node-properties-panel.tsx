"use client";

import { Hash, Server, Package, Weight, Zap } from "@/components/ui/icons";

import type { NodeSelectionDetails } from "@/components/synoptique/synoptic-view";
import {
  InfoCard,
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { NameInput } from "@/components/synoptique/components/synoptic-general-panel";
import { apiFetch } from "@/lib/client-id";

export type SynopticNodePropertiesPanelProps = {
  node: NodeSelectionDetails;
  /** rackId pour patcher le slot. */
  rackId: string;
  /** Map nomCatégorie → couleur hex (utilisé pour la pilule catégorie). */
  catColorMap: Record<string, string>;
  /**
   * Liste des connexions courantes du rack (live ou initiales). Utilisée pour
   * récupérer les IDs des câbles reliés au slot pour la numérotation manuelle.
   */
  connections: ReadonlyArray<{
    id: string;
    fromSlotId?: string;
    toSlotId?: string;
  }>;
  /** Démarre la numérotation manuelle pour la liste d'IDs (= câbles de ce slot). */
  onStartManualNumberForCables: (ids: string[]) => void;
  /** Callback à exécuter après onStartManualNumberForCables (ex. ouvrir le panneau). */
  onAfterStartManualNumber: () => void;
};

/**
 * Panneau de propriétés node (équipement ou panel de patch).
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L2615-2803).
 * Conserve à l'identique : image (si fournie), titre selon panel/équipement,
 * NameInput, marque · équipement, référence mono, pilule catégorie (couleur =
 * catColorMap[category]), section Connecteurs (chips IN à gauche, OUT/BIDI à
 * droite, avec couleur + dir + xN), grid 2 colonnes InfoCards (Poids, Conso,
 * Hauteur, Largeur, Profondeur, Emplacement, Position), ActionButtons
 * (Numérotation si équipement).
 */
export function SynopticNodePropertiesPanel({
  node,
  rackId,
  catColorMap,
  connections,
  onStartManualNumberForCables,
  onAfterStartManualNumber,
}: SynopticNodePropertiesPanelProps) {
  const viewLabel =
    node.view === "FRONT"
      ? "Avant"
      : node.view === "REAR"
        ? "Arrière"
        : node.view === "REAR_INTERIOR"
          ? "Arr. intérieur"
          : (node.view ?? "—");
  const hU = node.heightU ?? 1;
  const sU = node.startU ?? 0;
  const posLabel = hU > 1 ? `${sU}U – ${sU + hU - 1}U` : `${sU}U`;
  const widthLabel = node.widthFraction
    ? ({ FULL: "1/1", HALF: "1/2", THIRD: "1/3", QUARTER: "1/4" }[
        node.widthFraction
      ] ?? node.widthFraction)
    : "1/1";

  const ins = (node.connectors ?? []).filter((c) => c.direction === "IN");
  const outs = (node.connectors ?? []).filter((c) => c.direction !== "IN");
  const renderChip = (c: (typeof node.connectors)[number], i: number) => {
    const dirLabel =
      c.direction === "IN"
        ? "IN"
        : c.direction === "OUT"
          ? "OUT"
          : c.direction === "BIDIR" || c.direction === "BOTH"
            ? "BIDI"
            : null;
    return (
      <span
        key={i}
        className="border-border bg-card inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]"
        title={[c.signalName, c.name, dirLabel].filter(Boolean).join(" · ")}
      >
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.color }} />
        <span className="font-medium">{c.name}</span>
        {dirLabel && <span className="text-muted-foreground text-[9px]">{dirLabel}</span>}
        <span className="text-muted-foreground font-mono text-[9px]">×{c.count}</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      {node.imageUrl && (
        <img
          src={node.imageUrl}
          alt=""
          className="border-border bg-muted/30 h-24 w-full rounded-md border object-contain"
        />
      )}
      <div>
        <SectionTitle>{node.panelName ? "Panel de patch" : "Équipement"}</SectionTitle>
        <NameInput
          rackName={node.label ?? ""}
          onRackNameChange={async (label) => {
            await apiFetch(`/api/racks/${rackId}/slots/${node.slotId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: label || null }),
            });
          }}
        />
        {(node.brandName || node.equipmentName) && (
          <div className="text-muted-foreground mt-0.5 text-[11px]">
            {[node.brandName, node.equipmentName].filter(Boolean).join(" · ")}
          </div>
        )}
        {node.reference && (
          <div
            className="text-muted-foreground mt-0.5 text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {node.reference}
          </div>
        )}
        {node.category &&
          (() => {
            const cat = node.category;
            const hex = catColorMap[cat] ?? "#94a3b8";
            return (
              <span
                className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
                style={{ background: `${hex}18`, color: hex }}
              >
                {cat}
              </span>
            );
          })()}
      </div>
      {node.connectors && node.connectors.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Connecteurs ({node.connectors.reduce((s, c) => s + c.count, 0)})
          </div>
          <div className="flex gap-3">
            {ins.length > 0 && (
              <div className="flex flex-1 flex-col gap-1">
                <div className="text-muted-foreground text-[9px] tracking-wider uppercase">
                  In
                </div>
                {ins.map(renderChip)}
              </div>
            )}
            {outs.length > 0 && (
              <div className="flex flex-1 flex-col gap-1">
                <div className="text-muted-foreground text-[9px] tracking-wider uppercase">
                  Out / Bidi
                </div>
                {outs.map(renderChip)}
              </div>
            )}
          </div>
        </div>
      )}
      {/* InfoCards */}
      <div className="grid grid-cols-2 gap-2">
        {node.weightKg != null && node.weightKg > 0 && (
          <InfoCard
            icon={<Weight className="h-4 w-4" />}
            label="Poids"
            value={`${node.weightKg} kg`}
          />
        )}
        {node.powerW != null && node.powerW > 0 && (
          <InfoCard
            icon={<Zap className="h-4 w-4" />}
            label="Conso"
            value={`${node.powerW} W`}
          />
        )}
        {node.heightU != null && node.heightU > 0 && (
          <InfoCard
            icon={<Server className="h-4 w-4" />}
            label="Hauteur"
            value={`${node.heightU}U`}
          />
        )}
        <InfoCard icon={<Package className="h-4 w-4" />} label="Largeur" value={widthLabel} />
        {node.depthMm != null && node.depthMm > 0 && (
          <InfoCard
            icon={<Package className="h-4 w-4" />}
            label="Profondeur"
            value={`${node.depthMm}mm`}
          />
        )}
        <InfoCard
          icon={<Package className="h-4 w-4" />}
          label="Emplacement"
          value={viewLabel}
        />
        <InfoCard icon={<Server className="h-4 w-4" />} label="Position" value={posLabel} />
      </div>
      {/* Actions */}
      <div className="border-border flex flex-col gap-1.5 border-t pt-2">
        <SectionTitle>Actions</SectionTitle>
        {!node.panelName && (
          <ActionButton
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Numérotation de cet équipement"
            onClick={() => {
              const slotId = node.slotId;
              const connIds = (connections ?? [])
                .filter(
                  (c) => c.fromSlotId === slotId || c.toSlotId === slotId,
                )
                .map((c) => c.id);
              if (connIds.length === 0) return;
              onStartManualNumberForCables(connIds);
              onAfterStartManualNumber();
            }}
          />
        )}
      </div>
    </div>
  );
}
