"use client";

import { Trash2 } from "@/components/ui/icons";

import type {
  ZoneSelectionDetails,
  SynopticViewHandle,
} from "@/components/synoptique/synoptic-view";
import {
  ActionButton,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";

const LABEL_FONT_FAMILIES = [
  { id: "sans", label: "Sans", value: "var(--font-sans)" },
  { id: "mono", label: "Mono", value: "var(--font-mono)" },
  { id: "serif", label: "Serif", value: "ui-serif, Georgia, serif" },
];

type UpdateZonePatch = Parameters<SynopticViewHandle["updateZone"]>[1];

export type SynopticZonePropertiesPanelProps = {
  zone: ZoneSelectionDetails;
  /** Met à jour une zone (label, color, labelPosition, borderRadius, borderWidth, borderStyle, opacity, labelFont*). */
  onUpdate: (id: string, patch: UpdateZonePatch) => void;
  /** Supprime la zone. */
  onDelete: (id: string) => void;
};

/**
 * Panneau de propriétés zone.
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L2946-3215).
 * Conserve à l'identique : titre (input), position label (grid 2x2 ↖↗↙↘),
 * palette couleur 8 + picker, range Arrondi, Contours (range épaisseur +
 * segmented style), range Transparence, Style du texte (B/I/U + Police segmented
 * 3 + range Taille), ActionButton Supprimer.
 */
export function SynopticZonePropertiesPanel({
  zone,
  onUpdate,
  onDelete,
}: SynopticZonePropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Zone</SectionTitle>
        <input
          type="text"
          value={zone.label}
          onChange={(e) => onUpdate(zone.id, { label: e.target.value })}
          placeholder="Sans titre"
          className="text-foreground hover:border-border w-full border-b border-transparent bg-transparent px-0 py-0.5 text-sm font-semibold transition-colors focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Position du label
        </div>
        <div className="bg-muted grid grid-cols-2 gap-0.5 rounded-md p-0.5">
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
            <button
              key={pos}
              onClick={() => onUpdate(zone.id, { labelPosition: pos })}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-all ${zone.labelPosition === pos ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
            >
              {pos === "top-left"
                ? "↖ Haut-G"
                : pos === "top-right"
                  ? "↗ Haut-D"
                  : pos === "bottom-left"
                    ? "↙ Bas-G"
                    : "↘ Bas-D"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Couleur
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            "#6366f1",
            "#ef4444",
            "#f59e0b",
            "#10b981",
            "#3b82f6",
            "#8b5cf6",
            "#ec4899",
            "#64748b",
          ].map((c) => (
            <button
              key={c}
              onClick={() => onUpdate(zone.id, { color: c })}
              className={`h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform ${zone.color === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-110"}`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <label
            className="ring-dashed ring-border relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 hover:ring-[var(--accent)]"
            title="Couleur personnalisée"
          >
            <input
              type="color"
              value={zone.color}
              onChange={(e) => onUpdate(zone.id, { color: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <div
              className="h-full w-full"
              style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
            />
          </label>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
            Arrondi
          </div>
          <div
            className="text-muted-foreground text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {zone.borderRadius ?? 8}px
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={24}
          step={1}
          value={zone.borderRadius ?? 8}
          onChange={(e) => onUpdate(zone.id, { borderRadius: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Contours
        </div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted-foreground text-[10px]">Épaisseur</span>
          <span
            className="text-muted-foreground text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {zone.borderWidth ?? 2}px
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={6}
          step={1}
          value={zone.borderWidth ?? 2}
          onChange={(e) => onUpdate(zone.id, { borderWidth: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
        <div className="bg-muted mt-2 grid grid-cols-3 gap-0.5 rounded-md p-0.5">
          {(["solid", "dashed", "dotted"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => onUpdate(zone.id, { borderStyle: st })}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-all ${(zone.borderStyle ?? "solid") === st ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
            >
              {st === "solid" ? "Continu" : st === "dashed" ? "Tirets" : "Pointillés"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
            Transparence
          </div>
          <div
            className="text-muted-foreground text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {(zone.opacity ?? 0.12).toFixed(2)}
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={zone.opacity ?? 0.12}
          onChange={(e) => onUpdate(zone.id, { opacity: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className="border-border border-t pt-3">
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Style du texte
        </div>
        <div className="mb-2 flex gap-1">
          <button
            type="button"
            onClick={() =>
              onUpdate(zone.id, {
                labelFontWeight: zone.labelFontWeight === "bold" ? "normal" : "bold",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold transition-colors ${zone.labelFontWeight === "bold" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            B
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdate(zone.id, {
                labelFontStyle: zone.labelFontStyle === "italic" ? "normal" : "italic",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm italic transition-colors ${zone.labelFontStyle === "italic" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            I
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdate(zone.id, {
                labelTextDecoration:
                  zone.labelTextDecoration === "underline" ? "none" : "underline",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm underline transition-colors ${zone.labelTextDecoration === "underline" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            U
          </button>
        </div>
        <div className="bg-muted mb-2 flex gap-0.5 rounded-md p-0.5">
          {LABEL_FONT_FAMILIES.map((f) => {
            const current =
              zone.labelFontFamily === f.value ||
              (!zone.labelFontFamily && f.id === "sans");
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onUpdate(zone.id, { labelFontFamily: f.value })}
                className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${current ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-muted-foreground text-[10px]">Taille</div>
          <div
            className="text-muted-foreground text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {zone.labelFontSize ?? 12}px
          </div>
        </div>
        <input
          type="range"
          min={7}
          max={80}
          step={1}
          value={zone.labelFontSize ?? 12}
          onChange={(e) => onUpdate(zone.id, { labelFontSize: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className="border-border mt-1 flex flex-col gap-1 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer la zone"
          onClick={() => onDelete(zone.id)}
          danger
        />
      </div>
    </div>
  );
}
