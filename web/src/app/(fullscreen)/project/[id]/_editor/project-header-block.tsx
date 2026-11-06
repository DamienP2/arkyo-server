"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Briefcase, Calendar, Check, ChevronDown, MapPin } from "@/components/ui/icons";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

export type ProjectStatus = "EN_PREPARATION" | "PRET" | "EN_COURS" | "TERMINE" | "ANNULE";
export type InterventionType = "PRESTATION" | "INTEGRATION";
export type RigType = "FLIGHT_CASE" | "CAR" | "FIXED_INSTALL" | "MIXED" | null;

export type ProjectHeaderData = {
  id: string;
  name: string;
  status: ProjectStatus;
  interventionType: InterventionType;
  rigType: RigType;
  clientName: string | null;
  shootingDate: string | null;
  location: string | null;
  prestationType: string | null;
};

// ── Badge mappings ─────────────────────────────────────────────────────────

const STATUS_BADGE: Record<ProjectStatus, { label: string; cls: string }> = {
  EN_PREPARATION: { label: "En préparation", cls: "text-amber-600 bg-amber-500/10" },
  PRET: { label: "Prêt", cls: "text-emerald-600 bg-emerald-500/10" },
  EN_COURS: { label: "En cours", cls: "text-indigo-600 bg-indigo-500/10" },
  TERMINE: { label: "Terminé", cls: "text-slate-500 bg-slate-500/10" },
  ANNULE: { label: "Annulé", cls: "text-red-500 bg-red-500/10" },
};

const STATUS_ACCENT: Record<ProjectStatus, string> = {
  EN_PREPARATION: "#f59e0b",
  PRET: "#10b981",
  EN_COURS: "#6366f1",
  TERMINE: "#64748b",
  ANNULE: "#ef4444",
};

/**
 * Liste ordonnée des statuts utilisés par le menu interactif (header) ainsi
 * que par les autres écrans (single source of truth).
 */
export const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "EN_PREPARATION", label: "En préparation" },
  { value: "PRET", label: "Prêt" },
  { value: "EN_COURS", label: "En cours" },
  { value: "TERMINE", label: "Terminé" },
  { value: "ANNULE", label: "Annulé" },
];

const INTERVENTION_LABEL: Record<InterventionType, string> = {
  PRESTATION: "Prestation",
  INTEGRATION: "Intégration",
};

const RIG_TYPE_LABEL: Record<NonNullable<RigType>, string> = {
  FLIGHT_CASE: "Flight cases",
  CAR: "Car régie",
  FIXED_INSTALL: "Installation fixe",
  MIXED: "Mixte",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return format(new Date(iso), "d MMMM yyyy", { locale: fr });
  } catch {
    return iso;
  }
}

/**
 * Bandeau enrichi en HEADER de l'éditeur projet — pattern aligné sur
 * `TenantHeaderBlock` :
 *  - Pictogramme carré coloré selon le statut
 *  - Nom du projet + badges (statut interactif, type d'intervention, type de régie)
 *  - Sous-ligne client (mono)
 *  - Meta secondaire : date, lieu, type de prestation
 *
 * Le badge statut devient un trigger DropdownMenu (Radix) — au clic d'un item,
 * `onStatusChange(status)` est invoqué. Le caller gère l'optimistic update et
 * le rollback éventuel.
 */
export function ProjectHeaderBlock({
  project,
  onStatusChange,
}: {
  project: ProjectHeaderData;
  onStatusChange?: (status: ProjectStatus) => Promise<void> | void;
}) {
  const statusBadge = STATUS_BADGE[project.status];
  const accent = STATUS_ACCENT[project.status];

  return (
    <header className="flex shrink-0 items-center gap-5 border-b border-[var(--border)]/60 px-8 py-4">
      {/* Pictogramme carré tinté selon le statut */}
      <div
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${accent}1a`, color: accent }}
        aria-hidden
      >
        <Briefcase className="h-7 w-7" strokeWidth={1.5} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Titre + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-lg leading-tight font-semibold">{project.name}</h1>

          {onStatusChange ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    statusBadge.cls,
                  )}
                  aria-label={`Statut : ${statusBadge.label} — modifier`}
                >
                  {statusBadge.label}
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
                    const isCurrent = opt.value === project.status;
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
                          style={{ background: STATUS_ACCENT[opt.value] }}
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
          ) : (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                statusBadge.cls,
              )}
            >
              {statusBadge.label}
            </span>
          )}

          <span
            className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {INTERVENTION_LABEL[project.interventionType]}
          </span>
          {project.rigType && (
            <span
              className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {RIG_TYPE_LABEL[project.rigType]}
            </span>
          )}
        </div>

        {/* Sous-ligne client */}
        {project.clientName && (
          <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">
            {project.clientName}
          </p>
        )}

        {/* Meta secondaire */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
          {project.shootingDate && (
            <>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(project.shootingDate)}
              </span>
              {(project.location || project.prestationType) && <span className="opacity-50">·</span>}
            </>
          )}
          {project.location && (
            <>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {project.location}
              </span>
              {project.prestationType && <span className="opacity-50">·</span>}
            </>
          )}
          {project.prestationType && <span>{project.prestationType}</span>}
        </div>
      </div>
    </header>
  );
}
