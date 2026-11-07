/**
 * Inventaire des familles d'éléments de la scène synoptique, et de la façon
 * dont chacune atteint le PDF.
 *
 * ── À quoi sert ce module ─────────────────────────────────────────────────
 * L'export vectoriel emprunte DEUX chemins :
 *  - `svg` : la couche de l'écran est envoyée telle quelle au PDF. Aucun second
 *    renderer, donc aucune dérive possible — une nouvelle annotation sort en
 *    vectoriel sans une ligne de code.
 *  - `redraw` : l'élément est du HTML, il doit être REDESSINÉ en primitives. Un
 *    second renderer existe alors, et il peut prendre du retard sur l'écran.
 *
 * C'est cette seconde famille qui avait tué l'ancien exportateur programmatique
 * (`lib/pdf/synoptic-export.ts`) : chaque nouveauté de l'éditeur manquait au
 * PDF, en silence, pendant des mois. Le garde-fou est ici : toute famille
 * déclarée doit avoir une route, et le test unitaire refuse une famille dont la
 * route `redraw` n'est pas encore couverte par le renderer.
 *
 * Ce module est PUR — aucune dépendance React, DOM ou Prisma.
 */

import {
  NODE_W,
  PANEL_NODE_W,
  PORT_H,
  NODE_HEADER_H,
  NODE_MIN_H,
} from "@/components/synoptique/types/synoptic";

/** Comment une famille d'éléments atteint le document. */
export type SceneRoute =
  /** Couche SVG de l'écran, transmise au PDF sans intermédiaire. */
  | "svg"
  /** HTML : redessiné en primitives par le renderer PDF. */
  | "redraw"
  /** Aide d'édition — n'a pas à figurer sur un document. */
  | "editor-only";

export type SceneElementKind = {
  /** Identifiant stable, cité par les tests et les traces. */
  id: string;
  /** Libellé humain — apparaît dans les messages d'échec. */
  label: string;
  route: SceneRoute;
  /**
   * Où le trouver dans le rendu. Sert de point de départ quand une famille
   * change de forme : on sait quoi relire.
   */
  source: string;
};

/**
 * Toutes les familles d'éléments de la scène. Ajouter un type d'élément à
 * l'éditeur SANS l'inscrire ici est le seul moyen de le voir manquer au PDF —
 * le test `scene-descriptor.test.ts` vérifie que chaque famille `redraw` est
 * connue du renderer.
 */
export const SCENE_ELEMENT_KINDS: readonly SceneElementKind[] = [
  {
    id: "zone",
    label: "Zones",
    route: "svg",
    source: "synoptic-view.tsx — couche data-scene-layer=\"base\"",
  },
  {
    id: "canvas-label",
    label: "Libellés libres",
    route: "svg",
    source: "synoptic-view.tsx — couche data-scene-layer=\"base\"",
  },
  {
    id: "cable",
    label: "Câbles (tracé, halo de faisceau, souches)",
    route: "svg",
    source: "synoptic-view.tsx — makePathWithWaypoints",
  },
  {
    id: "cable-label",
    label: "Libellés de câble (numéro + connecteur)",
    route: "svg",
    source: "synoptic-view.tsx — text/tspan aux deux extrémités",
  },
  {
    id: "cable-warning",
    label: "Triangles de numéro en double",
    route: "svg",
    source: "synoptic-view.tsx — polygone ambre",
  },
  {
    id: "adapter",
    label: "Adaptateurs",
    route: "svg",
    source: "components/synoptic-adapter-node.tsx",
  },
  {
    id: "external-port",
    label: "Ports externes (trait + bulle)",
    route: "svg",
    source: "synoptic-view.tsx — couche data-scene-layer=\"over\"",
  },
  {
    id: "equipment-card",
    label: "Cartes d'équipement",
    route: "redraw",
    source: "components/synoptic-node.tsx → lib/pdf/synoptic-cards.ts",
  },
  {
    id: "cable-legend",
    label: "Légende des signaux",
    route: "redraw",
    source: "synoptic-view.tsx — FloatingLegend → lib/pdf/synoptic-cards.ts",
  },
  {
    id: "equipment-lock",
    // Le cadenas dit qu'un calque est VERROUILLÉ POUR L'ÉDITION. C'est un état
    // de l'éditeur, pas une information de plan : il n'a rien à faire sur un
    // document remis au client, pas plus que la grille.
    label: "Badge de verrouillage",
    route: "editor-only",
    source: "synoptic-view.tsx — superposition sur la carte",
  },
  {
    id: "grid",
    label: "Grille de fond",
    route: "editor-only",
    source: "synoptic-view.tsx — data-synoptic-grid",
  },
  {
    id: "guides",
    label: "Repères",
    route: "editor-only",
    source: "synoptic-view.tsx — data-synoptic-guides",
  },
  {
    id: "rulers",
    label: "Règles",
    route: "editor-only",
    source: "components/synoptic-rulers.tsx",
  },
  {
    id: "minimap",
    label: "Minimap",
    route: "editor-only",
    source: "components/synoptic-mini-map.tsx",
  },
  {
    id: "endpoint-handles",
    label: "Prises d'extrémité de câble",
    route: "editor-only",
    source: "synoptic-view.tsx — data-synoptic-hit",
  },
] as const;

