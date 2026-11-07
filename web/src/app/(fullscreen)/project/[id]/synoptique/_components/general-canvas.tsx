"use client";

/**
 * GeneralCanvas — vue Générale du synoptique projet.
 *
 * **Approche refactor (vague 8) : ZÉRO reproduction de code.**
 *
 * Le composant monte directement `SynopticView` en mode général en lui passant :
 *
 *   1. Des **slots synthétiques** : 1 slot par rack du projet. Le slot a `id =
 *      rack.id` et `equipment.connectors = rack.externalConnectors` (chaque
 *      port externe devient une entrée connecteur avec `quantity = 1`). La
 *      position vient de `rack.canvasX/canvasY` (champ `synopticX/synopticY`
 *      du slot).
 *
 *   2. Des **connexions synthétiques** : chaque `ProjectConnection` est
 *      virtualisée vers la forme `{ fromSlotId: rackId, fromConnectorIndex:
 *      indexSynthétique }` que SynopticView consomme. La traduction se fait
 *      via une lookup `(realSlotId, realPortIndex) → indexSynthétique`.
 *
 *   3. Un **cablingApi adapter** : toutes les mutations connexion passent par
 *      `/api/tenant/projects/[id]/synoptic/connections*`. L'adapter dévirtualise
 *      les indices synthétiques vers (realSlotId, realPortIndex, rackId) avant
 *      d'envoyer le POST.
 *
 * Conséquence : **tout le câblage, multi-cable, vérification d'incompatibilité,
 * infobulles, snapping, undo/redo, sélection, zones, labels, pan/zoom, mini-map,
 * etc. utilise EXACTEMENT le même chemin de code que le rack focus** — zéro
 * reproduction.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { apiFetch } from "@/lib/client-id";
import { SynopticView, type SynopticViewHandle } from "@/components/synoptique/synoptic-view";
import { useWorkspace } from "@/components/editor-shell/hooks/use-workspace";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import {
  type CablingApiAdapter,
  type CablingCreatePayload,
} from "@/components/synoptique/lib/cabling-api";
import type {
  RackSlotWithEquipment,
  RackConnection,
  ConnectorEntry,
} from "@/components/synoptique/types/synoptic";
import type {
  GeneralRackSelection,
  GeneralConnectionSelection,
} from "./general-properties-panels";

// ── Types ────────────────────────────────────────────────────────────────────

export type GeneralExternalConnector = {
  externalId: string;
  slotId: string;
  portIndex: number;
  label: string;
  direction: string | null;
  signalName: string | null;
  connectorTypeId: string | null;
  side: "left" | "right";
  /** ID de l'équipement catalogue source (null pour les ports panel). */
  equipmentId?: string | null;
  /** Nom de l'équipement / du panel (fallback affichage). */
  equipmentName?: string | null;
  /**
   * Contenant réel portant ce port. Obligatoire sur les ports d'un bloc
   * « emplacement » (ils viennent de plusieurs contenants) ; optionnel sur un
   * bloc « contenant » où il vaut l'id du contenant lui-même.
   */
  rackId?: string;
  /** Nom du contenant réel — préfixe de groupe dans un bloc emplacement. */
  rackName?: string | null;
};

export type GeneralRackNode = {
  id: string;
  name: string;
  rackType: string;
  totalU: number | null;
  canvasX: number | null;
  canvasY: number | null;
  externalConnectors: GeneralExternalConnector[];
};

/**
 * Bloc « emplacement » de la vue Générale — un lieu et l'ensemble de ses ports
 * externes (tous contenants confondus). Émis pour TOUS les lieux, même sans
 * aucun port : le bloc s'affiche alors avec un corps vide.
 */
export type GeneralLocationNode = {
  id: string;
  name: string;
  cableCode: string | null;
  canvasX: number | null;
  canvasY: number | null;
  /** Nombre de contenants rattachés (affiché sous le nom). */
  containerCount?: number | null;
  externalConnectors: GeneralExternalConnector[];
};

export type GeneralConnection = {
  id: string;
  fromRackId: string;
  fromSlotId: string | null;
  fromConnectorIndex: number | null;
  toRackId: string;
  toSlotId: string | null;
  toConnectorIndex: number | null;
  label?: string | null;
  color?: string | null;
  cableStyle?: string | null;
  waypoints?: { x: number; y: number }[] | null;
  bundleId?: string | null;
};

export type GeneralConnectorTypeInfo = {
  id: string;
  name: string;
  color: string;
};

