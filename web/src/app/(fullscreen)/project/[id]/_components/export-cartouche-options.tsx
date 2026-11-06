"use client";

/**
 * export-cartouche-options — briques partagées pour l'option « cartouche »
 * (modèle blueprint `TenantPrintTemplate`) dans `ExportMenu`.
 *
 * Analogue de `export-pdf-model-options.tsx` (modèles « Export PDF ») pour
 * la famille Cartouche : hook de chargement des modèles actifs, sélecteur de
 * modèle, sélecteur format papier / orientation (défaut = ceux du modèle) et
 * champs de saisie pour les slots VARIABLE. La génération elle-même passe par
 * `exportBlueprintPdf` (`lib/print/export-with-cartouche.ts`).
 */

import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "@/components/ui/icons";

import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { EspaceInfo } from "./export-pdf-model-options";
import type {
  CartoucheSlot,
  CartoucheSlotType,
  CartoucheTemplate,
} from "@/lib/print/export-with-cartouche";
import {
  PAPER_SIZES_MM,
  type Orientation,
  type PaperFormat,
  type PrintLayout,
} from "@/lib/services/print-layout";

export type { CartoucheSlot, CartoucheTemplate } from "@/lib/print/export-with-cartouche";

// ── Hook de chargement (modèles Cartouche actifs, triés par sortOrder) ───────

type PrintApiResponse = {
  templates: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    paperFormat: string;
    orientation: string;
    slots: unknown;
    layout: unknown;
    isActive: boolean;
    sortOrder: number;
  }>;
};

const PAPER_FORMATS: PaperFormat[] = ["A4", "A3", "A2", "A1", "A0", "LETTER", "LEGAL"];

function asPaperFormat(v: string): PaperFormat {
  return (PAPER_FORMATS as string[]).includes(v) ? (v as PaperFormat) : "A4";
}

function asOrientation(v: string): Orientation {
  return v === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT";
}

/** Normalise le Json `slots` de l'API en `CartoucheSlot[]` (entrées invalides ignorées). */
function parseSlots(raw: unknown): CartoucheSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: CartoucheSlot[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") continue;
    const type = o.type === "TEXT" || o.type === "VARIABLE" || o.type === "LOGO" ? o.type : null;
    if (!type) continue;
    out.push({
      key: o.key,
      label: o.label,
      type: type as CartoucheSlotType,
      defaultValue: typeof o.defaultValue === "string" ? o.defaultValue : undefined,
      sample: typeof o.sample === "string" ? o.sample : undefined,
    });
  }
  return out;
}

/**
 * Normalise le Json `layout` de l'API : PrintLayout si la forme minimale est
 * là (objet avec `elements` array), sinon null (le pipeline retombera sur le
 * chrome slots).
 */
function parseLayout(raw: unknown): PrintLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.elements)) return null;
  return raw as PrintLayout;
}