/** Familles qui exigent un rendu PDF écrit à la main. */
export function redrawKinds(): SceneElementKind[] {
  return SCENE_ELEMENT_KINDS.filter((k) => k.route === "redraw");
}

// ─── Descripteur de carte d'équipement ──────────────────────────────────────
//
// La carte est le seul élément de la scène qui soit du HTML : elle doit être
// REDESSINÉE pour sortir en objets. Ce descripteur est la frontière entre les
// deux mondes — il fige, en coordonnées de SCÈNE, tout ce que la carte montre,
// et le renderer PDF n'a plus qu'à poser des primitives.
//
// ── L'invariant qui compte ─────────────────────────────────────────────────
// Les ancres de ports ne sont JAMAIS recalculées : elles viennent de
// `getPortCenter`, la même fonction qui ancre les câbles. C'est ce qui garantit
// qu'un câble arrive exactement sur sa pastille. Reconstruire la disposition en
// parallèle — bandes de groupes, marges d'adaptateurs, panneaux — aurait
// recréé la dérive qu'on cherche précisément à éviter.
//
// La hauteur de la carte en découle : dernier centre de port + demi-rangée +
// respiration. Rien à réaccorder quand la disposition évolue.

export type PortDirection = "IN" | "OUT" | "BIDIR";

export type CardBadge = {
  text: string;
  /** Couleur de texte et de bordure. `null` → teinte neutre du document. */
  color: string | null;
};

/** Un port, tel qu'il entre dans le descripteur. */
export type CardPortInput = {
  portIndex: number;
  side: "left" | "right";
  /** Couleur du connecteur. */
  color: string;
  /** Libellé de rangée (équipement). */
  label: string;
  /** Libellé de traversée (panel) — « 3 · BNC · 3 ». */
  panelLabel: string | null;
  direction: PortDirection | null;
  /** Câblé, ou marqué comme sortie externe → pastille pleine. */
  filled: boolean;
  /** Entrée connecteur d'origine — sert aux mini-séparateurs. */
  entryIndex: number;
  /** Groupe (composant modulaire) — sert aux bandes de la vue Générale. */
  groupLabel: string | null;
};

/** Une carte, telle qu'elle entre dans le descripteur. */
export type CardSlotInput = {
  id: string;
  isPanel: boolean;
  title: string;
  /** Marque · modèle. `null` pour un panel. */
  subtitle: string | null;
  /** Rangée d'un panel virtuel (« U3 »). */
  rowLabel: string | null;
  container: { label: string; color: string | null } | null;
  badges: CardBadge[];
  ports: CardPortInput[];
};

export type CardPort = {
  /** Ancre en coordonnées de scène — sortie de `getPortCenter`. */
  x: number;
  y: number;
  side: "left" | "right";
  color: string;
  filled: boolean;
  label: string;
  direction: PortDirection | null;
};

