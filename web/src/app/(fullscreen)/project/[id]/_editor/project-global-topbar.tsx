"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Download,
  Settings2,
  X,
} from "@/components/ui/icons";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils";
import { StrataBrand } from "@/components/brand/strata-brand"; // arkyo-server: habillage Strata
import { useInterface } from "@/strata/interface-context"; // arkyo-server: interface Strata
import { StrataProjectTopbar } from "@/strata/shell/strata-project-topbar"; // arkyo-server: interface Strata

import {
  STATUS_OPTIONS,
  type ProjectStatus,
} from "./project-header-block";

// Couleurs/labels par statut — version courte alignée sur l'esprit dark de la
// topbar globale (texte clair sur fond foncé, accent coloré discret).
const STATUS_META: Record<
  ProjectStatus,
  { label: string; color: string }
> = {
  EN_PREPARATION: { label: "En préparation", color: "#f59e0b" },
  PRET: { label: "Prêt", color: "#3b82f6" },
  EN_COURS: { label: "En cours", color: "#10b981" },
  TERMINE: { label: "Terminé", color: "#64748b" },
  ANNULE: { label: "Annulé", color: "#ef4444" },
};

// arkyo-server: habillage Strata — pictogramme `ArkyoPicto` retiré, le lockup
// est `StrataBrand` (comme components/layout/topbar.tsx).

// ── Component ────────────────────────────────────────────────────────────────

export interface ProjectGlobalTopbarProps {
  projectName: string;
  tenantName: string | null;
  /** Statut projet courant (affiché en dropdown après le nom). */
  status?: ProjectStatus;
  /** Callback de changement de statut. Si absent, le dropdown est désactivé. */
  onStatusChange?: (next: ProjectStatus) => Promise<void> | void;
  /**
   * Ouvre le dialog « Caractéristiques du projet » (rendu côté éditeur).
   * Si absent, l'icône d'édition n'est pas affichée.
   */
  onEditCharacteristics?: () => void;
  /**
   * Ouvre le modal d'export du projet (dossier complet ou document seul).
   * Absent → pas de bouton.
   */
  onExport?: () => void;
  /** Onglets pill rendus à cheval sur la séparation topbar/contenu. */
  tabs?: ReactNode;
  /** Action `X` (fermer le mode édition) — discrète en haut-droite. */
  onClose: () => void;
}

/**
 * Topbar globale du mode édition projet — pattern aligné sur la topbar
 * standard de l'app (`components/layout/topbar.tsx`) : lockup `arkyo.io |
 * Tenant` à gauche, nom projet, pill onglets à droite.
 *
 * Notes :
 *  - Statut + badges intervention/régie ont été déplacés dans le panel droit.
 *  - Indicateur de sauvegarde + bouton FERMER ÉDITION ont été déplacés dans
 *    la sous-topbar (`ProjectContextualTopbar`).
 */
export function ProjectGlobalTopbar({
  projectName,
  tenantName,
  status,
  onStatusChange,
  onEditCharacteristics,
  onExport,
  tabs,
  onClose,
}: ProjectGlobalTopbarProps) {
  // arkyo-server: interface Strata — topbar à onglets segmentés, mêmes props (et couleurs de statut).
  const ui = useInterface();
  if (ui === "strata") return <StrataProjectTopbar {...{ projectName, tenantName, status, onStatusChange, onEditCharacteristics, onExport, tabs, onClose }} statusMeta={STATUS_META} />;
  const statusMeta = status ? STATUS_META[status] : null;
  return (
    // arkyo-server: habillage Strata (topbar claire ou sombre selon le thème, comme la topbar principale)
    <div className="relative flex h-full items-center gap-3 bg-[var(--surface)] px-3 text-[11px] text-[var(--muted-foreground)]">
      {/* Lockup Strata Arkyo | TenantName (arkyo-server: habillage Strata) */}
      <Link
        href="/dashboard"
        className="group flex shrink-0 items-center gap-2.5 transition-all"
        title={tenantName ? `Espace ${tenantName}` : "Accueil"}
      >
        {/* arkyo-server: habillage Strata */}
        <StrataBrand />
        {tenantName && (
          <>
            {/* arkyo-server: habillage Strata */}
            <span className="text-[13px] text-[var(--border-strong)]">|</span>
            <span className="text-[13px] font-medium text-[var(--text-tertiary)]">
              {tenantName}
            </span>
          </>
        )}
      </Link>

      {/* Nom projet */}
      <div className="ml-2 flex min-w-0 items-center gap-3 text-[11px]">
        {/* arkyo-server: habillage Strata */}
        <span className="truncate text-[13px] font-bold uppercase text-[var(--foreground)]">
          {projectName}
        </span>

        {/* Icône d'édition des caractéristiques — entre le nom et le statut. */}
        {onEditCharacteristics && (
          <button
            type="button"
            onClick={onEditCharacteristics}
            title="Modifier les caractéristiques du projet"
            aria-label="Modifier les caractéristiques du projet"
            // arkyo-server: habillage Strata
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-95"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Dropdown statut — background plein à la couleur du statut pour
            une lecture immédiate sur la topbar sombre. */}
        {statusMeta && onStatusChange && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                // arkyo-server: habillage Strata (anneau de focus : --ring ; fond et texte blanc = couleur du statut, métier)
                className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-white outline-none transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                aria-label={`Statut : ${statusMeta.label} — modifier`}
                style={{
                  fontFamily: "var(--font-mono)",
                  background: statusMeta.color,
                }}
              >
                {statusMeta.label}
                <ChevronDown className="ml-0.5 h-3 w-3" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-50 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-md"
              >
                {STATUS_OPTIONS.map((opt) => {
                  const meta = STATUS_META[opt.value];
                  const isCurrent = opt.value === status;
                  return (
                    <DropdownMenu.Item
                      key={opt.value}
                      onSelect={(e) => {
                        e.preventDefault();
                        if (isCurrent) return;
                        void onStatusChange(opt.value);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                        "data-[highlighted]:bg-[var(--secondary)]/60 data-[highlighted]:text-[var(--foreground)]",
                        isCurrent && "font-medium",
                      )}
                    >
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: meta.color }}
                      />
                      <span className="flex-1 truncate">{opt.label}</span>
                      {isCurrent && (
                        <Check className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      )}
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

      </div>

      <div className="flex-1" />

      {/* Tabs pill — entièrement dans la topbar (plus à cheval). */}
      {tabs && <div className="relative z-30 shrink-0">{tabs}</div>}

      {/* Export du projet — après les onglets, avant la fermeture : c'est une
          action de SORTIE du projet, elle vit avec elles. Volontairement
          sobre : le statut reste le seul élément coloré de la topbar. */}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          title="Exporter un dossier"
          // arkyo-server: habillage Strata
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)] outline-none transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <Download className="h-3 w-3" />
          Exporter un dossier
        </button>
      )}

      {/* Bouton fermeture — croix discrète en haut-droite (pattern modal web) */}
      <button
        type="button"
        onClick={onClose}
        title="Fermer l'édition"
        aria-label="Fermer l'édition"
        // arkyo-server: habillage Strata
        className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors duration-150 hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-95"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
