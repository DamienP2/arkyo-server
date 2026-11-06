"use client";

/**
 * TemplateSelector — grille des Rack templates instanciables.
 *
 * Utilisé dans le dialog "Ajouter un contenant" (mode "Choisir un template").
 * Récupère la liste depuis `GET /api/tenant/racks?templates=true` au montage,
 * affiche une grille filtrable par nom (recherche), et appelle `onSelect` avec
 * l'id du Rack template choisi.
 *
 * Spec : 6.1.c + 6.2 — `2026-05-08-inventaire-bom-templates-design.md`.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "@/components/ui/icons";

import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ────────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

export type TemplateRack = {
  id: string;
  name: string;
  rackType: RackType;
  totalU: number;
  depthMm: number;
  hasWheels: boolean;
  slotsCount: number;
};

const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: 'Baie standard 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_IMAGE: Record<RackType, string> = {
  STANDARD: "/containers/baie.png",
  FLIGHT_CASE_CLASSIC: "/containers/flightcase_rack-roulettes.png",
  FLIGHT_CASE_SKB: "/containers/SKB.png",
  PELICAN: "/containers/pelicase.png",
  CAP: "/containers/casquette_meuble.png",
};

const RACK_TYPE_RACKABLE: Record<RackType, boolean> = {
  STANDARD: true,
  FLIGHT_CASE_CLASSIC: true,
  FLIGHT_CASE_SKB: true,
  PELICAN: false,
  CAP: false,
};

// ── Component ────────────────────────────────────────────────────────────────

export function TemplateSelector({
  onSelect,
  selectedId,
  disabled,
}: {
  onSelect: (rackTemplateId: string) => void;
  selectedId?: string | null;
  disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<TemplateRack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        type Resp = { racks: TemplateRack[] } | TemplateRack[];
        const res = await api.get<Resp>("/api/tenant/racks?templates=true");
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res.racks;
        setTemplates(list);
      } catch (e) {
        if (cancelled) return;
        setError(getApiErrorMessage(e));
        setTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!templates) return [];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, search]);

  if (templates === null) {
    return (
      <LoadingState label="Chargement des templates…" className="py-12" />
    );
  }

  if (error && templates.length === 0) {
    return (
      <p
        role="alert"
        // arkyo-server: habillage Strata
        className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-3 text-sm text-[var(--danger-text)]"
      >
        {error}
      </p>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">Aucun template disponible</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Créez un template depuis la page Templates ou utilisez l&apos;onglet « Créer un nouveau ».
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un template…"
          className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 pl-8 text-sm focus:border-[var(--accent)] focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--border)]"
            title="Effacer"
          >
            <X className="h-3 w-3 text-[var(--muted-foreground)]" />
          </button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">Aucun résultat.</p>
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]/70">
            Seuls les modèles au statut Actif apparaissent ici — modifiable
            depuis l&apos;éditeur du modèle.
          </p>
        </div>
      ) : (
        <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(t.id)}
              className={cn(
                "group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50",
                selectedId === t.id
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)]/40",
              )}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1 dark:bg-white/95">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={RACK_TYPE_IMAGE[t.rackType]}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{t.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
                  {RACK_TYPE_LABEL[t.rackType]}
                </p>
                <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[var(--muted-foreground)] tabular-nums">
                  {RACK_TYPE_RACKABLE[t.rackType] && (
                    <>
                      <span className="rounded bg-[var(--secondary)] px-1 py-0.5">
                        {t.totalU}U
                      </span>
                      <span>·</span>
                    </>
                  )}
                  <span>{t.depthMm} mm</span>
                  <span>·</span>
                  <span>{t.slotsCount} eq.</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
