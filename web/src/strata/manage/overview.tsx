"use client";

/**
 * Gérer › Vue d'ensemble (spec v2 §4.2, maquette `GP.apercu`) : le projet
 * domaine par domaine (une ligne par domaine, qui mène à son écran) et « Ce
 * qu'il reste à faire », calculé sur les données disponibles (`computeTodo`) ;
 * chaque ligne mène à l'objet, dans Concevoir ou dans Gérer.
 */

import type { ReactNode } from "react";
import {
  Box as BoxIcon,
  Cable,
  ChevronRight,
  ClipboardList,
  FileStack,
  Network,
  Server,
  ShieldCheck,
  Truck,
  Workflow,
  Check,
} from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { INTERVENTION_LABEL, RIG_LABEL } from "./format";
import { Box, PageHead, SMALL_BTN, Sev } from "./manage-ui";
import { computeDomains, computeTodo, type DomainId } from "./todo-model";
import type { ManageNav, ManageState } from "./use-manage";

const DOMAIN_ICON: Record<DomainId, ReactNode> = {
  fiche: <ClipboardList />,
  materiel: <BoxIcon />,
  racks: <Server />,
  cables: <Cable />,
  validation: <ShieldCheck />,
  reseau: <Network />,
  livraison: <Truck />,
  dossier: <FileStack />,
};

const ROW =
  "flex w-full items-center gap-2.5 border-b border-[var(--border)] bg-transparent px-3.5 py-2.5 text-left text-[12.5px] text-[var(--foreground)] transition-colors outline-none last:border-b-0 hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset";

export function OverviewPage({ data, nav }: { data: ManageState; nav: ManageNav }) {
  const { fiche } = data;
  const domains = computeDomains(data);
  const todo = computeTodo(data);
  const eyebrow = [INTERVENTION_LABEL[fiche.interventionType], fiche.rigType ? RIG_LABEL[fiche.rigType] : null]
    .filter(Boolean)
    .join(" · ");
  const subtitle = domains.find((d) => d.id === "fiche")?.summary;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PageHead
        eyebrow={eyebrow}
        title={fiche.name}
        subtitle={subtitle}
        actions={
          <button type="button" onClick={nav.goToConcevoir} className={SMALL_BTN}>
            <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Concevoir
          </button>
        }
      />
      <div className="grid max-w-[1280px] grid-cols-1 items-start gap-[18px] px-6 pt-4 pb-24 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Box title="Le projet, domaine par domaine" flush>
          <ul aria-label="Le projet, domaine par domaine" className="m-0 list-none p-0">
            {domains.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => nav.goToTarget(d.target)}
                  className={cn(ROW, "grid grid-cols-[18px_96px_minmax(0,1fr)_auto_14px]")}
                >
                  <span aria-hidden className="text-[var(--text-tertiary)] [&_svg]:h-4 [&_svg]:w-4">
                    {DOMAIN_ICON[d.id]}
                  </span>
                  <strong className="font-semibold">{d.label}</strong>
                  <span className="truncate text-[var(--muted-foreground)]">{d.summary}</span>
                  <span className="flex items-center gap-1.5">
                    {d.aside && <span className="text-[11px] whitespace-nowrap text-[var(--text-tertiary)]">{d.aside}</span>}
                    <Sev tone={d.severity} />
                  </span>
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </button>
              </li>
            ))}
          </ul>
        </Box>

        <Box
          title="Ce qu'il reste à faire"
          flush
          aside={
            !data.loading && todo.length > 0 ? (
              <span className="text-[12px] text-[var(--muted-foreground)] tabular-nums">{todo.length}</span>
            ) : null
          }
        >
          {data.loading ? (
            <LoadingState className="py-10" />
          ) : todo.length === 0 ? (
            <div role="list" aria-label="Ce qu'il reste à faire">
              <EmptyState icon={<Check strokeWidth={1.5} />} title="Tout est fait" className="py-10" />
            </div>
          ) : (
            <ul aria-label="Ce qu'il reste à faire" className="m-0 list-none p-0">
              {todo.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => nav.goToTarget(t.target)} className={ROW}>
                    <span aria-hidden className="h-[15px] w-[15px] shrink-0 rounded-[4px] border-[1.5px] border-[var(--border-strong)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.label}</span>
                      {t.detail && (
                        <small className="block truncate text-[11.5px] text-[var(--muted-foreground)]">{t.detail}</small>
                      )}
                    </span>
                    <Sev tone={t.severity} />
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>
    </div>
  );
}
