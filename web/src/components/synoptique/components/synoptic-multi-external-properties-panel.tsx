"use client";

import { Eraser, Trash2 } from "@/components/ui/icons";

import type { ExternalPortSummary } from "@/components/synoptique/synoptic-view";
import {
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";

export type SynopticMultiExternalPropertiesPanelProps = {
  summaries: ExternalPortSummary[];
  /** Efface les labels des connexions externes sélectionnées. */
  onClearLabelsForIds: (ids: string[]) => void;
  /** Supprime les connexions externes sélectionnées. */
  onDeleteForIds: (ids: string[]) => void;
};

/**
 * Panneau propriétés multi-sélection connexions externes. Pattern aligné sur
 * `SynopticMultiCablePropertiesPanel`.
 */
export function SynopticMultiExternalPropertiesPanel({
  summaries,
  onClearLabelsForIds,
  onDeleteForIds,
}: SynopticMultiExternalPropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
          Sélection multiple
        </div>
        <div
          className="text-foreground text-sm font-semibold"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {summaries.length} connexions externes
        </div>
      </div>
      <div className="flex max-h-60 flex-col gap-0.5 overflow-auto">
        {summaries.map((s) => (
          <div
            key={s.id}
            className="hover:bg-muted flex items-center gap-2 rounded px-1.5 py-1 text-[11px]"
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.color }} />
            {s.label ? (
              <span className="flex-1 truncate" style={{ fontFamily: "var(--font-mono)" }}>
                {s.label}
              </span>
            ) : (
              <>
                <span
                  className="text-muted-foreground"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  —
                </span>
                <span className="text-muted-foreground flex-1 truncate">
                  {s.signalName ?? s.targetLabel ?? "Externe"}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="border-border mt-1 flex flex-col gap-1 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<Eraser className="h-3.5 w-3.5" />}
          label="Effacer les numéros"
          onClick={() => onClearLabelsForIds(summaries.map((s) => s.id))}
        />
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer les connexions externes"
          onClick={() => onDeleteForIds(summaries.map((s) => s.id))}
          danger
        />
      </div>
    </div>
  );
}
