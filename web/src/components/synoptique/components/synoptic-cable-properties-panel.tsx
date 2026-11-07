"use client";

import { PenLine, Eraser, Trash2 } from "@/components/ui/icons";

import type { CableSelectionDetails } from "@/components/synoptique/synoptic-view";
import {
  InfoCard,
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { SynopticCableModelPicker } from "@/components/synoptique/components/synoptic-cable-model-picker";

export type SynopticCablePropertiesPanelProps = {
  cable: CableSelectionDetails;
  /** Modifie le style de tracé (un seul id passé). */
  onSetStyle: (ids: string[], style: "ortho" | "rounded" | "arrow") => void;
  /** Démarre la numérotation manuelle pour ce câble. */
  onStartManualNumber: (id: string) => void;
  /** Efface le numéro du câble. */
  onClearLabel: (id: string) => void;
  /** Supprime le câble. */
  onDelete: (id: string) => void;
  /** Assigne (ou retire avec null) le modèle de câble physique. */
  onSetCableModel: (id: string, cableModelId: string | null) => void;
};

/**
 * Panneau de propriétés câble (sélection simple).
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L3486-3623).
 * Conserve à l'identique : entête Câble (pastille + label mono + signal), section
 * Parcours (source/cible avec connecteur + adapter hop), InfoCard Longueur estimée,
 * segmented Style du tracé (ortho/rounded/arrow), CableSpreadToggle, ActionButtons
 * (Numérotation sélection, Effacer le numéro, Supprimer le câble).
 */
export function SynopticCablePropertiesPanel({
  cable,
  onSetStyle,
  onStartManualNumber,
  onClearLabel,
  onDelete,
  onSetCableModel,
}: SynopticCablePropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Câble</SectionTitle>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: cable.color }}
          />
          <div
            className="text-foreground text-sm font-semibold"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {cable.label ?? "—"}
          </div>
        </div>
        {cable.signalName && (
          <div className="text-muted-foreground mt-0.5 text-[11px]">{cable.signalName}</div>
        )}
      </div>

      <div>
        <SectionTitle>Parcours</SectionTitle>
        <div className="border-border/60 flex flex-col gap-2 rounded-md border bg-transparent p-2.5">
          {/* Source */}
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              Source
            </div>
            <div className="truncate text-[12px] font-medium">{cable.from.slotName}</div>
            <div className="text-muted-foreground mt-0.5 text-[10px]">
              {cable.from.connectorLabel ??
                cable.from.portLabel ??
                `Port ${cable.from.portNum}`}
            </div>
            {cable.from.adapterHop && (
              <div className="text-muted-foreground text-[10px]">
                → {cable.from.adapterHop.adapterName} Port{" "}
                {cable.from.adapterHop.adapterPortNum}
              </div>
            )}
          </div>
          <div className="border-border/60 my-0 border-t border-dashed" />
          {/* Destination */}
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              Cible
            </div>
            <div className="truncate text-[12px] font-medium">{cable.to.slotName}</div>
            <div className="text-muted-foreground mt-0.5 text-[10px]">
              {cable.to.connectorLabel ??
                cable.to.portLabel ??
                `Port ${cable.to.portNum}`}
            </div>
            {cable.to.adapterHop && (
              <div className="text-muted-foreground text-[10px]">
                → {cable.to.adapterHop.adapterName} Port{" "}
                {cable.to.adapterHop.adapterPortNum}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Style du tracé — déplacé AVANT le Modèle (cohérence avec le panneau
          multi-sélection). */}
      <div>
        <SectionTitle>Style du tracé</SectionTitle>
        <div className="border-border bg-card flex items-center gap-0.5 rounded-md border p-0.5">
          {(
            [
              { id: "ortho", label: "Orthogonal" },
              { id: "rounded", label: "Arrondi" },
              { id: "arrow", label: "Flèches" },
            ] as const
          ).map((s) => {
            const active = cable.cableStyle === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSetStyle([cable.id], s.id)}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all active:scale-95 ${active ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Modèle du câble (CableModel) — filtré par compatibilité signal si la
          connexion a un signalName défini. */}
      <div>
        <SectionTitle>Modèle du câble</SectionTitle>
        <SynopticCableModelPicker
          value={cable.catalogCableModelId}
          signalName={cable.signalName}
          onChange={(id) => onSetCableModel(cable.id, id)}
        />
      </div>

      {/* Longueur estimée — InfoCard */}
      {cable.estimatedLengthM != null && (
        <InfoCard
          icon={
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 12h20M6 8v8M10 10v4M14 8v8M18 10v4" />
            </svg>
          }
          label="Longueur estimée"
          value={`${cable.estimatedLengthM} m`}
        />
      )}

      <div className="border-border mt-1 flex flex-col gap-1.5 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<PenLine className="h-3.5 w-3.5" />}
          label="Numérotation sélection"
          onClick={() => onStartManualNumber(cable.id)}
        />
        {cable.label && (
          <ActionButton
            icon={<Eraser className="h-3.5 w-3.5" />}
            label="Effacer le numéro"
            onClick={() => onClearLabel(cable.id)}
          />
        )}
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer le câble"
          onClick={() => onDelete(cable.id)}
          danger
        />
      </div>
    </div>
  );
}