export function useCartoucheModels() {
  const [templates, setTemplates] = useState<CartoucheTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [espace, setEspace] = useState<EspaceInfo>({});

  useEffect(() => {
    let alive = true;
    void api
      .get<EspaceInfo>("/api/tenant/espace/informations")
      .then((data) => {
        if (alive) setEspace(data ?? {});
      })
      .catch(() => {
        // Info espace non bloquante — les variables retomberont sur les samples.
      });
    void api
      .get<PrintApiResponse>("/api/tenant/parametres/print")
      .then((data) => {
        if (!alive) return;
        setTemplates(
          (data.templates ?? [])
            .filter((t) => t.isActive)
            .map((t) => ({
              id: t.id,
              key: t.key,
              name: t.name,
              description: t.description,
              paperFormat: asPaperFormat(t.paperFormat),
              orientation: asOrientation(t.orientation),
              slots: parseSlots(t.slots),
              layout: parseLayout(t.layout),
              isActive: t.isActive,
              sortOrder: t.sortOrder,
            }))
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
        );
      })
      .catch((e) => {
        if (!alive) return;
        setTemplatesError(getApiErrorMessage(e));
        setTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { templates, templatesError, espace };
}

// ── buildSlotValues ──────────────────────────────────────────────────────────

/**
 * Valeurs initiales des slots pour un modèle : `overrides[key]` (valeurs
 * projet — nom du projet, date…) sinon `defaultValue`. Les slots sans valeur
 * sont omis : `exportBlueprintPdf` retombe alors sur `sample`.
 */
export function buildSlotValues(
  template: CartoucheTemplate,
  overrides?: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const slot of template.slots) {
    const v = overrides?.[slot.key] ?? slot.defaultValue;
    if (v !== undefined) values[slot.key] = v;
  }
  return values;
}

/**
 * Pré-remplissage des slots VARIABLE depuis le contexte projet : un slot dont
 * la clé/le label évoque le projet reçoit le nom du projet ; le premier slot
 * « titre » (ou, à défaut, le premier slot libre) reçoit le nom de la vue.
 */
export function buildSmartOverrides(
  template: CartoucheTemplate,
  projectName: string,
  viewLabel: string,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  let titleAssigned = false;
  for (const slot of template.slots) {
    if (slot.type !== "VARIABLE") continue;
    const hay = `${slot.key} ${slot.label}`.toLowerCase();
    if (/projet|project|affaire/.test(hay)) {
      overrides[slot.key] = projectName;
    } else if (!titleAssigned && /titre|title|document|vue|plan|dessin/.test(hay)) {
      overrides[slot.key] = viewLabel;
      titleAssigned = true;
    }
  }
  if (!titleAssigned) {
    const free = template.slots.find(
      (s) => s.type === "VARIABLE" && !(s.key in overrides),
    );
    if (free) overrides[free.key] = viewLabel;
  }
  return overrides;
}

// ── CartouchePicker ──────────────────────────────────────────────────────────

export function CartouchePicker({
  templates,
  templatesError,
  selectedId,
  onSelect,
  leading,
  compact = false,
}: {
  templates: CartoucheTemplate[] | null;
  templatesError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Entrée supplémentaire présentée AVANT les modèles de l'espace (« Modèle
   * standard » de l'export Rack). Elle vit dans la même liste pour que le
   * choix reste un choix unique, sous un seul intitulé.
   */
  leading?: ReactNode;
  /**
   * Présentation compacte : pastilles sur une ligne (qui passe à la ligne au
   * besoin), nom seul. Le format papier et l'orientation disent déjà ce que la
   * description répétait ; sur un panneau où le choix de modèle n'est qu'un
   * réglage parmi d'autres, la liste verticale prenait toute la place.
   */
  compact?: boolean;
}) {
  const message = templatesError ? (
    // arkyo-server: habillage Strata (texte d'erreur : --danger-text, --destructive descend sous 4,5:1)
    <p className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-2 py-1.5 text-[10px] text-[var(--danger-text)]">
      {templatesError}
    </p>
  ) : templates === null ? (
    <p className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]">
      Chargement des modèles…
    </p>
  ) : templates.length === 0 && !leading ? (
    <p className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]">
      Aucun modèle actif — à créer dans Paramètres › Impression.
    </p>
  ) : null;

  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Modèle
      </p>
      <div className={compact ? "flex flex-wrap gap-1" : "flex flex-col gap-1"}>
        {leading}
        {message ??
          (templates ?? []).map((t) =>
            compact ? (
              <TemplateChip
                key={t.id}
                label={t.name}
                active={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            ) : (
              <TemplateRow
                key={t.id}
                label={t.name}
                description={
                  t.description ||
                  `${t.paperFormat} ${t.orientation === "LANDSCAPE" ? "paysage" : "portrait"}`
                }
                active={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            ),
          )}
      </div>
    </div>
  );
}

/**
 * Pastille de modèle — pendant compact de `TemplateRow`. Exportée pour que
 * l'entrée `leading` d'un picker compact ait exactement la même apparence.
 */
export function TemplateChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
        active
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
          : "border-[var(--border)]/60 text-[var(--foreground)] hover:bg-[var(--secondary)]/40",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Ligne de modèle. Exportée pour les onglets qui présentent une entrée
 * SUPPLÉMENTAIRE au-dessus des modèles de l'espace (« Modèle standard » de
 * l'export Rack) : elle doit avoir exactement la même apparence.
 */
export function TemplateRow({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
        active
          ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
          : "border-[var(--border)]/60 hover:bg-[var(--secondary)]/40",
      )}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]",
        )}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "truncate text-[11px] font-semibold",
            // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
            active ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="truncate text-[9px] text-[var(--muted-foreground)]">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

// ── CartouchePaperOptions — format papier + orientation ─────────────────────

const FORMAT_LABEL: Record<PaperFormat, string> = {
  A4: "A4",
  A3: "A3",
  A2: "A2",
  A1: "A1",
  A0: "A0",
  LETTER: "Letter",
  LEGAL: "Legal",
};

export function CartouchePaperOptions({
  paperFormat,
  onPaperFormatChange,
  orientation,
  onOrientationChange,
  formats,
}: {
  paperFormat: PaperFormat;
  onPaperFormatChange: (f: PaperFormat) => void;
  orientation: Orientation;
  onOrientationChange: (o: Orientation) => void;
  /**
   * Formats proposés. Par défaut tous — un onglet peut restreindre la liste
   * (l'export Rack ne propose que la série A : une planche d'élévations est un
   * plan, pas une lettre). La grille tient sur une ligne.
   */
  formats?: readonly PaperFormat[];
}) {
  const shown = formats ?? PAPER_FORMATS;
  // Liste restreinte → une seule ligne. Liste complète → grille de 4, mise en
  // page historique des autres onglets, qu'on ne bouscule pas.
  const cols = formats ? shown.length : 4;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Format papier
        </p>
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
        >
          {shown.map((f) => {
            const dims =
              orientation === "LANDSCAPE"
                ? `${PAPER_SIZES_MM[f].h}×${PAPER_SIZES_MM[f].w}`
                : `${PAPER_SIZES_MM[f].w}×${PAPER_SIZES_MM[f].h}`;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onPaperFormatChange(f)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border py-2 text-xs font-semibold transition-all",
                  paperFormat === f
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40",
                )}
              >
                <span className="text-xs font-bold">{FORMAT_LABEL[f]}</span>
                <span className="text-[8px] font-normal opacity-70">{dims}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Orientation
        </p>
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              ["PORTRAIT", "Portrait"],
              ["LANDSCAPE", "Paysage"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onOrientationChange(value)}
              className={cn(
                "flex items-center justify-center gap-1 rounded-lg border py-2 text-xs font-semibold transition-all",
                orientation === value
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── CartoucheSlotFields — saisie des slots VARIABLE ─────────────────────────

export function CartoucheSlotFields({
  template,
  values,
  onChange,
}: {
  template: CartoucheTemplate;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const variables = template.slots.filter((s) => s.type === "VARIABLE");
  if (variables.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Champs
      </p>
      {variables.map((slot) => (
        <label key={slot.key} className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-[var(--muted-foreground)]">
            {slot.label}
          </span>
          <input
            value={values[slot.key] ?? ""}
            onChange={(e) => onChange(slot.key, e.target.value)}
            placeholder={slot.sample ?? ""}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 text-xs focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
          />
        </label>
      ))}
    </div>
  );
}
