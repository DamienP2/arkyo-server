"use client";

import { Trash2, Network } from "@/components/ui/icons";

import type { AdapterSelectionDetails } from "@/components/synoptique/synoptic-view";
import {
  InfoCard,
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";

export type SynopticAdapterPropertiesPanelProps = {
  adapter: AdapterSelectionDetails;
  /** Met à jour le label de l'adaptateur (uppercase ou null). */
  onUpdateLabel: (id: string, label: string | null) => void;
  /** Supprime l'adaptateur. */
  onDelete: (id: string) => void;
};

/**
 * Panneau de propriétés d'un adaptateur.
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L2805-2937).
 * Conserve à l'identique : entête label (input uppercase), nom + référence,
 * schéma SVG (entrée gauche → courbes → sorties stackées droite), InfoCard
 * "Attaché à" (slot + connector label / port), ActionButton "Supprimer
 * l'adaptateur".
 */
export function SynopticAdapterPropertiesPanel({
  adapter,
  onUpdateLabel,
  onDelete,
}: SynopticAdapterPropertiesPanelProps) {
  const inputs = adapter.connectors.filter((c) => c.direction === "IN");
  const outputs = adapter.connectors.filter((c) => c.direction !== "IN");
  const inputEntry = inputs[0];
  const outputCount = outputs.length;
  const ROW_H = 28;
  const svgH = Math.max(ROW_H, outputCount * ROW_H);
  const inputY = svgH / 2;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Adaptateur</SectionTitle>
        <input
          type="text"
          defaultValue={adapter.label ?? ""}
          placeholder={adapter.name}
          onChange={(e) => {
            e.target.value = e.target.value.toUpperCase();
          }}
          onBlur={(e) => {
            const v = e.target.value.trim().toUpperCase();
            onUpdateLabel(adapter.id, v || null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="text-foreground hover:border-border w-full border-b border-transparent bg-transparent px-0 py-0.5 text-sm font-semibold uppercase transition-colors focus:border-[var(--accent)] focus:outline-none"
        />
        <div className="text-muted-foreground mt-0.5 text-[11px]">{adapter.name}</div>
        {adapter.reference && (
          <div
            className="text-muted-foreground mt-0.5 text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {adapter.reference}
          </div>
        )}
      </div>

      {/* Schéma connecteurs : entrée (gauche) → sorties (droite) */}
      {adapter.connectors.length > 0 && (
        <div>
          <SectionTitle>Connecteurs</SectionTitle>
          <div className="flex items-stretch gap-0">
            {/* Entrée (gauche) */}
            <div className="flex shrink-0 flex-col justify-center" style={{ minWidth: 70 }}>
              {inputEntry && (
                <div className="border-border bg-card flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px]">
                  {inputEntry.connectorColor && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ background: inputEntry.connectorColor }}
                    />
                  )}
                  <span className="truncate font-medium">
                    {inputEntry.connectorTypeName ?? "—"}
                  </span>
                </div>
              )}
            </div>
            {/* Lignes SVG */}
            <svg width={40} height={svgH} className="shrink-0" style={{ overflow: "visible" }}>
              {outputs.map((_, i) => {
                const outY = (i + 0.5) * ROW_H;
                return (
                  <path
                    key={i}
                    d={`M 0 ${inputY} C 20 ${inputY} 20 ${outY} 40 ${outY}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.2}
                    strokeOpacity={0.5}
                  />
                );
              })}
            </svg>
            {/* Sorties (droite, stackées) */}
            <div className="flex flex-1 flex-col justify-center gap-1">
              {outputs.map((c, i) => (
                <div
                  key={i}
                  className="border-border bg-card flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px]"
                >
                  {c.connectorColor && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ background: c.connectorColor }}
                    />
                  )}
                  <span className="truncate font-medium">{c.connectorTypeName ?? "—"}</span>
                  {c.quantity > 1 && (
                    <span className="text-muted-foreground font-mono text-[9px]">
                      ×{c.quantity}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Attaché à */}
      {adapter.attachedSlotName && (
        <InfoCard
          icon={<Network className="h-4 w-4" />}
          label="Attaché à"
          value={
            <div className="flex flex-col leading-tight">
              <span>{adapter.attachedSlotName}</span>
              <span className="text-muted-foreground text-[10px] font-normal">
                {adapter.attachedConnectorLabel ??
                  adapter.attachedPortLabel ??
                  `Port ${adapter.attachedPortNum}`}
              </span>
            </div>
          }
        />
      )}

      <div className="border-border mt-1 flex flex-col gap-1 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer l'adaptateur"
          onClick={() => onDelete(adapter.id)}
          danger
        />
      </div>
    </div>
  );
}