export type CardPanelRow = {
  /** Ancre verticale de la traversée. */
  y: number;
  left: CardPort | null;
  right: CardPort;
  label: string;
  /** Au moins une extrémité câblée → trait coloré. */
  active: boolean;
  color: string;
};

/** Mini-en-tête d'une bande de groupe (vue Générale). */
export type CardSegment = { label: string; y: number };

export type CardDivider = {
  y: number;
  /** `port` = filet court centré ; `segment` = pleine largeur de carte. */
  kind: "port" | "segment";
};

export type EquipmentCardDescriptor = {
  slotId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isPanel: boolean;
  title: string;
  subtitle: string | null;
  rowLabel: string | null;
  container: { label: string; color: string | null } | null;
  badges: CardBadge[];
  /** Rangées d'équipement. Vide pour un panel. */
  ports: CardPort[];
  /** Traversées de panel. Vide pour un équipement. */
  panelRows: CardPanelRow[];
  segments: CardSegment[];
  dividers: CardDivider[];
};

/**
 * Cotes de la carte. Les quatre premières sont IMPORTÉES du module de types —
 * c'est la source unique, partagée avec le rendu écran et le calcul de
 * cadrage. Les recopier ici aurait suffi à faire diverger le PDF le jour où
 * l'une d'elles bouge. Les suivantes sont propres au dessin et n'existent
 * qu'en littéraux dans `SynopticNode`.
 */
export const CARD_METRICS = {
  /** Largeur d'une carte d'équipement. */
  width: NODE_W,
  /** Largeur d'une carte de panel. */
  panelWidth: PANEL_NODE_W,
  /** Hauteur d'une rangée de port. */
  portH: PORT_H,
  /** Hauteur du bandeau d'en-tête. */
  headerH: NODE_HEADER_H,
  /** Hauteur minimale de carte. */
  minH: NODE_MIN_H,
  /** Hauteur d'un mini-en-tête de bande. */
  segmentHeaderH: 22,
  /** Rayon des coins. */
  radius: 12,
  /** Retrait horizontal du texte d'en-tête. */
  headerPadX: 12,
  /** Retrait du libellé de port par rapport au bord de la carte. */
  portLabelPadX: 26,
  /** Diamètre d'une pastille de port. */
  dotSize: 12,
  /** Largeur d'un filet court entre deux entrées. */
  portDividerW: 100,
  /** Respiration sous la dernière rangée. */
  bottomPad: 6,
} as const;

/**
 * Légende des signaux.
 *
 * Elle ne vit PAS dans le repère de la scène : c'est un panneau flottant, calé
 * au coin de la zone de travail. Sa boîte est donc mesurée sur la copie — donc
 * dans le repère de la FEUILLE — et non dérivée d'une position de scène. C'est
 * ce qui garantit qu'elle sort là où l'aperçu la montre.
 */
export type LegendDescriptor = {
  /** Boîte en pixels de la BOÎTE de rendu (pas de la scène). */
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  rows: Array<{ color: string; name: string; count: number }>;
  /** Message affiché quand aucun signal n'est câblé. */
  emptyText: string | null;
};

type PortCenterFn = (
  slotId: string,
  portIndex: number,
) => { x: number; y: number; side: "left" | "right" } | null | undefined;

/**
 * Construit les descripteurs de cartes. Fonction PURE : elle ne lit ni le DOM,
 * ni React — les ancres lui sont fournies par `portCenter`.
 */
