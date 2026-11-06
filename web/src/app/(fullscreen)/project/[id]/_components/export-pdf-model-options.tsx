"use client";

/**
 * export-pdf-model-options — briques partagées pour l'option « modèle
 * d'impression » (cartouche) du format PDF dans `ExportMenu`.
 *
 * Réplique 1:1 le sélecteur validé sur l'Inventaire (`inventaire-export.tsx`)
 * sans le modifier : hook de chargement des modèles + info espace, plus les
 * composants d'UI `PdfModelPicker` et `PageSelector`. Utilisé par les onglets
 * visuels (Synoptique, Cartographie) pour l'export PDF via `exportPdfWithModel`.
 */

import { useEffect, useState } from "react";
import { FileText } from "@/components/ui/icons";

import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { PrintLayout } from "@/lib/services/print-layout";

// ── Types ────────────────────────────────────────────────────────────────────

export type PrintExportPageKind = "COVER" | "INTERIOR" | "BACK";

export const PAGE_KIND_ORDER: PrintExportPageKind[] = ["COVER", "INTERIOR", "BACK"];

export const PAGE_KIND_LABEL: Record<PrintExportPageKind, string> = {
  COVER: "Page de garde",
  INTERIOR: "Intérieur",
  BACK: "Page de fin",
};

export type PrintExportModelLite = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  pages: { id: string; kind: PrintExportPageKind; layout: PrintLayout | null }[];
};

export type EspaceInfo = { name?: string | null; logoUrl?: string | null };

// ── Hook de chargement (modèles actifs + info espace) ────────────────────────

