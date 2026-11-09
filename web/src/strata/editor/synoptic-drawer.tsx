"use client";

/**
 * Tiroir du synoptique en interface Strata v2 (spec v2 §4.1, accroche de
 * `synoptique-tab-client.tsx`, `strata.drawerTop`), au-dessus du panneau
 * droit d'arkyo :
 *   - ouvre le tiroir quand la sélection change (`useStrataDrawer().
 *     requestOpen`), à partir des détails que l'onglet tient déjà
 *     (`onNodeDetailsChange`, `onCableDetailsChange`…) : une sélection
 *     nouvelle l'ouvre ; après une fermeture manuelle, la même sélection ne
 *     le rouvre pas ;
 *   - pour un équipement, la carte « Faces » (`EquipmentFaceCard` : faces
 *     avant / arrière, ports reliés, position) et « Voir dans le rack », qui
 *     passe en mode Racks sur le contenant de l'équipement.
 *
 * Monté par le tiroir de la coquille Strata seulement : sans effet en
 * Classique (le champ `strata` y est ignoré).
 */

import { useEffect } from "react";
import type { InventaireLocation, InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { NodeSelectionDetails } from "@/components/synoptique/synoptic-view";
import { LoadingState } from "@/components/ui/loading-state";
import { Server } from "@/components/ui/icons";
import { flattenSlots } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";
import { useStrataDrawer } from "../shell/canvas-shell";
import { useGoToProjectTab } from "../shell/tab-nav";
import { useRackFocusStore } from "./rack-focus";

type Identified = { id: string } | null;

/** Sélection courante du synoptique (états de `SynoptiqueTabClient`). */
export type SynopticSelection = {
  node: NodeSelectionDetails | null;
  /** Contenant réel du slot sélectionné (vue emplacement). */
  nodeRackId: string | null;
  cable: Identified;
  adapter: Identified;
  zone: Identified;
  label: Identified;
  external: Identified;
  multiCable: readonly { id: string }[];
  multiNode: { nodeCount: number };
  multiExternal: readonly { id: string }[];
  generalRack: Identified;
  generalConnection: Identified;
};

/**
 * Identité de la sélection (`null` : rien de sélectionné). Ne dépend que des
 * identifiants : des détails republiés pour la même sélection (rechargement,
 * temps réel) donnent la même clé.
 */
export function selectionKey(s: SynopticSelection): string | null {
  const parts: string[] = [];
  const one = (kind: string, v: Identified) => {
    if (v) parts.push(`${kind}:${v.id}`);
  };
  const many = (kind: string, list: readonly { id: string }[]) => {
    if (list.length > 1) parts.push(`${kind}:${list.map((x) => x.id).join(",")}`);
  };
  if (s.multiNode.nodeCount > 1) parts.push(`nodes:${s.multiNode.nodeCount}`);
  if (s.node) parts.push(`node:${s.node.slotId}`);
  one("cable", s.cable);
  one("adapter", s.adapter);
  one("zone", s.zone);
  one("label", s.label);
  one("external", s.external);
  many("cables", s.multiCable);
  many("externals", s.multiExternal);
  one("general-rack", s.generalRack);
  one("general-connection", s.generalConnection);
  return parts.length ? parts.join("|") : null;
}

const NONE: string[] = [];

const SMALL_BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[12px] font-medium text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

/** Raison pour laquelle l'équipement n'a pas d'élévation à montrer (`null` : placé en U). */
function notInRack(rack: InventaireRack | undefined, startU: number | null): string | null {
  if (!rack || rack.isVirtual) return "Équipement en pose libre, hors rack";
  if (!rack.isRackable) return "Contenant non rackable";
  if (startU == null) return "Équipement non placé en U";
  return null;
}

/** Carte « Faces » de l'équipement sélectionné, avec « Voir dans le rack ». */
function NodeFaces({
  projectId,
  node,
  rackId,
  racks,
  locations,
}: {
  projectId: string;
  node: NodeSelectionDetails;
  rackId: string;
  racks: readonly InventaireRack[];
  locations: readonly InventaireLocation[];
}) {
  const goToTab = useGoToProjectTab();
  const live = useRacksLive(rackId ? [rackId] : NONE, projectId)[rackId];
  const canvas = live?.canvas ?? null;
  if (!canvas) return <LoadingState className="py-8" />;
  if (canvas.rack.id !== rackId) return null;

  const slots = canvas.rack.slots;
  const slot = flattenSlots(slots).find((s) => s.id === node.slotId) ?? null;
  if (!slot?.equipment) return null;

  const rack = racks.find((r) => r.id === rackId);
  const location = rack ? undefined : locations.find((l) => l.virtualRackId === rackId);
  const reason = notInRack(rack, slot.startU ?? node.startU);
  const rackName = rack && !rack.isVirtual ? rack.name : `Pose libre${location ? ` · ${location.name}` : ""}`;

  return (
    <section aria-label="Faces" className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2">
        <span className="text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">Faces</span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={reason !== null}
          title={reason ?? `Passer en mode Racks sur ${rack?.name ?? "son contenant"}`}
          onClick={() => {
            useRackFocusStore.getState().request({ projectId, rackId });
            goToTab("rack");
          }}
          className={SMALL_BTN}
        >
          <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          Voir dans le rack
        </button>
      </div>
      <EquipmentFaceCard
        slot={slot}
        canvasData={canvas}
        connections={live?.connections ?? null}
        slots={slots}
        rackName={rackName}
      />
    </section>
  );
}

export function StrataSynopticDrawerTop({
  projectId,
  racks,
  locations,
  selection,
}: {
  projectId: string;
  /** Contenants du projet (hors racks virtuels des lieux). */
  racks: readonly InventaireRack[];
  locations: readonly InventaireLocation[];
  selection: SynopticSelection;
}) {
  const { requestOpen } = useStrataDrawer();
  const key = selectionKey(selection);
  useEffect(() => {
    requestOpen(key);
  }, [key, requestOpen]);

  const { node, nodeRackId } = selection;
  // Un équipement seul (pas un panel, pas une multi-sélection).
  if (!node || !nodeRackId || !node.equipmentName || selection.multiNode.nodeCount > 1) return null;
  return <NodeFaces key={node.slotId} projectId={projectId} node={node} rackId={nodeRackId} racks={racks} locations={locations} />;
}
