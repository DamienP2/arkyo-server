"use client";

import { PenLine, Eraser, Trash2 } from "@/components/ui/icons";

import type { CableSummary } from "@/components/synoptique/synoptic-view";
import {
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";
import { SynopticCableModelPicker } from "@/components/synoptique/components/synoptic-cable-model-picker";

export type SynopticMultiCablePropertiesPanelProps = {
  summaries: CableSummary[];
  /** Modifie le style de tracé des IDs passés. */
  onSetStyle: (ids: string[], style: "ortho" | "rounded" | "arrow") => void;
  /** Numérotation manuelle pour la sélection. */
  onStartManualNumberForIds: (ids: string[]) => void;
  /** Efface les labels des IDs passés. */
  onClearLabelsForIds: (ids: string[]) => void;
  /** Supprime les câbles des IDs passés. */
  onDeleteForIds: (ids: string[]) => void;
  /** Assigne le même CableModel à tous les câbles sélectionnés. */
  onSetCableModelForIds: (ids: string[], cableModelId: string | null) => void;
};

/**
 * Panneau de propriétés multi-sélection câbles.
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L2452-2550).
 * Conserve à l'identique : entête "Sélection multiple" + compteur, liste mono des
 * câbles (pastille couleur, label ou signal fallback), segmented Style du tracé
 * (ortho/rounded/arrow), ActionButtons (Numérotation, Effacer numéros, Supprimer).
 */
export function SynopticMultiCablePropertiesPanel({
  summaries,
  onSetStyle,
  onStartManualNumberForIds,
  onClearLabelsForIds,
  onDeleteForIds,
  onSetCableModelForIds,
}: SynopticMultiCablePropertiesPanelProps) {
  // Valeur commune si tous les câbles ont le même catalogCableModelId, sinon
  // null (le picker affiche "Aucun" — choisir ré-applique à tous).
  const allModelIds = summaries.map((s) => s.catalogCableModelId);
  const commonModelId =
    allModelIds.length > 0 && allModelIds.every((id) => id === allModelIds[0])
      ? allModelIds[0]
      : null;
  // Si signal commun, on filtre le picker par compatibilité.
  const allSignals = summaries.map((s) => s.signalName);
  const commonSignal =
    allSignals.length > 0 && allSignals.every((s) => s === allSignals[0])
      ? allSignals[0]
      : null;
  // Style du tracé commun (null = valeurs mixtes → aucun bouton actif).
  const allStyles = summaries.map((s) => s.cableStyle ?? "ortho");
  const commonStyle: "ortho" | "rounded" | "arrow" | null =
    allStyles.length > 0 && allStyles.every((st) => st === allStyles[0])
      ? (allStyles[0] as "ortho" | "rounded" | "arrow")
      : null;
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
          {summaries.length} câbles
        </div>
      </div>
      <div className="flex max-h-60 flex-col gap-0.5 overflow-auto">
        {summaries.map((c) => (
          <div
            key={c.id}
            className="hover:bg-muted flex items-center gap-2 rounded px-1.5 py-1 text-[11px]"
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: c.color }} />
            {c.label ? (
              <span className="flex-1 truncate" style={{ fontFamily: "var(--font-mono)" }}>
                {c.label}
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
                  {c.signalName ?? "Signal inconnu"}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {/* Style du tracé — déplacé AVANT le Modèle. Segmented multi-sélection
          appliqué à tous les câbles. */}
      <div className="border-border flex flex-col gap-1.5 border-t pt-3">
        <SectionTitle>Style du tracé</SectionTitle>
        <div className="border-border bg-card flex items-center gap-0.5 rounded-md border p-0.5">
          {(
            [
              { id: "ortho", label: "Orthogonal" },
              { id: "rounded", label: "Arrondi" },
              { id: "arrow", label: "Flèches" },
            ] as const
          ).map((s) => {
            const active = commonStyle === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSetStyle(summaries.map((c) => c.id), s.id)}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all active:scale-95 ${active ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {commonStyle === null && (
          <div className="text-muted-foreground mt-1 text-[10px] italic">
            Styles mixtes — choisir applique à tous.
          </div>
        )}
      </div>

      {/* Modèle — appliqué à tous les câbles sélectionnés. Filtré par
          compatibilité signal (signalName prop = commonSignal). Si plusieurs
          types de signaux sont sélectionnés (commonSignal === null), on cache
          tout le bloc : assigner un modèle à des signaux hétérogènes n'a pas
          de sens (incompatibilités multiples). */}
      {commonSignal !== null && (
        <div className="border-border border-t pt-3">
          <SectionTitle>Modèle du câble</SectionTitle>
          <SynopticCableModelPicker
            value={commonModelId}
            signalName={commonSignal}
            onChange={(id) =>
              onSetCableModelForIds(summaries.map((c) => c.id), id)
            }
          />
          {commonModelId === null && summaries.some((s) => s.catalogCableModelId) && (
            <div className="text-muted-foreground mt-1 text-[10px] italic">
              Valeurs mixtes — choisir applique à tous.
            </div>
          )}
        </div>
      )}

      <div className="border-border mt-1 flex flex-col gap-1 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<PenLine className="h-3.5 w-3.5" />}
          label="Numérotation sélection"
          onClick={() => onStartManualNumberForIds(summaries.map((c) => c.id))}
        />
        <ActionButton
          icon={<Eraser className="h-3.5 w-3.5" />}
          label="Effacer les numéros"
          onClick={() => onClearLabelsForIds(summaries.map((c) => c.id))}
        />
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer les câbles"
          onClick={() => onDeleteForIds(summaries.map((c) => c.id))}
          danger
        />
      </div>
    </div>
  );
}
