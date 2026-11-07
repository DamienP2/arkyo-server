"use client";

import { Trash2 } from "@/components/ui/icons";

import type {
  LabelSelectionDetails,
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
const LABEL_FONT_SIZES = [7, 10, 14, 18, 24, 32, 48, 64, 80];

type UpdateLabelPatch = Parameters<SynopticViewHandle["updateLabel"]>[1];

export type SynopticLabelPropertiesPanelProps = {
  label: LabelSelectionDetails;
  /** Met à jour un label canvas (text, color, fontWeight, fontSize, fontFamily, fontStyle, textDecoration, pill*). */
  onUpdate: (id: string, patch: UpdateLabelPatch) => void;
  /** Supprime le label. */
  onDelete: (id: string) => void;
};

/**
 * Panneau de propriétés label canvas.
 *
 * Source : extrait de rack-editor.tsx workspace="synoptic" (~L3217-3484).
 * Conserve à l'identique : textarea Texte stylé (color/fontWeight/fontFamily),
 * boutons B/I/U, segmented Police 3 (sans/mono/serif), range Taille + chips de
 * tailles préréglées, palette couleur 8 + picker, section Pillule (toggle +
 * palette fond + range radius), ActionButton Supprimer.
 */
export function SynopticLabelPropertiesPanel({
  label,
  onUpdate,
  onDelete,
}: SynopticLabelPropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Texte</SectionTitle>
        <textarea
          value={label.text}
          onChange={(e) => onUpdate(label.id, { text: e.target.value })}
          rows={2}
          className="hover:border-border w-full resize-none border-b border-transparent bg-transparent px-0 py-0.5 text-sm transition-colors focus:border-[var(--accent)] focus:outline-none"
          style={{
            color: label.color,
            fontWeight: label.fontWeight === "bold" ? 700 : 400,
            fontFamily: label.fontFamily ?? undefined,
          }}
        />
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Style
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() =>
              onUpdate(label.id, {
                fontWeight: label.fontWeight === "bold" ? "normal" : "bold",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold transition-colors ${label.fontWeight === "bold" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            B
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdate(label.id, {
                fontStyle: label.fontStyle === "italic" ? "normal" : "italic",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm italic transition-colors ${label.fontStyle === "italic" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            I
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdate(label.id, {
                textDecoration: label.textDecoration === "underline" ? "none" : "underline",
              })
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm underline transition-colors ${label.textDecoration === "underline" ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
          >
            U
          </button>
        </div>
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Police
        </div>
        <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
          {LABEL_FONT_FAMILIES.map((f) => {
            const current =
              label.fontFamily === f.value || (!label.fontFamily && f.id === "sans");
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onUpdate(label.id, { fontFamily: f.value })}
                className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${current ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
            Taille
          </div>
          <div
            className="text-muted-foreground text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {label.fontSize ?? 14}px
          </div>
        </div>
        <input
          type="range"
          min={7}
          max={80}
          step={1}
          value={label.fontSize ?? 14}
          onChange={(e) => onUpdate(label.id, { fontSize: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {LABEL_FONT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onUpdate(label.id, { fontSize: s })}
              className={`flex h-6 min-w-[30px] items-center justify-center rounded-md border px-1 text-[10px] transition-colors ${(label.fontSize ?? 14) === s ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" : "border-border hover:bg-muted"}`} // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted-foreground mb-1.5 text-[10px] tracking-[0.12em] uppercase">
          Couleur du texte
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            "#111827",
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
              onClick={() => onUpdate(label.id, { color: c })}
              className={`h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform ${label.color === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-110"}`}
              style={{ background: c }}
            />
          ))}
          <label
            className="ring-dashed ring-border relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 hover:ring-[var(--accent)]"
            title="Couleur personnalisée"
          >
            <input
              type="color"
              value={label.color}
              onChange={(e) => onUpdate(label.id, { color: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <div
              className="h-full w-full"
              style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
            />
          </label>
        </div>
      </div>

      <div className="border-border border-t pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
            Pillule
          </div>
          <button
            type="button"
            onClick={() => onUpdate(label.id, { pill: !label.pill })}
            className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${label.pill ? "justify-end bg-[var(--accent)]" : "bg-muted justify-start"}`}
          >
            {/* arkyo-server: habillage Strata (bouton blanc illisible sur --muted clair, comme le Toggle de property-patterns) */}
            <span className={`h-4 w-4 rounded-full shadow ${label.pill ? "bg-white" : "bg-[var(--muted-foreground)]"}`} />
          </button>
        </div>
        {label.pill && (
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-muted-foreground mb-1 text-[10px]">Fond</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  "#fde68a",
                  "#fecaca",
                  "#bbf7d0",
                  "#bfdbfe",
                  "#e9d5ff",
                  "#fce7f3",
                  "#e5e7eb",
                  "#1f2937",
                ].map((c) => (
                  <button
                    key={c}
                    onClick={() => onUpdate(label.id, { pillBg: c })}
                    className={`h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform ${label.pillBg === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-110"}`}
                    style={{ background: c }}
                  />
                ))}
                <label
                  className="ring-dashed ring-border relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 hover:ring-[var(--accent)]"
                  title="Fond personnalisé"
                >
                  <input
                    type="color"
                    value={label.pillBg ?? "#fde68a"}
                    onChange={(e) => onUpdate(label.id, { pillBg: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  <div
                    className="h-full w-full"
                    style={{
                      background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                    }}
                  />
                </label>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-muted-foreground text-[10px]">Radius</div>
                <div
                  className="text-muted-foreground text-[10px]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {label.pillRadius ?? 12}px
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={32}
                step={1}
                value={label.pillRadius ?? 12}
                onChange={(e) => onUpdate(label.id, { pillRadius: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-border mt-1 flex flex-col gap-1 border-t pt-3">
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer le label"
          onClick={() => onDelete(label.id)}
          danger
        />
      </div>
    </div>
  );
}