export type GeneralPayload = {
  /**
   * Lieux du projet — blocs principaux de la vue Générale. Absent = payload
   * d'une version antérieure de la route (on retombe sur les blocs contenants).
   */
  locations?: GeneralLocationNode[];
  /** Contenants SANS lieu (« À affecter »), émis même sans port externe. */
  racks: GeneralRackNode[];
  connections: GeneralConnection[];
  bundles: Array<{ id: string; name: string; color: string }>;
  connectorTypes: GeneralConnectorTypeInfo[];
  signals: Array<{ id: string; name: string; color: string }>;
  signalCategories: Array<{ name: string }>;
  appConfig: Record<string, string>;
  /** Métadonnées projet pour le panneau "infos projet" en vue Générale. */
  project?: { id: string; name: string };
  /** Stats agrégées rendues par le panneau Général lorsqu'aucune sélection. */
  stats?: {
    rackCount: number;
    totalWeightKg: number;
    totalPowerW: number;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise une direction texte vers la forme attendue par SynopticView
 * (`IN` | `OUT` | `BIDIR` | undefined).
 */
function normalizeDirection(raw: string | null | undefined): "IN" | "OUT" | "BIDIR" | undefined {
  if (!raw) return undefined;
  const v = raw.toUpperCase();
  if (v === "IN") return "IN";
  if (v === "OUT") return "OUT";
  if (v === "BIDIR" || v === "BOTH") return "BIDIR";
  return undefined;
}

/**
 * Un « bloc » de la vue Générale : un emplacement (agrège les ports de tous ses
 * contenants) ou un contenant sans lieu (« À affecter »).
 */
type GeneralBlock = {
  kind: "location" | "rack";
  id: string;
  name: string;
  /** Sous-titre affiché sous le nom (catégorie du nœud synthétique). */
  subtitle: string;
  canvasX: number | null;
  canvasY: number | null;
  connectors: GeneralExternalConnector[];
};

/**
 * Construit les lookups entre ports RÉELS et indices synthétiques.
 *
 * Un bloc emplacement agrège des ports appartenant à PLUSIEURS contenants : la
 * clé de lookup inverse est donc `(rackId, slotId, portIndex)` — unique, un
 * contenant n'appartenant qu'à un seul lieu — et non plus l'id du bloc.
 */
function buildSyntheticIndexMap(blocks: GeneralBlock[]) {
  // key = `${realRackId}::${realSlotId}::${realPortIndex}`
  //     → { blockId, index } (position du port dans son bloc)
  const synthByReal = new Map<string, { blockId: string; index: number }>();
  // key = `${blockId}::${syntheticIndex}` → endpoint réel complet
  const realBySynth = new Map<
    string,
    { rackId: string; slotId: string; portIndex: number }
  >();
  for (const block of blocks) {
    block.connectors.forEach((ec, idx) => {
      // Sur un bloc contenant, `rackId` vaut l'id du bloc lui-même.
      const realRackId = ec.rackId ?? (block.kind === "rack" ? block.id : "");
      if (!realRackId) return;
      synthByReal.set(`${realRackId}::${ec.slotId}::${ec.portIndex}`, {
        blockId: block.id,
        index: idx,
      });
      realBySynth.set(`${block.id}::${idx}`, {
        rackId: realRackId,
        slotId: ec.slotId,
        portIndex: ec.portIndex,
      });
    });
  }
  return { synthByReal, realBySynth };
}

// ── Component ────────────────────────────────────────────────────────────────

type Tool = "select" | "pan" | "cable" | "erase";

// Tableaux vides à référence STABLE pour les props initial* du SynopticView
// (zones / labels / adapters / external / panel rows). En mode général, ces
// entités n'existent pas (synthétiques) → on passe toujours vide. Si on
// utilisait `[]` inline dans le JSX, chaque render créerait une nouvelle
// référence → les useEffect du SynopticView qui font `setAdapters(initialAdapters)`
// (etc.) tireraient à chaque render → boucle infinie via re-render parent.
const GENERAL_EMPTY_STATE = {
  title: "Aucun emplacement",
  description: "Créez-en un depuis l'inventaire pour construire le synoptique général.",
};

const EMPTY_ADAPTERS: never[] = [];
const EMPTY_ZONES: never[] = [];
const EMPTY_LABELS: never[] = [];
const EMPTY_EXTERNALS: never[] = [];
const EMPTY_PANEL_ROWS: never[] = [];

export const GeneralCanvas = forwardRef<
  SynopticViewHandle,
  {
    projectId: string;
    payload: GeneralPayload;
    /** Outil actif lu depuis le workspace store synoptique (compat). */
    activeTool?: Tool;
    /**
     * Vue de LECTURE seule — sur-modal d'export, hôte de génération.
     *
     * Elle cesse de publier ses relais (zoom, écritures câble/libellé/zone,
     * numérotation, effacement) vers le store GLOBAL du shell. Ces effets-là
     * n'ont AUCUN nettoyage : une seconde instance y laissait pour de bon des
     * relais pointant vers un canvas démonté — la barre d'outils de l'éditeur
     * visible commandait alors un fantôme.
     */
    readOnly?: boolean;
    /** Demande un refetch après mutation (compat — SynopticView gère son propre état optimiste). */
    onRefresh?: () => void;
    /** Publie la sélection d'un rack (null = aucune). */
    onRackDetailsChange?: (data: GeneralRackSelection | null) => void;
    /** Publie la sélection d'une connexion inter-rack (null = aucune). */
    onConnectionDetailsChange?: (data: GeneralConnectionSelection | null) => void;
    /** Publie la sélection multi-câbles (≥2). Forwarde le summary tel quel
     *  depuis SynopticView (ids des ProjectConnection sélectionnés + signaux).
     *  Permet d'afficher le panneau multi-cable en mode général. */
    onMultiCableSelectionChange?: (
      cables: Parameters<
        NonNullable<Parameters<typeof SynopticView>[0]["onMultiCableSelectionChange"]>
      >[0],
    ) => void;
    /** Publie la sélection multi-nodes (équipements = racks en général).
     *  rackCount = nodeCount (1 node = 1 rack). */
    onMultiNodeSelectionChange?: (summary: {
      nodeCount: number;
      rackCount: number;
    }) => void;
    /** Capture du contenu du panneau renumber (forwardé depuis SynopticView). */
    onRenumberPanelChange?: (node: ReactNode | null) => void;
    /** Capture du contenu du panneau manual numbering (forwardé depuis SynopticView). */
    onManualPanelChange?: (node: ReactNode | null) => void;
  }
>(function GeneralCanvasInner(
  {
    projectId,
    payload,
    activeTool: _activeTool = "select",
    readOnly = false,
    onRefresh: _onRefresh,
    onRackDetailsChange,
    onConnectionDetailsChange,
    onMultiCableSelectionChange,
    onMultiNodeSelectionChange,
    onRenumberPanelChange,
    onManualPanelChange,
  },
  forwardedRef,
) {
  // ── Blocs : 1 par emplacement + 1 par contenant « À affecter » ───────────
  // Les lieux passent en premier (ils portent l'essentiel du câblage projet) ;
  // les contenants sans lieu suivent.
  const blocks = useMemo<GeneralBlock[]>(() => {
    const out: GeneralBlock[] = [];
    for (const loc of payload.locations ?? []) {
      const n = loc.containerCount ?? 0;
      out.push({
        kind: "location",
        id: loc.id,
        name: loc.name,
        subtitle: [
          loc.cableCode?.trim() || null,
          n > 0 ? `${n} contenant${n > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Emplacement",
        canvasX: loc.canvasX,
        canvasY: loc.canvasY,
        connectors: loc.externalConnectors ?? [],
      });
    }
    for (const rack of payload.racks) {
      out.push({
        kind: "rack",
        id: rack.id,
        name: rack.name,
        subtitle: rack.totalU != null ? `Contenant · ${rack.totalU}U` : "Contenant",
        canvasX: rack.canvasX,
        canvasY: rack.canvasY,
        connectors: rack.externalConnectors ?? [],
      });
    }
    return out;
  }, [payload.locations, payload.racks]);

  /** Ids des blocs « emplacement » — routage de la persistance de position. */
  const locationBlockIds = useMemo(
    () => new Set((payload.locations ?? []).map((l) => l.id)),
    [payload.locations],
  );

  // ── Lookup synthétique <→ réel ───────────────────────────────────────────
  const { synthByReal, realBySynth } = useMemo(
    () => buildSyntheticIndexMap(blocks),
    [blocks],
  );

  // ── Slots synthétiques : 1 slot par bloc ─────────────────────────────────
  const syntheticSlots = useMemo<RackSlotWithEquipment[]>(() => {
    return blocks.map((block) => {
      const connectors: ConnectorEntry[] = block.connectors.map((ec) => {
        // Le label de port reste brut (sans préfixe équipement) — la provenance
        // de chaque port est désormais matérialisée par `groupLabel` qui
        // déclenche dans SynopticNode l'affichage d'un mini-header centré au
        // début de chaque groupe d'équipement consécutif. Les ports externes
        // sont déjà triés par équipement côté API (ordre stable), donc les
        // groupLabel consécutifs identiques se regroupent naturellement.
        const portLbl = ec.label?.trim() || `Port ${ec.portIndex + 1}`;
        // Dans un bloc emplacement, un même nom d'équipement peut exister dans
        // deux contenants : le mini-header de groupe porte donc « CONTENANT ·
        // Équipement ». Dans un bloc contenant, le nom d'équipement suffit.
        const equipName = ec.equipmentName?.trim() || null;
        const groupLabel =
          block.kind === "location"
            ? [ec.rackName?.trim() || null, equipName].filter(Boolean).join(" · ") || null
            : equipName;
        return {
          connectorTypeId: ec.connectorTypeId ?? undefined,
          signalName: ec.signalName ?? undefined,
          direction: normalizeDirection(ec.direction),
          quantity: 1,
          label: portLbl,
          groupLabel,
          // `face` n'a pas de sens en vue Générale (pas de FRONT/REAR à projeter).
          // SynopticView dérive le côté gauche/droit depuis `direction` uniquement.
        };
      });
      return {
        id: block.id,
        equipmentId: block.id,
        startU: null,
        heightU: null,
        label: block.name,
        widthFraction: "FULL",
        notes: null,
        synopticX: block.canvasX,
        synopticY: block.canvasY,
        // Un lieu (ou un contenant) sans port externe reste affiché : bloc à
        // corps vide, sélectionnable et déplaçable.
        renderWhenEmpty: true,
        equipment: {
          id: block.id,
          // Le nœud affiche `slot.label` en titre et `equipment.name` en
          // seconde ligne → on y met le sous-titre du bloc (code + compteur)
          // plutôt que de répéter le nom.
          name: block.subtitle,
          reference: null,
          category: block.kind === "location" ? "Emplacement" : "Contenant",
          heightU: null,
          weight: null,
          powerW: null,
          depthMm: null,
          imageUrl: null,
          connectors,
          brand: null,
        },
        panel: null,
      };
    });
  }, [blocks]);

  // ── Connexions synthétiques : ProjectConnection virtualisées ─────────────
  // Le nœud porteur est le BLOC (lieu ou contenant « À affecter ») qui contient
  // le port réel — plus forcément le rack de la connexion.
  const syntheticConnections = useMemo<RackConnection[]>(() => {
    const out: RackConnection[] = [];
    for (const pc of payload.connections) {
      const from =
        pc.fromSlotId != null && pc.fromConnectorIndex != null
          ? synthByReal.get(`${pc.fromRackId}::${pc.fromSlotId}::${pc.fromConnectorIndex}`)
          : undefined;
      const to =
        pc.toSlotId != null && pc.toConnectorIndex != null
          ? synthByReal.get(`${pc.toRackId}::${pc.toSlotId}::${pc.toConnectorIndex}`)
          : undefined;
      // Skip les connexions qui pointent vers un port externe qui n'existe plus
      // (lookup miss) — elles ne peuvent pas être rendues sans index synthétique.
      if (!from || !to) continue;
      // Skip les liaisons internes à un même bloc (intra-lieu) : elles se
      // câblent dans la vue de l'emplacement, pas ici. La route les filtre
      // déjà — garde défensive contre un payload périmé.
      if (from.blockId === to.blockId) continue;
      out.push({
        id: pc.id,
        rackId: "general",
        fromSlotId: from.blockId,
        fromConnectorIndex: from.index,
        toSlotId: to.blockId,
        toConnectorIndex: to.index,
        label: pc.label ?? null,
        color: pc.color ?? null,
        waypoints: pc.waypoints ?? null,
        cableStyle: pc.cableStyle ?? null,
      });
    }
    return out;
  }, [payload.connections, synthByReal]);

  // ── ConnectorTypes : shape compat SynopticView ───────────────────────────
  const connectorTypesForView = useMemo(
    () =>
      payload.connectorTypes.map((ct) => ({
        id: ct.id,
        name: ct.name,
        iconId: ct.id, // pas d'icône custom dispo en payload général → fallback id
        color: ct.color,
        category: "",
      })),
    [payload.connectorTypes],
  );

  // ── Signals : shape compat SynopticView ──────────────────────────────────
  const signalsForView = useMemo(
    () =>
      payload.signals.map((s) => ({
        name: s.name,
        color: s.color,
        cablePrefix: null,
        cableSuffix: null,
        category: null,
        categoryRef: null,
      })),
    [payload.signals],
  );

  const signalCategoriesForView = useMemo(
    () => payload.signalCategories.map((c) => ({ name: c.name, cablePrefix: null, cableSuffix: null })),
    [payload.signalCategories],
  );

  // ── Cabling API adapter — translate synthétique → ProjectConnection ──────
  // L'adapter reçoit des payloads en forme rack (fromSlotId = rackId synthétique,
  // fromConnectorIndex = synth index) et les traduit vers la forme attendue par
  // /api/tenant/projects/[id]/synoptic/connections (qui prend rackId+slotId+
  // connectorIndex séparément).
  const cablingApi = useMemo<CablingApiAdapter>(() => {
    // Helper : convertit { slotId: blockId, connectorIndex: synth } →
    // { rackId réel, slotId réel, connectorIndex réel }. Le contenant vient de
    // la lookup (un bloc lieu agrège plusieurs contenants).
    function devirtEndpoint(
      synthSlotId: string | null | undefined,
      synthConnectorIndex: number | null | undefined,
    ): { rackId: string; slotId?: string; connectorIndex?: number } | null {
      if (!synthSlotId || synthConnectorIndex == null) return null;
      const real = realBySynth.get(`${synthSlotId}::${synthConnectorIndex}`);
      if (!real) return null;
      return {
        rackId: real.rackId,
        slotId: real.slotId,
        connectorIndex: real.portIndex,
      };
    }

    /** Re-virtualise une ProjectConnection fraîche vers la forme RackConnection. */
    function revirtualize(dbPc: {
      id: string;
      fromRackId: string;
      fromSlotId: string | null;
      fromConnectorIndex: number | null;
      toRackId: string;
      toSlotId: string | null;
      toConnectorIndex: number | null;
      label?: string | null;
      color?: string | null;
      waypoints?: unknown;
      cableStyle?: string | null;
    }): RackConnection {
      const from = synthByReal.get(
        `${dbPc.fromRackId}::${dbPc.fromSlotId}::${dbPc.fromConnectorIndex}`,
      );
      const to = synthByReal.get(
        `${dbPc.toRackId}::${dbPc.toSlotId}::${dbPc.toConnectorIndex}`,
      );
      return {
        id: dbPc.id,
        rackId: "general",
        fromSlotId: from?.blockId ?? dbPc.fromRackId,
        fromConnectorIndex: from?.index ?? 0,
        toSlotId: to?.blockId ?? dbPc.toRackId,
        toConnectorIndex: to?.index ?? 0,
        label: dbPc.label ?? null,
        color: dbPc.color ?? null,
        waypoints: dbPc.waypoints ?? null,
        cableStyle: dbPc.cableStyle ?? null,
      };
    }

    // Helper : POST single create
    async function doCreate(payload: CablingCreatePayload) {
      const from = devirtEndpoint(payload.fromSlotId, payload.fromConnectorIndex);
      const to = devirtEndpoint(payload.toSlotId, payload.toConnectorIndex);
      if (!from || !to) {
        throw new Error("Endpoint synthétique non résolu (port externe inconnu)");
      }
      const res = await apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          label: payload.label ?? undefined,
          color: payload.color ?? undefined,
          cableStyle: payload.cableStyle ?? undefined,
          waypoints: payload.waypoints ?? undefined,
          bundleId: payload.bundleId ?? undefined,
          notes: payload.notes ?? undefined,
          tags: payload.tags ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`POST ProjectConnection failed: ${res.status}`);
      // Re-virtualise pour SynopticView (forme RackConnection).
      return revirtualize(await res.json());
    }

    return {
      async createOne(payload) {
        return doCreate(payload);
      },
      async createBatch(payloads) {
        // L'API ProjectConnection n'a pas de batch côté serveur — on parallélise
        // les POST individuels (latence acceptable pour les volumes attendus).
        const results = await Promise.all(payloads.map((p) => doCreate(p)));
        return results;
      },
      async patchOne(id, patch) {
        // PATCH ne touche pas aux endpoints — on n'envoie que les fields
        // mutables (label/color/cableStyle/notes/tags/waypoints/bundleId).
        const allowed: Record<string, unknown> = {};
        if ("label" in patch) allowed.label = patch.label;
        if ("color" in patch) allowed.color = patch.color;
        if ("cableStyle" in patch) allowed.cableStyle = patch.cableStyle;
        if ("waypoints" in patch) allowed.waypoints = patch.waypoints;
        if ("notes" in patch) allowed.notes = patch.notes;
        if ("tags" in patch) allowed.tags = patch.tags;
        if ("bundleId" in patch) allowed.bundleId = patch.bundleId;
        if (Object.keys(allowed).length === 0) return null;
        const res = await apiFetch(
          `/api/tenant/projects/${projectId}/synoptic/connections/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(allowed),
          },
        );
        if (!res.ok) return null;
        return revirtualize(await res.json());
      },
      async deleteOne(id) {
        await apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${id}`, {
          method: "DELETE",
        });
      },
      async deleteBatch(ids) {
        // Pas de DELETE batch côté serveur — on parallélise.
        await Promise.all(
          ids.map((id) =>
            apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${id}`, {
              method: "DELETE",
            }),
          ),
        );
      },
      async renumber(rnPayload) {
        // SynopticView replace les connexions avec ce qu'on retourne (setConnections).
        // Retourner [] effacerait visuellement toutes les connexions.
        // → on renumérote côté serveur si pertinent, puis REFETCH les
        //   ProjectConnection à jour et on remappe en shape DbConnection.
        const clearOnly = rnPayload?.clearOnly === true;
        const hasClearIds = Array.isArray(rnPayload?.clearIds) && rnPayload!.clearIds!.length > 0;
        // 1) Appel renumber côté projet uniquement en mode "auto" complet.
        //    clearOnly / clearIds : on les implémente par PATCH ciblé.
        if (clearOnly) {
          // Vide tous les labels du projet : PATCH chaque conn avec label = null.
          await Promise.all(
            payload.connections.map((pc) =>
              apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${pc.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: null }),
              }).catch(() => null),
            ),
          );
        } else if (hasClearIds) {
          await Promise.all(
            (rnPayload!.clearIds ?? []).map((id) =>
              apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: null }),
              }).catch(() => null),
            ),
          );
        } else {
          // Auto renumber projet — endpoint existant.
          await apiFetch(`/api/tenant/projects/${projectId}/synoptic/connections/renumber`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }).catch(() => null);
        }
        // 2) Refetch la liste actuelle des ProjectConnection pour reflet immédiat.
        const res = await apiFetch(
          `/api/tenant/projects/${projectId}/synoptic/general`,
          { method: "GET" },
        );
        if (!res.ok) return [];
        const fresh = (await res.json()) as GeneralPayload;
        // 3) Remap en RackConnection synthétique (forme DbConnection compatible).
        //    On réutilise la lookup courante : le refetch ne change que les
        //    labels, pas la topologie des blocs.
        const out: RackConnection[] = [];
        for (const pc of fresh.connections) {
          const from =
            pc.fromSlotId != null && pc.fromConnectorIndex != null
              ? synthByReal.get(`${pc.fromRackId}::${pc.fromSlotId}::${pc.fromConnectorIndex}`)
              : undefined;
          const to =
            pc.toSlotId != null && pc.toConnectorIndex != null
              ? synthByReal.get(`${pc.toRackId}::${pc.toSlotId}::${pc.toConnectorIndex}`)
              : undefined;
          if (!from || !to || from.blockId === to.blockId) continue;
          out.push({
            id: pc.id,
            rackId: "general",
            fromSlotId: from.blockId,
            fromConnectorIndex: from.index,
            toSlotId: to.blockId,
            toConnectorIndex: to.index,
            label: pc.label ?? null,
            color: pc.color ?? null,
            waypoints: pc.waypoints ?? null,
            cableStyle: pc.cableStyle ?? null,
          });
        }
        // Retourne en cast vers DbConnection — la shape RackConnection est
        // compatible (setConnections appelle virtualizeConnection mais nos
        // connexions sont déjà au format attendu).
        return out as unknown as Awaited<ReturnType<CablingApiAdapter["renumber"]>>;
      },
      async patchRackConfig() {
        // Pas d'override numérotation rack en mode général — no-op.
      },
      async persistSlotPosition(slotId, x, y) {
        // slotId est l'id d'un BLOC : un emplacement (position portée par
        // Location.canvasX/Y) ou un contenant « À affecter » (Rack.canvasX/Y).
        const url = locationBlockIds.has(slotId)
          ? `/api/tenant/projects/${projectId}/locations/${slotId}`
          : `/api/racks/${slotId}/canvas-position`;
        await apiFetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvasX: x, canvasY: y }),
        }).catch(() => {});
      },
    };
  }, [projectId, realBySynth, synthByReal, payload.connections, locationBlockIds]);

  // ── Pont de sélection : SynopticView → tab-client legacy callbacks ───────
  // Le tab-client attend GeneralRackSelection / GeneralConnectionSelection.
  // On adapte les callbacks `onNodeDetailsChange` / `onCableDetailsChange` du
  // SynopticView vers ces shapes legacy.
  const handleNodeDetailsChange = useCallback(
    (data: Parameters<NonNullable<Parameters<typeof SynopticView>[0]["onNodeDetailsChange"]>>[0]) => {
      if (!data) {
        onRackDetailsChange?.(null);
        return;
      }
      // En mode général, `slotId` correspond à l'id du BLOC : un emplacement
      // ou un contenant « À affecter ».
      const loc = (payload.locations ?? []).find((l) => l.id === data.slotId);
      if (loc) {
        onRackDetailsChange?.({
          id: loc.id,
          name: loc.name,
          kind: "location",
          cableCode: loc.cableCode,
          containerCount: loc.containerCount ?? null,
          externalConnectorsCount: (loc.externalConnectors ?? []).length,
        });
        return;
      }
      const rack = payload.racks.find((r) => r.id === data.slotId);
      if (!rack) {
        onRackDetailsChange?.(null);
        return;
      }
      onRackDetailsChange?.({
        id: rack.id,
        name: rack.name,
        kind: "rack",
        rackType: rack.rackType,
        totalU: rack.totalU,
        externalConnectorsCount: rack.externalConnectors.length,
      });
    },
    [onRackDetailsChange, payload.locations, payload.racks],
  );

  const handleCableDetailsChange = useCallback(
    (
      data: Parameters<NonNullable<Parameters<typeof SynopticView>[0]["onCableDetailsChange"]>>[0],
    ) => {
      if (!data) {
        onConnectionDetailsChange?.(null);
        return;
      }
      // Retrouve les noms de blocs à partir de la conn synthétique
      // (fromSlotId = id du bloc emplacement ou contenant).
      const conn = syntheticConnections.find((c) => c.id === data.id);
      const blockName = (id: string | undefined) =>
        id ? (blocks.find((b) => b.id === id)?.name ?? null) : null;
      const fromRack = conn ? { name: blockName(conn.fromSlotId) } : null;
      const toRack = conn ? { name: blockName(conn.toSlotId) } : null;
      // Style du tracé : champ optionnel sur CableSelectionDetails (cf.
      // synoptic-view.tsx). Cast contrôlé pour récupérer le cableStyle si
      // présent — non-cassant si absent (default null → "ortho").
      const dataAny = data as typeof data & {
        cableStyle?: "ortho" | "rounded" | "arrow" | null;
      };
      onConnectionDetailsChange?.({
        id: data.id,
        label: data.label,
        color: data.color,
        signalName: data.signalName,
        cableStyle: dataAny.cableStyle ?? null,
        from: {
          rackName: fromRack?.name ?? data.from.slotName,
          equipmentName: data.from.connectorLabel,
          portLabel: data.from.portLabel ?? `Port ${data.from.portNum}`,
        },
        to: {
          rackName: toRack?.name ?? data.to.slotName,
          equipmentName: data.to.connectorLabel,
          portLabel: data.to.portLabel ?? `Port ${data.to.portNum}`,
        },
      });
    },
    [onConnectionDetailsChange, blocks, syntheticConnections],
  );

  // ── Refs / handles ───────────────────────────────────────────────────────
  const synopticRef = useRef<SynopticViewHandle>(null);

  // ── Bridge workspace store → SynopticView ────────────────────────────────
  // La LeftToolbar pilote `activeToolId` dans le workspace store. SynopticView
  // a son propre state `tool` interne sync via `setActiveTool` du handle.
  // En mode rack focus, le bridge est dans synoptique-tab-client.tsx (utilisant
  // son propre synopticRef). En mode général, ce ref-là pointe sur RIEN —
  // c'est NOTRE synopticRef qui pointe vers le SynopticView monté ici.
  const activeToolId = useWorkspace((s) => s.activeToolId);
  const activeVariantId = useWorkspace((s) => s.activeVariantId);
  const workspace = useWorkspace((s) => s.workspace);
  useEffect(() => {
    if (workspace !== "synoptic" || !activeToolId) return;
    const current = synopticRef.current?.getActiveTool?.();
    if (current !== activeToolId) {
      synopticRef.current?.setActiveTool?.(activeToolId);
    }
  }, [activeToolId, workspace]);
  // Bridge variant zoom → synoptic-view (idem rack focus)
  useEffect(() => {
    if (workspace !== "synoptic") return;
    if (activeToolId === "zoom") {
      const v = activeVariantId === "out" ? "out" : "in";
      synopticRef.current?.setZoomVariant?.(v);
    }
  }, [activeToolId, activeVariantId, workspace]);

  // ── Bridge zoom handlers + writers cable/label/zone + numbering ─────────
  // Parité avec synoptique-tab-client.tsx en mode rack focus, mais via NOTRE
  // synopticRef interne (qui pointe vraiment vers SynopticView monté ici).
  const setZoomHandlersStore = useTopbarActions((s) => s.setZoomHandlers);
  const setSynopticWritersStore = useTopbarActions((s) => s.setSynopticWriters);
  const setNumberingHandlersStore = useTopbarActions((s) => s.setNumberingHandlers);
  const setSynopticEraseHandlersStore = useTopbarActions((s) => s.setSynopticEraseHandlers);
  useEffect(() => {
    if (readOnly) return;
    setZoomHandlersStore({
      onZoomIn: () => synopticRef.current?.zoomIn?.(),
      onZoomOut: () => synopticRef.current?.zoomOut?.(),
      onZoomFit: () => synopticRef.current?.zoomFit?.(),
      onZoomReset: () => synopticRef.current?.zoomReset?.(),
      onCenter: () => synopticRef.current?.zoomCenter?.(),
    });
  }, [setZoomHandlersStore, readOnly]);
  useEffect(() => {
    if (readOnly) return;
    setSynopticWritersStore({
      setCableStyle: (v) => synopticRef.current?.setCableStyle?.(v),
      setCableCount: (v) => synopticRef.current?.setCableCount?.(v),
      setCableMode: (v) => synopticRef.current?.setCableMode?.(v),
      setLabelFont: (v) => synopticRef.current?.setLabelFont?.(v),
      setLabelFontSize: (v) => synopticRef.current?.setLabelFontSize?.(v),
      setLabelColor: (v) => synopticRef.current?.setLabelColor?.(v),
      setZoneColor: (v) => synopticRef.current?.setZoneColor?.(v),
    });
    setNumberingHandlersStore({
      onRenumberAuto: () => synopticRef.current?.openRenumberModal?.(),
      onManualNumber: () => synopticRef.current?.openManualNumberModal?.(),
    });
    setSynopticEraseHandlersStore({
      onClearLabels: () => synopticRef.current?.clearAllLabels?.(),
      onDecable: () => synopticRef.current?.clearAllCables?.(),
    });
  }, [
    setSynopticWritersStore,
    setNumberingHandlersStore,
    setSynopticEraseHandlersStore,
    readOnly,
  ]);

  // Forward ref : expose le synopticRef interne au parent pour qu'il puisse
  // appeler openRenumberModal / closeRenumberPanel / etc. depuis l'extérieur.
  useImperativeHandle(forwardedRef, () => {
    return synopticRef.current as SynopticViewHandle;
  }, []);

  // ── Render — monte SynopticView en mode général ──────────────────────────
  return (
    <SynopticView
      ref={synopticRef}
      // En mode général, le rackId est un identifiant logique (utilisé pour
      // les localStorage namespaces). On utilise "general:<projectId>".
      rackId={`general:${projectId}`}
      rackName="Vue Générale"
      slots={syntheticSlots}
      connectorTypes={connectorTypesForView}
      initialConnections={syntheticConnections}
      initialZones={EMPTY_ZONES}
      initialLabels={EMPTY_LABELS}
      initialAdapters={EMPTY_ADAPTERS}
      initialExternalPorts={EMPTY_EXTERNALS}
      initialPanelRows={EMPTY_PANEL_ROWS}
      signals={signalsForView}
      signalCategories={signalCategoriesForView}
      isVisible
      // Vue de lecture : ni salle de curseurs, ni publication vers le shell,
      // ni capture du clavier global.
      liveRoom={readOnly ? null : undefined}
      publishToShell={!readOnly}
      cablingApi={cablingApi}
      mode="general"
      // Blocs toujours rendus (même sans port) → l'état vide ne s'affiche que
      // s'il n'y a NI emplacement NI contenant à afficher.
      emptyState={GENERAL_EMPTY_STATE}
      onNodeDetailsChange={handleNodeDetailsChange}
      onCableDetailsChange={handleCableDetailsChange}
      onMultiCableSelectionChange={onMultiCableSelectionChange}
      onMultiNodeSelectionChange={onMultiNodeSelectionChange}
      onRenumberPanelChange={onRenumberPanelChange}
      onManualPanelChange={onManualPanelChange}
    />
  );
});

// ── Constants exposed for tests / utilities ──────────────────────────────────
// Kept for backwards compat with the previous standalone implementation.
export const RACK_NODE_WIDTH = 0;
export const RACK_HEADER_HEIGHT = 0;
export const RACK_PORT_HEIGHT = 0;
