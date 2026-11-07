"use client";

/**
 * Panneau de propriétés multi-sélection nodes (équipements / panels / accessoires).
 *
 * Affiché par le RightPanel quand `selectedNodeIds.size > 1`. Conserve le
 * pattern visuel de `SynopticMultiCablePropertiesPanel` : entête "Sélection
 * multiple" + compteurs en mono. Pas d'actions multi pour l'instant
 * (suppression nominative se fait via Inventaire, "Retirer de la baie" a été
 * retiré du synoptique).
 *
 * En mode général : 1 node = 1 rack, donc nodeCount === rackCount. Le bloc
 * "Contenants" reste informatif (l'utilisateur voit qu'il a sélectionné N
 * racks). En focus rack : rackCount = 1, on l'indique pareil pour cohérence.
 */

import { Server, Package } from "@/components/ui/icons";

import { SectionTitle } from "@/components/synoptique/components/property-patterns";

export type SynopticMultiNodePropertiesPanelProps = {
  /** Nombre d'équipements (slots) sélectionnés. */
  nodeCount: number;
  /** Nombre de contenants (racks) distincts contenant la sélection.
   *  Cf. synoptic-view : 1 en focus rack, = nodeCount en mode général. */
  rackCount: number;
};

export function SynopticMultiNodePropertiesPanel({
  nodeCount,
  rackCount,
}: SynopticMultiNodePropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Sélection multiple</SectionTitle>
        <div
          className="text-foreground text-sm font-semibold"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {nodeCount} équipement{nodeCount > 1 ? "s" : ""}
        </div>
      </div>

      {/* Compteur "Contenants" en InfoCard simplifiée. En focus rack c'est
          constant (1), en général c'est le nombre de racks dans la sélection. */}
      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={<Package className="h-3.5 w-3.5" />}
          label="Équipements"
          value={String(nodeCount)}
        />
        <Stat
          icon={<Server className="h-3.5 w-3.5" />}
          label="Contenants"
          value={String(rackCount)}
        />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border/60 flex flex-col gap-1 rounded-md border p-2.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase">
        {icon}
        {label}
      </div>
      <div
        className="text-foreground text-sm font-semibold"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value}
      </div>
    </div>
  );
}
