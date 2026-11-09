"use client";

/**
 * Catalogue › Modèles (Strata v2, spec v2 §7 « Modèles (contenants, régies,
 * panels, éditeur de panel) ») : les pages existantes des modèles, atteintes
 * d'ici. Elles ne sont pas refaites : Contenants et Panels sont les onglets
 * de `/templates` d'arkyo (avec la régie `/rigs/:id` et l'éditeur de panel
 * `/panels/:id`), Dossiers reste le bouchon de la phase 6, comme en
 * Classique. Même permission que le rail Classique (`design:read`).
 *
 * Les nombres de modèles viennent des lectures de `/templates`
 * (`GET /api/racks?templates=true`, `GET /api/panels`) ; un échec n'affiche
 * simplement pas de nombre.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { EmptyState } from "@/components/ui/empty-state";
import { ChevronRight, FileStack, LayoutPanelTop, Lockers } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { STRATA_NAV, MODELES, type StrataIcon } from "../shell/nav-model";

const DESCRIPTION: Record<string, string> = {
  "/templates?tab=racks": "Racks, flight-cases et régies réutilisables, avec leur éditeur.",
  "/templates?tab=panels": "Patchs et accessoires, avec l'éditeur de panel plein écran.",
  "/templates?tab=dossiers": "Modèles de dossier technique.",
};

const ICON: Record<string, StrataIcon> = {
  "/templates?tab=racks": Lockers,
  "/templates?tab=panels": LayoutPanelTop,
  "/templates?tab=dossiers": FileStack,
};

type Counts = Partial<Record<string, number>>;

function useModelCounts(enabled: boolean): Counts {
  const [counts, setCounts] = useState<Counts>({});
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const count = (path: string, href: string) =>
      api
        .get<unknown[]>(path)
        .then((rows) => {
          if (!cancelled && Array.isArray(rows)) setCounts((c) => ({ ...c, [href]: rows.length }));
        })
        .catch(() => {
          /* nombre facultatif */
        });
    void count("/api/racks?templates=true", "/templates?tab=racks");
    void count("/api/panels", "/templates?tab=panels");
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return counts;
}

export function ModelsTab() {
  const { has } = useTenantPermissions();
  const entries = STRATA_NAV.find((s) => s.id === "catalogue")!.items.filter(
    (i) => i.group === MODELES && (!i.perm || has(i.perm.domain, i.perm.level)),
  );
  const counts = useModelCounts(entries.length > 0);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Lockers strokeWidth={1.5} />}
        title="Aucun modèle accessible"
        description="Votre rôle ne donne pas accès aux modèles."
      />
    );
  }

  return (
    <div className="max-w-[760px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
      <ul aria-label="Modèles" className="m-0 list-none divide-y divide-[var(--border)] p-0">
        {entries.map((e) => {
          const Icon = ICON[e.href] ?? e.icon;
          const n = counts[e.href];
          return (
            <li key={e.href}>
              <Link
                href={e.href}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-3 text-[12.5px] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="font-semibold text-[var(--foreground)]">{e.label}</strong>
                  <span className="truncate text-[11.5px] text-[var(--muted-foreground)]">{DESCRIPTION[e.href]}</span>
                </span>
                {n != null && (
                  <span className="shrink-0 font-mono text-[11.5px] text-[var(--muted-foreground)] tabular-nums">{n}</span>
                )}
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
