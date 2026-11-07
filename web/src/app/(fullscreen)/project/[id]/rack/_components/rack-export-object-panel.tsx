"use client";

/**
 * RackExportObjectPanel — réglages de l'objet sélectionné, dans la colonne de
 * réglages du modal d'export.
 *
 * L'ajout et l'édition suivent le MÊME parcours — nature, cible, vue(s), mode —
 * parce que c'est le même acte : on pose d'abord un emplacement vide, puis on
 * le renseigne. Le panneau n'a donc pas de « mode création » distinct ; un
 * objet non configuré est simplement un objet dont la cible est vide.
 *
 * Différence entre les deux natures, imposée par le rendu :
 *  - **contenant** : vues CUMULABLES, déployées côte à côte ;
 *  - **lieu** : vue UNIQUE, le lieu déployant déjà ses contenants côte à côte.
 *    Cumuler produirait une grille à deux dimensions illisible.
 */

import { useMemo, useState, type ReactNode } from "react";

import {
  Copy,
  Crosshair,
  Maximize2,
  Search,
  Trash2,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/components/synoptique/lib/types";

import {
  RACK_EXPORT_VIEWS,
  type RackExportItem,
} from "./rack-export-layout";
import type { RackRenderMode } from "./rack-export-stage";
import { RENDER_MODES } from "./rack-tab-left-toolbar";
import type {
  RackExportContainer,
  RackExportLocation,
} from "./rack-export-composer";

/** Au-delà, la liste des cibles gagne un champ de recherche. */
const SEARCH_THRESHOLD = 8;

export type ObjectPatch =
  | { kind: "rack"; rackId: string; views: ViewId[] }
  | { kind: "location"; locationId: string; view: ViewId }
  | { renderMode: RackRenderMode }
  | { label: string };

/**
 * Rangée d'actions commune à la sélection unique et multiple. Elle vit ICI et
 * nulle part ailleurs : disperser les commandes entre une barre flottante sur
 * le dessin et un panneau obligeait à chercher où agir.
 */
export function RackExportSelectionActions({
  onDuplicate,
  onCenter,
  onReset,
  onRemove,
}: {
  onDuplicate: () => void;
  /** Centre la vue — ou la boîte du groupe — dans la zone de composition. */
  onCenter: () => void;
  /** `null` en sélection multiple : la taille d'origine est individuelle. */
  onReset: (() => void) | null;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <ActionButton onClick={onDuplicate}>
        <Copy className="h-3 w-3 shrink-0" />
        Dupliquer
      </ActionButton>
      <ActionButton onClick={onCenter}>
        <Crosshair className="h-3 w-3 shrink-0" />
        Centrer
      </ActionButton>
      {onReset && (
        <ActionButton onClick={onReset}>
          <Maximize2 className="h-3 w-3 shrink-0" />
          Taille d&apos;origine
        </ActionButton>
      )}
      <ActionButton danger onClick={onRemove}>
        <Trash2 className="h-3 w-3 shrink-0" />
        Supprimer
      </ActionButton>
    </div>
  );
}

function ActionButton({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[10px] font-semibold transition-colors",
        danger
          // arkyo-server: habillage Strata (texte d'erreur : --danger-text)
          ? "border-[var(--destructive)]/40 text-[var(--danger-text)] hover:bg-[var(--destructive)]/10"
          : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

export function RackExportObjectPanel({
  item,
  containers,
  locations,
  fallbackRenderMode,
  onChange,
}: {
  item: RackExportItem;
  containers: RackExportContainer[];
  locations: RackExportLocation[];
  /** Mode de l'onglet — celui qu'une vue sans mode propre affiche. */
  fallbackRenderMode: RackRenderMode;
  onChange: (patch: ObjectPatch) => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * Nature retenue pour un objet PAS ENCORE configuré. Elle ne peut pas vivre
   * dans le modèle : tant qu'aucune cible n'est choisie, l'objet reste un
   * emplacement vide — c'est ce qui le tient hors de l'export.
   */
  const [pendingKind, setPendingKind] = useState<"rack" | "location">("rack");

  const kind: "rack" | "location" =
    item.kind === "placeholder" ? pendingKind : item.kind;

  const targetId =
    item.kind === "rack"
      ? item.rackId
      : item.kind === "location"
        ? item.locationId
        : null;

  const views: ViewId[] =
    item.kind === "rack"
      ? item.views
      : item.kind === "location"
        ? [item.view]
        : [];

  const renderMode = item.renderMode ?? fallbackRenderMode;

  /**
   * Entête que le document afficherait sans libellé. Sert d'invite au champ :
   * l'utilisateur voit ce qu'il remplace avant de le remplacer.
   */
  const autoHeader = useMemo(() => {
    if (!targetId) return "Nom automatique";
    const source = kind === "location" ? locations : containers;
    return source.find((r) => r.id === targetId)?.name ?? "Nom automatique";
  }, [kind, targetId, locations, containers]);

  const rows = useMemo(() => {
    const source: Array<{ id: string; name: string; count?: number }> =
      kind === "location"
        ? locations.map((l) => ({
            id: l.id,
            name: l.name,
            count: l.rackIds.length,
          }))
        : containers;
    const q = query.trim().toLowerCase();
    return q ? source.filter((r) => r.name.toLowerCase().includes(q)) : source;
  }, [kind, query, locations, containers]);

  /**
   * Changer de nature vide la cible : un identifiant de contenant n'a aucun
   * sens dans la liste des lieux. L'objet redevient donc un emplacement vide,
   * ce que le composeur traduit en `placeholder`.
   */
  const switchKind = (next: "rack" | "location") => {
    if (next === kind) return;
    setQuery("");
    setPendingKind(next);
    onChange(
      next === "rack"
        ? { kind: "rack", rackId: "", views: views.length ? views : ["FRONT"] }
        : { kind: "location", locationId: "", view: views[0] ?? "FRONT" },
    );
  };

  const pickTarget = (id: string) => {
    onChange(
      kind === "rack"
        ? { kind: "rack", rackId: id, views: views.length ? views : ["FRONT"] }
        : { kind: "location", locationId: id, view: views[0] ?? "FRONT" },
    );
  };

  /**
   * Bascule d'une vue. Sur un contenant les vues s'accumulent — mais jamais
   * jusqu'à zéro : un objet sans vue n'aurait rien à montrer.
   */
  const toggleView = (view: ViewId) => {
    if (!targetId) return;
    if (kind === "location") {
      onChange({ kind: "location", locationId: targetId, view });
      return;
    }
    const next = views.includes(view)
      ? views.filter((v) => v !== view)
      : [...RACK_EXPORT_VIEWS.map((v) => v.id)].filter(
          (v) => views.includes(v) || v === view,
        );
    if (next.length === 0) return;
    onChange({ kind: "rack", rackId: targetId, views: next });
  };

  return (
    <div className="space-y-3">
      {/* 1 — Nature. */}
      <div className="grid grid-cols-2 gap-1">
        {(
          [
            ["rack", "Contenant"],
            ["location", "Emplacement"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
              kind === k
                // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                : "border-[var(--border)]/60 text-[var(--foreground)] hover:bg-[var(--secondary)]/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 2 — Cible. */}
      {(kind === "rack" ? containers : locations).length > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher"
            className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--background)] pr-2 pl-7 text-[11px] focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
          />
        </div>
      )}
      <div className="border-border/60 max-h-[180px] overflow-auto rounded-md border p-1">
        {rows.length === 0 ? (
          <p className="px-1 py-2 text-[10px] text-[var(--muted-foreground)]">
            {kind === "location"
              ? "Aucun emplacement avec un contenant rackable."
              : "Aucun contenant."}
          </p>
        ) : (
          rows.map((row) => {
            const active = targetId === row.id;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => pickTarget(row.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors",
                  active
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    ? "bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                    : "hover:bg-[var(--secondary)]/40",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {row.name}
                </span>
                {row.count != null && (
                  <span
                    className="shrink-0 text-[9px] text-[var(--muted-foreground)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {row.count}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* 3 — Vue(s). */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {kind === "rack" ? "Vues" : "Vue"}
        </p>
        <div className="grid grid-cols-4 gap-1">
          {RACK_EXPORT_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={!targetId}
              onClick={() => toggleView(v.id)}
              className={cn(
                "rounded-md border py-1 text-[10px] font-semibold transition-colors",
                views.includes(v.id)
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
                !targetId && "cursor-not-allowed opacity-30",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 — Rendu. */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Rendu
        </p>
        <div className="grid grid-cols-3 gap-1">
          {RENDER_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.label}
              onClick={() => onChange({ renderMode: m.id })}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md border py-1 text-[10px] font-semibold transition-colors",
                renderMode === m.id
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
              )}
            >
              <m.icon className="h-3 w-3 shrink-0" />
              {m.short}
            </button>
          ))}
        </div>
      </div>

      {/* 5 — Libellé imprimé. */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Libellé
        </p>
        <input
          value={item.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={autoHeader}
          className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] focus-visible:ring-1 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
        />
      </div>
    </div>
  );
}