export function useExportModels() {
  const [models, setModels] = useState<PrintExportModelLite[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [espace, setEspace] = useState<EspaceInfo>({});

  useEffect(() => {
    let alive = true;
    void api
      .get<PrintExportModelLite[]>("/api/tenant/parametres/print/export-models")
      .then((data) => alive && setModels(data.filter((m) => m.isActive)))
      .catch((e) => {
        if (!alive) return;
        setModelsError(getApiErrorMessage(e));
        setModels([]);
      });
    void api
      .get<EspaceInfo>("/api/tenant/espace/informations")
      .then((d) => alive && setEspace(d))
      .catch(() => {
        /* silencieux */
      });
    return () => {
      alive = false;
    };
  }, []);

  return { models, modelsError, espace };
}

/** Variables de base `{namespace.field}` interpolées dans les layouts modèle. */
export function buildBaseOverrides(input: {
  projectName: string;
  espace: EspaceInfo;
  stamp: string;
  extra?: Record<string, string | null | undefined>;
}): Record<string, string | null | undefined> {
  const { projectName, espace, stamp, extra } = input;
  return {
    "{projet.nom}": projectName,
    "{espace.nom}": espace.name ?? null,
    "{espace.logo}": espace.logoUrl ?? null,
    "{date.iso}": stamp,
    "{date.long}": new Date(stamp).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    "{date.year}": stamp.slice(0, 4),
    ...(extra ?? {}),
  };
}

// ── PdfModelPicker ───────────────────────────────────────────────────────────

export function PdfModelPicker({
  models,
  modelsError,
  selectedModelId,
  onSelect,
  noModelLabel = "Sans modèle",
  noModelDescription = "Page A4 simple, sans habillage",
}: {
  models: PrintExportModelLite[] | null;
  modelsError: string | null;
  selectedModelId: string | null;
  onSelect: (id: string | null) => void;
  noModelLabel?: string;
  noModelDescription?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Modèle
      </p>
      <div className="flex flex-col gap-1">
        <ModelRow
          label={noModelLabel}
          description={noModelDescription}
          active={selectedModelId === null}
          onClick={() => onSelect(null)}
        />
        {modelsError ? (
          // arkyo-server: habillage Strata (texte d'erreur : --danger-text, --destructive descend sous 4,5:1)
          <p className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-2 py-1.5 text-[10px] text-[var(--danger-text)]">
            {modelsError}
          </p>
        ) : models === null ? (
          <p className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]">
            Chargement des modèles…
          </p>
        ) : (
          models.map((m) => (
            <ModelRow
              key={m.id}
              label={m.name}
              description={m.description}
              active={m.id === selectedModelId}
              onClick={() => onSelect(m.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ModelRow({
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

// ── PageSelector ─────────────────────────────────────────────────────────────

export function PageSelector({
  available,
  selected,
  onToggle,
}: {
  available: PrintExportPageKind[];
  selected: Set<PrintExportPageKind>;
  onToggle: (k: PrintExportPageKind) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Pages à inclure
      </p>
      <div className="flex flex-col gap-1">
        {available.map((kind) => {
          const checked = selected.has(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onToggle(kind)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                checked
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                  : "border-[var(--border)]/60 hover:bg-[var(--secondary)]/40",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                  checked
                    // arkyo-server: habillage Strata (coche sur l'accent plein : --accent-foreground)
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                    : "border-[var(--border)]",
                )}
              >
                {checked && (
                  <svg
                    viewBox="0 0 12 12"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="2.5 6.5 5 9 9.5 3.5" />
                  </svg>
                )}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  checked ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
                )}
              >
                {PAGE_KIND_LABEL[kind]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Poster (grand format) — options d'export « plan » A0→A4 ──────────────────
//
// Portées depuis l'ancien `SynopticPdfExportDialog` (désormais réservé au
// rack-editor). Ces briques alimentent le mode « Grand format » du format PDF
// dans `ExportMenu` : format papier et révision. Le CADRAGE ne se règle plus
// ici : il se fait à la main sur l'aperçu, qui est la page. La génération
// elle-même reste côté canvas (`synopticRef.exportPdf`).

export type PosterFormat = "A0" | "A1" | "A2" | "A3" | "A4";
export type PosterKind = "pdf" | "png";
/**
 * Nature du rendu du plan. `vector` envoie les couches de scène au PDF en
 * objets (trait, texte, cartouche), `raster` pose une image. L'option existe
 * parce que le vectoriel reste jeune : c'est la porte de sortie si un document
 * sort mal, sans attendre un correctif.
 */
export type PosterRender = "raster" | "vector";

const POSTER_FORMATS: PosterFormat[] = ["A0", "A1", "A2", "A3", "A4"];
const POSTER_DIMS: Record<PosterFormat, string> = {
  A0: "1189×841",
  A1: "841×594",
  A2: "594×420",
  A3: "420×297",
  A4: "297×210",
};
export function PosterExportOptions({
  kind,
  format,
  onFormatChange,
  render,
  onRenderChange,
  revision,
  onRevisionChange,
  showRevision = false,
}: {
  kind: PosterKind;
  format: PosterFormat;
  onFormatChange: (f: PosterFormat) => void;
  render: PosterRender;
  onRenderChange: (r: PosterRender) => void;
  revision: string;
  onRevisionChange: (r: string) => void;
  /**
   * La révision n'apparaît que sur les cartouches qui la consomment — le
   * chrome de secours d'un modèle de l'espace. Le cartouche intégré ne
   * l'imprime pas : proposer le champ y serait un réglage sans effet.
   */
  showRevision?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Le type de sortie n'est PAS répété ici : il est déjà porté par le
          sélecteur de format du modal (PDF / Image). Deux choix pour la même
          décision se contredisaient à l'écran. */}

      {/* Format papier — PDF uniquement */}
      {kind === "pdf" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Format papier — paysage
          </p>
          <div className="grid grid-cols-5 gap-1">
            {POSTER_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFormatChange(f)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border py-2 text-xs font-semibold transition-all",
                  format === f
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40",
                )}
              >
                <span className="text-xs font-bold">{f}</span>
                <span className="text-[8px] font-normal opacity-70">
                  {POSTER_DIMS[f]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Le CADRAGE ne se règle plus ici. Il se fait sur l'aperçu, molette et
          glisser, avec « Ajuster » / « Centrer ». Un réglage de périmètre
          décidait à la place de l'utilisateur ce que le document montre. */}

      {/* Rendu — PDF uniquement */}
      {kind === "pdf" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Rendu
          </p>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["vector", "Vectoriel"],
                ["raster", "Image"],
              ] as ReadonlyArray<readonly [PosterRender, string]>
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => onRenderChange(v)}
                className={cn(
                  "rounded-lg border py-2 text-xs font-semibold transition-all",
                  render === v
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
      )}

      {/* Révision — seulement si le cartouche choisi l'imprime. */}
      {kind === "pdf" && showRevision && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Révision
          </p>
          <input
            value={revision}
            onChange={(e) => onRevisionChange(e.target.value)}
            placeholder="A, B, 1.2…"
            maxLength={20}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 text-xs focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
          />
        </div>
      )}
    </div>
  );
}
