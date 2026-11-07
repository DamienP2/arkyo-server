"use client";

import { Trash2 } from "@/components/ui/icons";

import type { ExternalPortSelectionDetails } from "@/components/synoptique/synoptic-view";
import {
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";

export type SynopticExternalPortPropertiesPanelProps = {
  external: ExternalPortSelectionDetails;
  /** Supprime le marqueur externe. */
  onDelete: (id: string) => void;
  /** Bascule inter-emplacements ↔ lien externe. */
  onSetKind?: (id: string, kind: "INTER_LIEU" | "MONDE") => void;
  /** Met à jour l'étiquette libre d'un « lien externe ». */
  onSetWorldLabel?: (id: string, label: string | null) => void;
};

// La valeur stockée reste `MONDE` (enum Prisma) ; seul le libellé visible dit
// « Lien externe ».
const KIND_OPTIONS = [
  { id: "INTER_LIEU", label: "Inter-emplacements" },
  { id: "MONDE", label: "Lien externe" },
] as const;

/**
 * Panneau propriétés d'une connexion externe (sélection simple).
 *
 * Pattern aligné sur `SynopticCablePropertiesPanel` (entête pastille + label
 * mono + signal, section Parcours = source + cible externe, actions). Sans
 * style de tracé (le marqueur externe n'a pas de tracé).
 */
export function SynopticExternalPortPropertiesPanel({
  external,
  onDelete,
  onSetKind,
  onSetWorldLabel,
}: SynopticExternalPortPropertiesPanelProps) {
  const isWorld = external.kind === "MONDE";
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Connexion externe</SectionTitle>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: external.color }}
          />
          <div
            className="text-foreground text-sm font-semibold"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {external.label ?? "—"}
          </div>
        </div>
        {external.signalName && (
          <div className="text-muted-foreground mt-0.5 text-[11px]">
            {external.signalName}
          </div>
        )}
      </div>

      {onSetKind && (
        <div>
          <SectionTitle>Type</SectionTitle>
          <div className="border-border bg-card flex items-center gap-0.5 rounded-md border p-0.5">
            {KIND_OPTIONS.map((k) => {
              const active = external.kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => onSetKind(external.id, k.id)}
                  className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all active:scale-95 ${active ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isWorld && onSetWorldLabel && (
        <div>
          <SectionTitle>Étiquette</SectionTitle>
          <input
            type="text"
            // `key` sur l'id : le champ est non contrôlé (commit au blur), il
            // doit se réinitialiser quand on sélectionne une autre bulle.
            key={external.id}
            defaultValue={external.worldLabel ?? ""}
            placeholder="Feed diffuseur, antenne…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === (external.worldLabel ?? "")) return;
              onSetWorldLabel(external.id, v || null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="border-border/60 bg-card text-foreground placeholder:text-muted-foreground w-full rounded-md border px-2 py-1.5 text-[12px] transition-colors focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
      )}

      <div>
        <SectionTitle>Parcours</SectionTitle>
        <div className="border-border/60 flex flex-col gap-2 rounded-md border bg-transparent p-2.5">
          {/* Source */}
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              Source
            </div>
            <div className="truncate text-[12px] font-medium">{external.from.slotName}</div>
            <div className="text-muted-foreground mt-0.5 text-[10px]">
              {external.from.connectorLabel ??
                external.from.portLabel ??
                `Port ${external.from.portNum}`}
            </div>
          </div>
          <div className="border-border/60 my-0 border-t border-dashed" />
          {/* Destination : cible résolue (inter-emplacements) ou étiquette
              libre (lien externe). */}
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              {isWorld ? "Hors projet" : "Cible externe"}
            </div>
            <div className="truncate text-[12px] font-medium">
              {isWorld ? (external.worldLabel ?? "—") : (external.targetLabel ?? "—")}
            </div>
          </div>
        </div>
      </div>

      <div className="border-border mt-1 flex flex-col gap-1.5 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        {/* La numérotation des connexions externes se gère uniquement dans
            la vue GENERAL (label câble inter-rack). */}
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer la connexion externe"
          onClick={() => onDelete(external.id)}
          danger
        />
      </div>
    </div>
  );
}
