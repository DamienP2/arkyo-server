"use client";

/**
 * Dock bas de l'éditeur Strata (spec §6.2, lot 3), dans `BottomDock` :
 *   - onglet Rack : Contrôles (`validateRack()` sur le ou les contenants
 *     affichés), Câbles, Bilan ; un clic sur un contrôle ou un câble
 *     sélectionne l'équipement en cause ;
 *   - synoptique : Contrôles, d'après le rapport que le synoptique publie
 *     (`useTopbarActions().validationReport`, sélection par
 *     `onSelectValidationIssue`). Sans rapport publié, pas de dock.
 */

import { useMemo } from "react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { Slot } from "@/components/synoptique/lib/types";
import { validateRack, type ValidationIssue, type ValidationReport } from "@/lib/services/rack-validation";
import { BottomDock, type BottomDockTab } from "../shell/bottom-dock";
import { BilanTab } from "./bilan-tab";
import { CablesTab } from "./cables-tab";
import { ChecksCount, ChecksTab } from "./checks-tab";
import { flattenSlots, type RackSource } from "./rack-model";
import { realSlotId, toValidationInput } from "./rack-validation-input";

type Located = { report: ValidationReport; slotOf: (issue: ValidationIssue) => Slot | null };

/**
 * Rapport des contenants affichés (un seul en portée contenant). Plusieurs
 * contenants : identifiants rendus uniques, élément préfixé du contenant.
 */
function useRacksReport(sources: readonly RackSource[]): Located | null {
  return useMemo(() => {
    if (sources.some((s) => s.connections === null)) return null;
    const many = sources.length > 1;
    const owner = new Map<string, { slots: Map<string, Slot>; connections: Map<string, string | null> }>();
    const issues: ValidationIssue[] = [];
    for (const src of sources) {
      const r = validateRack(toValidationInput(src.data, { slots: src.slots, connections: src.connections }));
      const rackId = src.data.rack.id;
      const index = {
        slots: new Map(flattenSlots(src.slots).map((s) => [s.id, s])),
        connections: new Map((src.connections ?? []).map((c) => [c.id, c.fromSlotId ?? c.toSlotId])),
      };
      for (const issue of r.issues) {
        const id = many ? `${rackId}:${issue.id}` : issue.id;
        issues.push({ ...issue, id, subject: many && issue.subject ? `${src.data.rack.name} · ${issue.subject}` : issue.subject });
        owner.set(id, index);
      }
    }
    const count = (sev: ValidationIssue["severity"]) => issues.filter((i) => i.severity === sev).length;
    return {
      report: { issues, counts: { error: count("error"), warning: count("warning"), info: count("info") } },
      slotOf: (issue) => {
        const o = owner.get(issue.id);
        if (!o) return null;
        // Slot en cause, sinon une extrémité du premier câble en cause.
        const ref = issue.refs.slotIds?.[0] ?? (issue.refs.connectionIds?.[0] && o.connections.get(issue.refs.connectionIds[0]));
        return ref ? (o.slots.get(realSlotId(ref)) ?? null) : null;
      },
    };
  }, [sources]);
}

const EMPTY_COUNTS = { error: 0, warning: 0, info: 0 };

export function RackBottomDock({
  sources,
  onSelectSlot,
}: {
  sources: readonly RackSource[];
  onSelectSlot: (slot: Slot) => void;
}) {
  const located = useRacksReport(sources);
  const cables = sources.reduce((a, s) => a + (s.connections?.length ?? 0), 0);
  const tabs: BottomDockTab[] = [
    {
      id: "controles",
      label: "Contrôles",
      extra: <ChecksCount counts={located?.report.counts ?? EMPTY_COUNTS} />,
      node: (
        <ChecksTab
          report={located?.report ?? null}
          onSelectIssue={(issue) => {
            const slot = located?.slotOf(issue);
            if (slot) onSelectSlot(slot);
          }}
        />
      ),
    },
    {
      id: "cables",
      label: "Câbles",
      extra: (
        <>
          {" "}
          <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{cables}</span>
        </>
      ),
      node: <CablesTab sources={sources} onSelectSlot={onSelectSlot} />,
    },
    { id: "bilan", label: "Bilan", node: <BilanTab sources={sources} /> },
  ];
  return <BottomDock tabs={tabs} storageKey="strata-rack-dock" />;
}

/** Dock bas du synoptique : le rapport de validation qu'il publie, s'il y en a un. */
export function SynopticBottomDock() {
  const report = useTopbarActions((s) => s.validationReport);
  const onSelect = useTopbarActions((s) => s.onSelectValidationIssue);
  if (!report) return null;
  return (
    <BottomDock
      storageKey="strata-synoptic-dock"
      tabs={[
        {
          id: "controles",
          label: "Contrôles",
          extra: <ChecksCount counts={report.counts} />,
          node: <ChecksTab report={report} onSelectIssue={onSelect} />,
        },
      ]}
    />
  );
}