export function buildEquipmentCards(
  slots: readonly CardSlotInput[],
  positions: Map<string, { x: number; y: number }>,
  portCenter: PortCenterFn,
): EquipmentCardDescriptor[] {
  const out: EquipmentCardDescriptor[] = [];

  for (const slot of slots) {
    const pos = positions.get(slot.id);
    if (!pos) continue;
    const w = slot.isPanel ? CARD_METRICS.panelWidth : CARD_METRICS.width;

    /** Ports résolus, dans l'ordre d'entrée, avec leur ancre. */
    const anchored: Array<{ input: CardPortInput; port: CardPort }> = [];
    for (const p of slot.ports) {
      const c = portCenter(slot.id, p.portIndex);
      if (!c) continue;
      anchored.push({
        input: p,
        port: {
          x: c.x,
          y: c.y,
          side: c.side,
          color: p.color,
          filled: p.filled,
          label: p.label,
          direction: p.direction,
        },
      });
    }

    // Hauteur DÉRIVÉE des ancres : aucune formule de disposition à tenir à
    // jour. Une carte sans port garde la hauteur minimale.
    const lastY = anchored.reduce((m, a) => Math.max(m, a.port.y), -Infinity);
    const h = Number.isFinite(lastY)
      ? Math.max(
          CARD_METRICS.minH,
          lastY + CARD_METRICS.portH / 2 + CARD_METRICS.bottomPad - pos.y,
        )
      : CARD_METRICS.minH;

    const ports: CardPort[] = [];
    const panelRows: CardPanelRow[] = [];
    const segments: CardSegment[] = [];
    const dividers: CardDivider[] = [];

    if (slot.isPanel) {
      // Une traversée par port de droite, appariée au port de gauche de la
      // MÊME entrée — c'est ainsi que la carte est composée à l'écran.
      const leftByEntry = new Map<number, (typeof anchored)[number]>();
      for (const a of anchored) {
        if (a.port.side === "left") leftByEntry.set(a.input.entryIndex, a);
      }
      for (const a of anchored) {
        if (a.port.side !== "right") continue;
        const left = leftByEntry.get(a.input.entryIndex) ?? null;
        panelRows.push({
          y: a.port.y,
          left: left?.port ?? null,
          right: a.port,
          label: a.input.panelLabel ?? a.input.label,
          active: a.port.direction != null || left?.port.direction != null,
          color: a.port.color,
        });
      }
    } else {
      for (const a of anchored) ports.push(a.port);

      // Bandes de groupe : un mini-en-tête au-dessus du premier port de
      // chaque groupe nommé, un filet pleine largeur entre deux bandes.
      const grouped = slot.ports.some((p) => p.groupLabel);
      if (grouped) {
        const order: Array<string | null> = [];
        const seen = new Set<string | null>();
        for (const p of slot.ports) {
          const g = p.groupLabel ?? null;
          if (!seen.has(g)) {
            seen.add(g);
            order.push(g);
          }
        }
        for (let i = 0; i < order.length; i++) {
          const g = order[i];
          const members = anchored.filter(
            (a) => (a.input.groupLabel ?? null) === g,
          );
          if (members.length === 0) continue;
          const top = Math.min(...members.map((m) => m.port.y));
          const bottom = Math.max(...members.map((m) => m.port.y));
          if (g) {
            segments.push({
              label: g,
              y:
                top -
                CARD_METRICS.portH / 2 -
                CARD_METRICS.segmentHeaderH / 2,
            });
          }
          if (i < order.length - 1) {
            dividers.push({
              y: bottom + CARD_METRICS.portH / 2,
              kind: "segment",
            });
          }
        }
      }

      // Filet court à chaque changement d'entrée connecteur, par colonne.
      for (const side of ["left", "right"] as const) {
        const col = anchored.filter((a) => a.port.side === side);
        for (let i = 0; i < col.length - 1; i++) {
          if (col[i + 1].input.entryIndex !== col[i].input.entryIndex) {
            dividers.push({
              y: col[i].port.y + CARD_METRICS.portH / 2,
              kind: "port",
            });
          }
        }
      }
    }

    out.push({
      slotId: slot.id,
      x: pos.x,
      y: pos.y,
      w,
      h,
      isPanel: slot.isPanel,
      title: slot.title,
      subtitle: slot.subtitle,
      rowLabel: slot.rowLabel,
      container: slot.container,
      badges: slot.badges,
      ports,
      panelRows,
      segments,
      dividers,
    });
  }

  return out;
}
