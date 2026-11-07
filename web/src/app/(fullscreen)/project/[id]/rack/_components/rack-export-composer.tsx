"use client";

/**
 * RackExportComposer — éditeur de mise en page de l'export du Rack.
 *
 * Ce n'est PAS un aperçu : c'est la page elle-même. On y pose des objets — une
 * vue d'un contenant, ou un LIEU entier (tous ses contenants côte à côte,
 * agrégés en un seul objet) — on les déplace, on les redimensionne, et le PDF
 * produit est exactement cette composition.
 *
 * Repères :
 *  - la feuille est en **mm** (cf. `rack-export-layout.ts`) ; l'affichage
 *    applique un facteur `MM_PX` fixe puis le zoom du viewport. Les deux ne se
 *    mélangent jamais : un geste en pixels écran est ramené en mm par
 *    `MM_PX * zoom`, et rien d'autre ne dépend du zoom ;
 *  - le cartouche du modèle est rasterisé par l'appelant et composité PAR-DESSUS
 *    les objets, comme dans le PDF. Il n'y a donc pas de « zone utile » calculée :
 *    l'utilisateur voit où le cartouche mord et place ses objets en conséquence ;
 *  - la hauteur d'un objet n'est jamais saisie : elle découle du ratio naturel
 *    mesuré sur le rendu. Le redimensionnement est donc à ratio verrouillé par
 *    construction, pas par une contrainte ajoutée après coup.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { DndContext, useSensors } from "@dnd-kit/core";
import { Loader2, Server } from "@/components/ui/icons";

import { EmptyState } from "@/components/ui/empty-state";
import { standardCartoucheContentZone } from "@/lib/print/technical-frame";
import { cn } from "@/lib/utils";
import type { ViewId } from "@/components/synoptique/lib/types";
import type { Orientation, PaperFormat } from "@/lib/services/print-layout";

import type { RackCanvasData } from "../rack-tab-client";

import {
  MIN_ITEM_W_MM,
  NO_SNAP_GUIDES,
  boundingBox,
  capWidthToPage,
  clampItemPosition,
  defaultItemWidthMm,
  fitIntoZone,
  itemViews,
  layoutPage,
  nextRackExportItemId,
  pageSizeMm,
  placeNewItem,
  rectsIntersect,
  rescaleLayout,
  sameLayout,
  snapLinesFor,
  snapRect,
  snapToleranceMm,
  snapValue,
  type Rect,
  type RackExportItem,
  type RackExportLayout,
  type SnapGuides,
} from "./rack-export-layout";
import {
  LocationViewStage,
  PlaceholderStage,
  RackViewsStage,
  useRackCanvasData,
  viewLabel,
  type RackRenderMode,
} from "./rack-export-stage";

/** Pixels d'affichage par millimètre de feuille, à zoom 1. */
const MM_PX = 4;

/** Sélecteur de la page composée — cible de la capture « Image ». */
export const RACK_COMPOSER_PAGE_SELECTOR = "[data-rack-page]";
/** Ornements d'édition (ring, poignées, guides) à masquer pendant une capture. */
export const RACK_COMPOSER_CHROME_SELECTOR = "[data-composer-chrome]";
/** Sélecteur d'un objet à taille naturelle, par identifiant. */
export function rackViewCaptureSelector(itemId: string): string {
  return `[data-rack-view-capture="${itemId}"]`;
}

/** Marge autour de la feuille quand on recadre. */
const FIT_PADDING_PX = 24;

/**
 * Zone de composition du cartouche INTÉGRÉ, retrait de confort compris : les
 * objets ne viennent pas lécher les filets.
 *
 * Partagée par l'onglet Rack et la planche du dossier. Deux formules jumelles
 * auraient divergé — et comme c'est cette zone qui borne une composition
 * adoptée d'un autre format, une divergence se serait vue directement sur le
 * document.
 */
export function standardComposerZone(page: { w: number; h: number }): Rect {
  const z = standardCartoucheContentZone(page.w, page.h);
  const inset = 4;
  return {
    x: z.x + inset,
    y: z.y + inset,
    w: z.w - inset * 2,
    h: z.h - inset * 2,
  };
}

/**
 * Actions du composeur pilotables depuis la colonne de réglages. Toutes
 * demandent son circuit interne — mesure du rendu, dimensionnement par rapport
 * à la zone, bornage — qu'on ne peut pas remonter au parent sans le dupliquer.
 */
export type RackExportComposerActions = {
  addPlaceholder: () => void;
  duplicateSelection: () => void;
  removeSelection: () => void;
  /** Rend à la sélection sa taille d'origine. Sélection unique uniquement. */
  resetSize: () => void;
  /** Centre la sélection — sa boîte englobante — dans la zone de composition. */
  centerSelection: () => void;
};

export type RackExportContainer = { id: string; name: string };
export type RackExportLocation = {
  id: string;
  name: string;
  /** Contenants rackables du lieu, dans l'ordre de l'inventaire. */
  rackIds: string[];
};

type Natural = { w: number; h: number };

type Handle = "nw" | "ne" | "sw" | "se";

/** Rectangle d'un objet au début d'un geste, avec son identifiant. */
type ItemRect = Rect & { id: string };

/**
 * Gestes du plan de travail. `move` et `resize` portent une LISTE d'objets et
 * leur boîte englobante : la sélection multiple n'est pas un cas particulier
 * greffé après coup, c'est le cas général dont la sélection unique est la
 * forme à un élément. Il n'y a donc qu'un seul chemin de code à raisonner —
 * bornage, magnétisme et guides s'appliquent tous à la boîte.
 */
type Gesture =
  | {
      /**
       * Lasso de sélection. Le rectangle vit dans un état SÉPARÉ (`bandRect`) :
       * le mettre ici obligerait à recréer l'objet de geste à chaque
       * déplacement du pointeur, donc à réabonner les écouteurs 60 fois par
       * seconde.
       */
      kind: "band";
      startX: number;
      startY: number;
      originMm: { x: number; y: number };
      /** Sélection à laquelle le lasso s'ajoute (Cmd/Ctrl maintenu). */
      base: string[];
    }
  | {
      kind: "move";
      startX: number;
      startY: number;
      items: ItemRect[];
      box: Rect;
    }
  | {
      kind: "resize";
      handle: Handle;
      startX: number;
      startY: number;
      items: ItemRect[];
      box: Rect;
    };

export function RackExportComposer({
  projectId,
  containers,
  locations,
  layout,
  onLayoutChange,
  selectedIds,
  onSelectedIdsChange,
  onActionsReady,
  seed,
  paperFormat,
  orientation,
  cartoucheUrl,
  cartoucheError,
  contentZone,
  renderMode,
  showInfo,
}: {
  projectId: string;
  /** Contenants réels du projet (rackables, non virtuels). */
  containers: RackExportContainer[];
  /** Emplacements du projet portant au moins un contenant rackable. */
  locations: RackExportLocation[];
  layout: RackExportLayout;
  onLayoutChange: (next: RackExportLayout) => void;
  /**
   * Sélection PILOTÉE par le parent : la colonne de réglages du modal affiche
   * les propriétés de l'objet sélectionné, elle doit donc la connaître.
   */
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Expose les actions du composeur à la colonne de réglages. STABLE requis. */
  onActionsReady?: (actions: RackExportComposerActions | null) => void;
  /**
   * Composition de départ, reprise de l'état courant de l'onglet Rack. Posée
   * UNE fois, quand la feuille est vide : ouvrir l'export sur une page blanche
   * alors qu'on regardait un contenant force à tout re-choisir.
   */
  seed?:
    | { kind: "rack"; rackId: string; views: ViewId[] }
    | { kind: "location"; locationId: string; view: ViewId }
    | null;
  paperFormat: PaperFormat;
  orientation: Orientation;
  /** Cartouche du modèle rasterisé pleine page (data URL PNG transparent). */
  cartoucheUrl: string | null;
  /**
   * Échec de rasterisation de l'habillage. Signalé explicitement : sans lui,
   * une feuille nue serait indiscernable d'un habillage volontairement vide.
   */
  cartoucheError?: string | null;
  /**
   * Zone utile de la feuille en mm (entre en-tête et pied du cartouche). Elle
   * ne CONTRAINT rien — un objet peut délibérément passer sous le cartouche —
   * elle sert de repère aux placements et tailles par défaut. Absente quand
   * l'habillage ne la déclare pas (cartouche WYSIWYG de l'espace).
   */
  contentZone?: Rect | null;
  renderMode: RackRenderMode;
  showInfo: boolean;
}) {
  const page = useMemo(
    () => pageSizeMm(paperFormat, orientation),
    [paperFormat, orientation],
  );
  const sheetW = page.w * MM_PX;
  const sheetH = page.h * MM_PX;

  /** Zone de pose par défaut — la feuille moins une marge si non déclarée. */
  const zone = useMemo<Rect>(() => {
    if (contentZone) return contentZone;
    const m = 12;
    return { x: m, y: m, w: page.w - m * 2, h: page.h - m * 2 };
  }, [contentZone, page]);

  const locationById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  /** Contenants à charger : ceux posés seuls + ceux des lieux posés. */
  const rackIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of layout.items) {
      if (item.kind === "rack") ids.push(item.rackId);
      else if (item.kind === "location")
        ids.push(...(locationById.get(item.locationId)?.rackIds ?? []));
      // placeholder : rien à charger.
    }
    return ids;
  }, [layout.items, locationById]);
  const { byRack, loading, error } = useRackCanvasData(projectId, rackIds);

  /** Contenants d'un objet lieu, dans l'ordre, une fois chargés. */
  const locationRacksFor = useCallback(
    (locationId: string) => {
      const ids = locationById.get(locationId)?.rackIds ?? [];
      const loaded = ids.map((id) => byRack[id]).filter((d) => !!d);
      return loaded.length === ids.length ? loaded : null;
    },
    [locationById, byRack],
  );

  /** Taille naturelle du rendu de chaque objet, en px de layout. */
  const [natural, setNatural] = useState<Record<string, Natural>>({});
  const reportNatural = useCallback((itemId: string, w: number, h: number) => {
    setNatural((prev) => {
      const cur = prev[itemId];
      if (cur && Math.abs(cur.w - w) < 0.5 && Math.abs(cur.h - h) < 0.5) {
        return prev;
      }
      return { ...prev, [itemId]: { w, h } };
    });
  }, []);

  /** Hauteur d'un objet sur la feuille (mm), déduite du ratio naturel. */
  const itemHeight = useCallback(
    (item: RackExportItem): number => {
      const nat = natural[item.id];
      if (!nat || nat.w <= 0) return item.w;
      return (item.w * nat.h) / nat.w;
    },
    [natural],
  );

  const itemLabel = useCallback(
    (item: RackExportItem): string => {
      if (item.kind === "placeholder") return "Objet à configurer";
      const name =
        item.kind === "rack"
          ? (containers.find((c) => c.id === item.rackId)?.name ??
            byRack[item.rackId]?.rack.name ??
            "Contenant")
          : (locationById.get(item.locationId)?.name ?? "Emplacement");
      return `${name} · ${itemViews(item).map(viewLabel).join(" + ")}`;
    },
    [containers, byRack, locationById],
  );

  /** Rectangle d'un objet sur la feuille (mm). */
  const itemRect = useCallback(
    (item: RackExportItem): ItemRect => ({
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: itemHeight(item),
    }),
    [itemHeight],
  );

  // ── Sélection ─────────────────────────────────────────────────────────────
  // Toujours une LISTE, y compris à un élément : la sélection unique n'est
  // qu'un cas de la sélection multiple, pas un mode à part.
  const setSelectedIds = onSelectedIdsChange;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => layout.items.filter((i) => selectedSet.has(i.id)),
    [layout.items, selectedSet],
  );
  /** Boîte englobante de la sélection — support du chrome et des gestes. */
  const selectionBox = useMemo(
    () => boundingBox(selectedItems.map(itemRect)),
    [selectedItems, itemRect],
  );
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // ── Cadrage ───────────────────────────────────────────────────────────────
  //
  // La feuille est TOUJOURS ajustée au maximum de la zone d'aperçu. Ni zoom ni
  // panoramique : la page est un objet fini qu'on veut voir en entier, pas un
  // plan qu'on explore. Supprimer ces deux gestes libère aussi le glisser du
  // fond, qui devient le lasso de sélection.
  //
  // `zoom` et `pan` ne sont donc plus des réglages mais des valeurs DÉRIVÉES de
  // la taille de la zone et de celle de la feuille — d'où le recalcul sur
  // observation du viewport plutôt que sur un geste.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let frame = 0;
    const measure = () => {
      const rect = vp.getBoundingClientRect();
      // ARRONDI à l'entier : une colonne dimensionnée en pourcentage produit
      // des largeurs fractionnaires qui varient d'un rendu à l'autre. Comparer
      // des flottants laisserait passer une oscillation permanente.
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setViewportSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    // Le modal s'ouvre en s'animant : à la première passe, la zone mesure
    // encore 0. L'observation garantit qu'on recadre dès qu'elle a une taille,
    // puis à chaque redimensionnement de la fenêtre.
    //
    // Mesure DIFFÉRÉE d'une frame : un `ResizeObserver` dont le rappel modifie
    // l'état — donc la mise en page — peut se ré-entrer dans la même passe.
    // Ici la feuille est en position absolue et le modal a des cotes fixes, la
    // taille observée ne dépend donc pas du résultat ; le report est une
    // ceinture de sécurité contre une régression de mise en page qui
    // réintroduirait la boucle.
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(vp);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const { zoom, pan } = useMemo(() => {
    if (viewportSize.w <= 0 || viewportSize.h <= 0) {
      return { zoom: 1, pan: { x: 0, y: 0 } };
    }
    // Plafond à 1 : agrandir au-delà de la taille naturelle ne révèle rien de
    // plus et alourdit le rendu. Pas de plancher — la feuille doit tenir,
    // quelle que soit sa taille.
    const z = Math.min(
      1,
      (viewportSize.w - FIT_PADDING_PX * 2) / sheetW,
      (viewportSize.h - FIT_PADDING_PX * 2) / sheetH,
    );
    return {
      zoom: z,
      pan: {
        x: (viewportSize.w - sheetW * z) / 2,
        y: (viewportSize.h - sheetH * z) / 2,
      },
    };
  }, [viewportSize, sheetW, sheetH]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // ── Mutations de la composition ───────────────────────────────────────────
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /**
   * Point de passage UNIQUE de toute écriture de composition.
   *
   * Trois effets recalculent la composition (placement différé, mise à
   * l'échelle du format, borne au papier) et produisent un objet neuf à chaque
   * passe. Sans comparaison par VALEUR ici, publier un résultat identique
   * relancerait ces mêmes effets — et, la composition étant persistée, une
   * écriture `localStorage` synchrone à chaque tour. C'est la boucle de rendu
   * que ce garde rend structurellement impossible : on ne raisonne plus effet
   * par effet, la règle est tenue en un seul endroit.
   */
  const commitLayout = useCallback(
    (next: RackExportLayout) => {
      if (sameLayout(layoutRef.current, next)) return;
      // arkyo-server: amorçage perdu à la première ouverture (défaut d'arkyo) :
      // le ref suit l'écriture sans attendre le rendu, pour que l'effet de la
      // feuille parte de la composition publiée.
      layoutRef.current = next;
      onLayoutChange(next);
    },
    [onLayoutChange],
  );

  /**
   * Applique un lot de positions/tailles en une seule mise à jour.
   *
   * Passe par `commitLayout` : appelé à chaque `pointermove`, il produit
   * souvent un résultat IDENTIQUE (magnétisme qui maintient l'objet accroché,
   * bornage qui le retient contre un bord). Sans le garde, c'était une
   * sérialisation et une écriture `localStorage` synchrones par image.
   */
  const patchItems = useCallback(
    (patches: ReadonlyArray<{ id: string; x: number; y: number; w: number }>) => {
      const byId = new Map(patches.map((p) => [p.id, p]));
      commitLayout({
        ...layoutRef.current,
        items: layoutRef.current.items.map((i): RackExportItem => {
          const p = byId.get(i.id);
          return p ? { ...i, x: p.x, y: p.y, w: p.w } : i;
        }),
      });
    },
    [commitLayout],
  );

  const removeSelection = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) return;
    onLayoutChange({
      ...layoutRef.current,
      items: layoutRef.current.items.filter((i) => !ids.has(i.id)),
    });
    setSelectedIds([]);
  }, [onLayoutChange]);

  /**
   * Clic sur un objet. Sans modificateur la sélection devient exclusive et
   * l'objet remonte au-dessus des autres — l'ordre du tableau EST le z-order,
   * ici comme dans le PDF, donc pas de champ `z` à maintenir. Avec Maj ou
   * Cmd/Ctrl on bascule son appartenance SANS réordonner : remonter un objet à
   * chaque ajout mélangerait la pile sous la main de l'utilisateur.
   */
  const selectFromPointer = useCallback(
    (itemId: string, additive: boolean): string[] => {
      const current = selectedIdsRef.current;
      if (additive) {
        const next = current.includes(itemId)
          ? current.filter((id) => id !== itemId)
          : [...current, itemId];
        setSelectedIds(next);
        return next;
      }
      // Objet déjà dans une sélection multiple : on la conserve, sinon
      // amorcer un déplacement groupé serait impossible (le premier appui la
      // réduirait à un seul objet).
      if (current.length > 1 && current.includes(itemId)) return current;
      setSelectedIds([itemId]);
      const items = layoutRef.current.items;
      if (items[items.length - 1]?.id !== itemId) {
        const target = items.find((i) => i.id === itemId);
        if (target) {
          onLayoutChange({
            ...layoutRef.current,
            items: [...items.filter((i) => i.id !== itemId), target],
          });
        }
      }
      return [itemId];
    },
    [onLayoutChange],
  );

  /**
   * Objets posés mais pas encore dimensionnés : dès que le rendu est mesuré, on
   * leur donne une taille et une place cohérentes avec la feuille. Sans ce
   * report, il faudrait deviner le ratio d'une élévation avant de l'avoir vue.
   */
  const pendingPlacement = useRef<Set<string>>(new Set());

  const addItem = useCallback(
    (item: RackExportItem) => {
      // arkyo-server: amorçage perdu à la première ouverture (défaut d'arkyo) :
      // le ref suit l'écriture, l'effet de la feuille du même commit lit l'amorce.
      const next = {
        ...layoutRef.current,
        items: [...layoutRef.current.items, item],
      };
      layoutRef.current = next;
      onLayoutChange(next);
      setSelectedIds([item.id]);
      pendingPlacement.current.add(item.id);
    },
    [onLayoutChange, setSelectedIds],
  );

  /**
   * Composition de départ : ce que l'onglet affichait au moment d'ouvrir
   * l'export. Posée une seule fois, et seulement sur une feuille vide — jamais
   * par-dessus une composition existante.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !seed) return;
    if (layoutRef.current.items.length > 0) {
      // Composition restaurée : elle prime, l'amorçage est renoncé.
      seeded.current = true;
      return;
    }
    seeded.current = true;
    const base = { id: nextRackExportItemId(), x: 12, y: 12, w: 60 };
    addItem(
      seed.kind === "rack"
        ? { ...base, kind: "rack", rackId: seed.rackId, views: seed.views }
        : {
            ...base,
            kind: "location",
            locationId: seed.locationId,
            view: seed.view,
          },
    );
  }, [seed, addItem]);

  /** Pose un emplacement vide, à configurer depuis la colonne de réglages. */
  const addPlaceholder = useCallback(() => {
    addItem({ kind: "placeholder", id: nextRackExportItemId(), x: 12, y: 12, w: 60 });
  }, [addItem]);

  useEffect(() => {
    const pending = [...pendingPlacement.current];
    if (pending.length === 0) return;
    const ready = pending.filter((id) => natural[id]);
    if (ready.length === 0) return;
    let items = layoutRef.current.items;
    for (const id of ready) {
      pendingPlacement.current.delete(id);
      const nat = natural[id]!;
      if (!items.some((i) => i.id === id)) continue;
      const ratio = nat.w / nat.h;
      const w = defaultItemWidthMm(ratio, zone);
      const h = w / ratio;
      const others = items
        .filter((i) => i.id !== id)
        .map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemHeight(i) }));
      const pos = placeNewItem(others, w, h, zone);
      items = items.map((i): RackExportItem =>
        i.id === id
          ? { ...i, w, ...clampItemPosition(pos.x, pos.y, w, h, page) }
          : i,
      );
    }
    commitLayout({ ...layoutRef.current, items });
    // `itemHeight` est stable par construction ; on ne veut ce passage QUE
    // lorsqu'une mesure arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, page, zone, commitLayout]);

  // ── La composition suit la feuille ────────────────────────────────────────
  //
  // UN SEUL effet pour deux règles qui portent sur la même chose :
  //  1. changer de format remet la composition à l'échelle — ce qui doit se
  //     conserver d'un papier à l'autre, c'est l'ALLURE de la page, pas des
  //     cotes absolues (sans quoi une composition A4 devient un timbre-poste
  //     sur A0) ;
  //  2. aucun objet n'est jamais plus grand que le papier.
  //
  // Les séparer était un BUG : sur un changement de format, les deux effets se
  // déclenchaient dans le même commit et lisaient tous deux la composition
  // d'AVANT. La mise à l'échelle publiait sa version, la borne publiait la
  // sienne — calculée sur les anciennes cotes — et, écrivant en dernier,
  // l'écrasait. D'où l'asymétrie observée : en agrandissant la borne n'avait
  // rien à faire et la mise à l'échelle survivait ; en réduisant elle mordait
  // et annulait tout. Ici l'ordre est explicite et il n'y a qu'une écriture.
  //
  // La feuille de DÉPART est celle que la composition déclare (`layout.page`),
  // à défaut celle du passage précédent. Se fier au seul passage précédent était
  // aveugle au cas qui compte : une composition RESTAURÉE — d'une session
  // antérieure, ou de l'onglet lorsque la planche du dossier impose son format —
  // arrivait sur une feuille qu'elle n'avait jamais connue, sans que rien ne
  // signale le changement. D'où des objets aux cotes d'un autre papier, à cheval
  // sur le cartouche.
  //
  // Un objet pas encore mesuré est laissé tel quel : son ratio est inconnu, le
  // borner reviendrait à deviner. Il est mis en attente et repris à l'arrivée de
  // sa mesure — sinon il échapperait définitivement à l'adoption.
  const prevPageRef = useRef<{ w: number; h: number } | null>(null);
  const pendingFit = useRef<Set<string>>(new Set());
  useEffect(() => {
    // arkyo-server: amorçage perdu à la première ouverture (défaut d'arkyo) :
    // `layout` (rendu) précède l'amorce posée dans le même commit, le ref la
    // porte ; `layout` reste en dépendance pour déclencher l'effet.
    const current = layoutRef.current;
    const declared = layoutPage(current);
    const from = declared ?? prevPageRef.current;
    const pageChanged =
      !!from &&
      (Math.abs(from.w - page.w) > 0.001 || Math.abs(from.h - page.h) > 0.001);
    prevPageRef.current = page;

    // Composition SANS repère : son papier d'origine est inconnu, on ne peut
    // donc pas la remettre à l'échelle — mais on peut garantir qu'elle tient
    // dans la surface utile. C'est le cas de toutes les compositions antérieures
    // au repère, dont certaines faisaient la pleine hauteur d'un autre format et
    // arrivaient à cheval sur le cartouche.
    //
    // La condition s'éteint d'elle-même : le passage qui adopte estampille la
    // feuille, et `declared` est vrai au suivant.
    const adopt = pageChanged || (!declared && current.items.length > 0);

    const scaled =
      pageChanged && from ? rescaleLayout(current, from, page) : current;
    if (adopt) {
      for (const i of scaled.items) pendingFit.current.add(i.id);
    }

    const items = scaled.items.map((i): RackExportItem => {
      const nat = natural[i.id];
      if (!nat || nat.h <= 0) return i;
      const ratio = nat.w / nat.h;

      // Adoption d'une feuille : l'objet est ramené dans la ZONE UTILE.
      if (pendingFit.current.has(i.id)) {
        pendingFit.current.delete(i.id);
        return { ...i, ...fitIntoZone(i.x, i.y, i.w, ratio, zone) };
      }

      // Régime courant : jamais plus grand que le PAPIER, et rien de plus —
      // déborder sous le cartouche reste un choix de composition légitime.
      const capped = capWidthToPage(i.w, ratio, page);
      if (Math.abs(capped - i.w) < 0.01) return i;
      return {
        ...i,
        w: capped,
        ...clampItemPosition(i.x, i.y, capped, capped / ratio, page),
      };
    });

    // `commitLayout` compare par valeur : rien ne part si rien n'a bougé. La
    // feuille est estampillée à chaque passage — c'est ce qui rend la
    // composition relisible par un autre consommateur.
    commitLayout({ items, page: { w: page.w, h: page.h } });
  }, [layout, natural, page, zone, commitLayout]);

  /** Duplique la sélection entière, décalée, et la rend sélectionnée. */
  const duplicateSelection = () => {
    const ids = new Set(selectedIdsRef.current);
    const sources = layoutRef.current.items.filter((i) => ids.has(i.id));
    if (sources.length === 0) return;
    const OFFSET = 8;
    const copies: RackExportItem[] = [];
    const ratios: Record<string, Natural> = {};
    for (const src of sources) {
      const id = nextRackExportItemId();
      const pos = clampItemPosition(
        src.x + OFFSET,
        src.y + OFFSET,
        src.w,
        itemHeight(src),
        page,
      );
      copies.push({ ...src, id, ...pos });
      const nat = natural[src.id];
      if (nat) ratios[id] = nat;
    }
    onLayoutChange({
      ...layoutRef.current,
      items: [...layoutRef.current.items, ...copies],
    });
    setSelectedIds(copies.map((c) => c.id));
    // Les duplicatas connaissent déjà leur taille : on leur recopie le ratio
    // mesuré et on ne les met PAS en attente de placement, sinon ils
    // sauteraient ailleurs.
    setNatural((prev) => ({ ...prev, ...ratios }));
  };

  const resetItemSize = (itemId: string) => {
    const item = layoutRef.current.items.find((i) => i.id === itemId);
    const nat = item ? natural[itemId] : null;
    if (!item || !nat || nat.h <= 0) return;
    const w = defaultItemWidthMm(nat.w / nat.h, zone);
    const h = w / (nat.w / nat.h);
    const pos = clampItemPosition(item.x, item.y, w, h, page);
    patchItems([{ id: itemId, w, ...pos }]);
  };

  /**
   * Centre la sélection dans la zone de composition, taille inchangée. On
   * déplace la BOÎTE englobante et on reporte le même écart sur chaque objet :
   * les positions relatives d'un groupe sont préservées.
   */
  const centerSelection = () => {
    const ids = new Set(selectedIdsRef.current);
    const rects = layoutRef.current.items
      .filter((i) => ids.has(i.id))
      .map((i) => itemRect(i));
    const box = boundingBox(rects);
    if (!box) return;
    const target = clampItemPosition(
      zone.x + (zone.w - box.w) / 2,
      zone.y + (zone.h - box.h) / 2,
      box.w,
      box.h,
      page,
    );
    const dx = target.x - box.x;
    const dy = target.y - box.y;
    patchItems(rects.map((r) => ({ id: r.id, x: r.x + dx, y: r.y + dy, w: r.w })));
  };

  /**
   * Les commandes vivent dans la colonne de RÉGLAGES, pas ici. Elles demandent
   * pourtant le circuit interne du composeur (mesure du rendu, dimensionnement
   * par rapport à la zone, bornage), qu'on ne peut pas remonter au parent sans
   * le dupliquer : on lui confie l'action, pas le mécanisme.
   *
   * Les fonctions exposées lisent leurs entrées via des refs, l'objet d'actions
   * est donc recréé au minimum — le parent le range dans un ref, jamais dans un
   * state.
   */
  const latestActions: RackExportComposerActions = {
    addPlaceholder,
    duplicateSelection,
    removeSelection,
    centerSelection,
    resetSize: () => {
      const ids = selectedIdsRef.current;
      if (ids.length === 1) resetItemSize(ids[0]!);
    },
  };
  const actionsRef = useRef(latestActions);
  actionsRef.current = latestActions;
  useEffect(() => {
    onActionsReady?.({
      addPlaceholder: () => actionsRef.current.addPlaceholder(),
      duplicateSelection: () => actionsRef.current.duplicateSelection(),
      removeSelection: () => actionsRef.current.removeSelection(),
      centerSelection: () => actionsRef.current.centerSelection(),
      resetSize: () => actionsRef.current.resetSize(),
    });
    return () => onActionsReady?.(null);
  }, [onActionsReady]);

  // ── Gestes (déplacement, redimensionnement, panoramique, lasso) ───────────
  const gestureRef = useRef<Gesture | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [guides, setGuides] = useState<SnapGuides>(NO_SNAP_GUIDES);
  /** Rectangle du lasso en cours, en mm sur la feuille. */
  const [bandRect, setBandRect] = useState<Rect | null>(null);

  /**
   * Rectangles des objets NON concernés par le geste — cibles d'alignement.
   * Recalculés au début de chaque geste plutôt qu'en continu : ils ne bougent
   * pas pendant le drag.
   */
  const snapTargetsExcept = useCallback(
    (ids: ReadonlySet<string>): Rect[] =>
      layoutRef.current.items
        .filter((i) => !ids.has(i.id))
        .map((i) => ({ x: i.x, y: i.y, w: i.w, h: itemHeight(i) })),
    [itemHeight],
  );

  useEffect(() => {
    if (!gesture) return;
    const toMm = (px: number) => px / (MM_PX * zoomRef.current);
    /** Constante à l'écran : cf. `snapToleranceMm`. */
    const tolerance = () => snapToleranceMm(MM_PX * zoomRef.current);

    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;

      if (g.kind === "band") {
        const cur = {
          x: g.originMm.x + toMm(e.clientX - g.startX),
          y: g.originMm.y + toMm(e.clientY - g.startY),
        };
        const rect: Rect = {
          x: Math.min(g.originMm.x, cur.x),
          y: Math.min(g.originMm.y, cur.y),
          w: Math.abs(cur.x - g.originMm.x),
          h: Math.abs(cur.y - g.originMm.y),
        };
        setBandRect(rect);
        const hit = layoutRef.current.items
          .filter((i) => rectsIntersect(rect, itemRect(i)))
          .map((i) => i.id);
        setSelectedIds([...new Set([...g.base, ...hit])]);
        return;
      }

      // Alt échappe au magnétisme — geste standard des éditeurs de mise en page.
      const magnetic = !e.altKey;
      const moved = new Set(g.items.map((i) => i.id));
      const lines = snapLinesFor(snapTargetsExcept(moved), page);

      if (g.kind === "move") {
        // Le magnétisme et le bornage portent sur la BOÎTE du groupe, jamais
        // sur les objets un par un : c'est ce qui préserve leurs positions
        // relatives, et ce qui rend la sélection unique identique au reste.
        const raw = {
          ...g.box,
          x: g.box.x + toMm(e.clientX - g.startX),
          y: g.box.y + toMm(e.clientY - g.startY),
        };
        const snapped = magnetic
          ? snapRect(raw, lines, tolerance())
          : { x: raw.x, y: raw.y, guides: NO_SNAP_GUIDES };
        setGuides(snapped.guides);
        const bounded = clampItemPosition(
          snapped.x,
          snapped.y,
          raw.w,
          raw.h,
          page,
        );
        const dx = bounded.x - g.box.x;
        const dy = bounded.y - g.box.y;
        patchItems(
          g.items.map((i) => ({ id: i.id, x: i.x + dx, y: i.y + dy, w: i.w })),
        );
        return;
      }

      // ── Redimensionnement ────────────────────────────────────────────────
      // Homothétie de la boîte : un SEUL facteur d'échelle, appliqué aux
      // positions relatives et aux largeurs. Comme la hauteur de chaque objet
      // découle de sa largeur par son ratio naturel, les proportions sont
      // préservées sans avoir à les recalculer.
      //
      // Le geste HORIZONTAL commande la taille (le plus prévisible avec des
      // ratios verrouillés) ; la hauteur en découle. Le magnétisme, lui,
      // considère les DEUX bords en mouvement : le bord vertical saisi peut
      // s'aligner sur une ligne X, le bord horizontal sur une ligne Y. On
      // retient l'accroche la plus proche, et une seule — deux simultanées se
      // contrediraient, l'homothétie n'ayant qu'un degré de liberté.
      const dirX = g.handle === "ne" || g.handle === "se" ? 1 : -1;
      const dirY = g.handle === "sw" || g.handle === "se" ? 1 : -1;
      // Bords ANCRÉS : ceux du coin opposé à la poignée, ils ne bougent pas.
      const anchorX = dirX === 1 ? g.box.x : g.box.x + g.box.w;
      const anchorY = dirY === 1 ? g.box.y : g.box.y + g.box.h;
      const ratio = g.box.w / g.box.h;

      /** Largeur minimale du groupe : le plus petit objet reste lisible. */
      const minW = Math.max(
        MIN_ITEM_W_MM,
        ...g.items.map((i) => (MIN_ITEM_W_MM * g.box.w) / Math.max(i.w, 0.001)),
      );

      let boxW = Math.max(
        minW,
        g.box.w + dirX * toMm(e.clientX - g.startX),
      );
      let snapGuides: SnapGuides = NO_SNAP_GUIDES;

      if (magnetic) {
        const tol = tolerance();
        const movingX = anchorX + dirX * boxW;
        const movingY = anchorY + dirY * (boxW / ratio);
        const hitX = snapValue(movingX, lines.x, tol);
        const hitY = snapValue(movingY, lines.y, tol);
        const deltaX = hitX ? Math.abs(hitX.line - movingX) : Infinity;
        const deltaY = hitY ? Math.abs(hitY.line - movingY) : Infinity;
        if (hitX && deltaX <= deltaY) {
          boxW = Math.max(minW, Math.abs(hitX.value - anchorX));
          snapGuides = { x: [hitX.line], y: [] };
        } else if (hitY) {
          boxW = Math.max(minW, Math.abs(hitY.value - anchorY) * ratio);
          snapGuides = { x: [], y: [hitY.line] };
        }
      }
      setGuides(snapGuides);

      // Jamais plus grand que le papier — borne appliquée APRÈS le magnétisme,
      // sinon une accroche pourrait faire déborder la boîte.
      boxW = capWidthToPage(boxW, ratio, page);

      const scale = boxW / g.box.w;
      const boxH = g.box.h * scale;
      const boxX = dirX === 1 ? anchorX : anchorX - boxW;
      const boxY = dirY === 1 ? anchorY : anchorY - boxH;
      const bounded = clampItemPosition(boxX, boxY, boxW, boxH, page);
      patchItems(
        g.items.map((i) => ({
          id: i.id,
          x: bounded.x + (i.x - g.box.x) * scale,
          y: bounded.y + (i.y - g.box.y) * scale,
          w: i.w * scale,
        })),
      );
    };

    const onUp = () => {
      gestureRef.current = null;
      setGesture(null);
      setGuides(NO_SNAP_GUIDES);
      setBandRect(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gesture, page, patchItems, snapTargetsExcept, itemRect]);

  const beginGesture = (g: Gesture) => {
    gestureRef.current = g;
    setGesture(g);
  };

  /**
   * Appui sur le fond : lasso de sélection. Le panoramique ayant disparu (la
   * feuille est toujours ajustée), le glisser du fond n'a plus qu'un sens
   * possible — inutile de le réserver à une touche.
   */
  const startBackgroundGesture = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const originMm = {
      x: (e.clientX - rect.left - pan.x) / (MM_PX * zoom),
      y: (e.clientY - rect.top - pan.y) / (MM_PX * zoom),
    };
    // Maj ou Cmd/Ctrl : le lasso s'ajoute à la sélection courante. Sans
    // modificateur il la remplace, ce qui inclut la vider d'un simple clic.
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) setSelectedIds([]);
    beginGesture({
      kind: "band",
      startX: e.clientX,
      startY: e.clientY,
      originMm,
      base: additive ? selectedIdsRef.current : [],
    });
    setBandRect({ ...originMm, w: 0, h: 0 });
  };

  /** Objets à embarquer dans un geste, d'après la sélection résultante. */
  const gestureItems = (ids: readonly string[]): ItemRect[] =>
    layoutRef.current.items
      .filter((i) => ids.includes(i.id))
      .map((i) => itemRect(i));

  const startMove = (e: ReactPointerEvent, item: RackExportItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const ids = selectFromPointer(item.id, additive);
    // Un ajout à la sélection n'amorce pas de déplacement : le geste attendu
    // est un clic, pas un glisser.
    if (additive) return;
    const items = gestureItems(ids);
    const box = boundingBox(items);
    if (!box) return;
    beginGesture({
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      items,
      box,
    });
  };

  const startResize = (e: ReactPointerEvent, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const items = gestureItems(selectedIdsRef.current);
    const box = boundingBox(items);
    if (!box || box.w <= 0 || box.h <= 0) return;
    beginGesture({
      kind: "resize",
      handle,
      startX: e.clientX,
      startY: e.clientY,
      items,
      box,
    });
  };

  // Raccourcis clavier. La colonne de réglages du modal a des champs de
  // saisie : on ignore les frappes qui en viennent.
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
        return;
      }
      if (e.key === "Escape") {
        // Échap désélectionne AVANT de fermer le modal — convention d'éditeur.
        // D'où la capture et l'arrêt de propagation : Radix écoute plus bas.
        e.stopPropagation();
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedIds.length, removeSelection]);

  // Un capteur vide : `RackVisual` / `DraggableSlot` réclament un `DndContext`
  // (ils appellent `useDraggable` sans condition) mais aucun drag ne doit
  // pouvoir démarrer ici — la scène est un rendu, pas un éditeur.
  const noSensors = useSensors();

  if (containers.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <EmptyState
          icon={<Server strokeWidth={1.5} />}
          title="Aucun contenant"
          description="Ajoutez un contenant au projet pour composer une planche d'élévations."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Pas de barre d'outils : l'ajout et les réglages de l'objet vivent
          dans la colonne de réglages du modal. La feuille occupe donc toute la
          hauteur, et la page reste l'unique sujet de cette colonne. */}

      {/* ── Feuille ────────────────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        onPointerDown={startBackgroundGesture}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          background:
            "color-mix(in srgb, var(--foreground) 5%, var(--background))",
          cursor: "crosshair",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <div
            // Cible de la capture « Image » : la PAGE composée, cartouche
            // compris. html-to-image clone ce nœud sans les transformations
            // ancêtres — la capture est donc toujours à l'échelle de la
            // feuille, quel que soit le zoom de travail.
            data-rack-page=""
            className="relative"
            style={{
              width: sheetW,
              height: sheetH,
              background: "#ffffff",
              boxShadow:
                "0 1px 2px rgba(15,17,26,0.06), 0 8px 28px rgba(15,17,26,0.10)",
              // Le PDF coupe au bord de la feuille : l'éditeur doit couper
              // pareil, sinon un objet qui déborde paraîtrait exportable.
              overflow: "hidden",
            }}
          >
            <DndContext id="rack-export-stage-dnd" sensors={noSensors}>
              {layout.items.map((item) => {
                const nat = natural[item.id];
                const scale = nat && nat.w > 0 ? (item.w * MM_PX) / nat.w : 1;
                const isSelected = selectedSet.has(item.id);
                const h = itemHeight(item);
                const moving = gesture?.kind === "move" && isSelected;
                return (
                  <div
                    key={item.id}
                    onPointerDown={(e) => startMove(e, item)}
                    className="absolute"
                    style={{
                      left: item.x * MM_PX,
                      top: item.y * MM_PX,
                      width: item.w * MM_PX,
                      height: h * MM_PX,
                      cursor: moving ? "grabbing" : "grab",
                    }}
                  >
                    {/* Nœud mis à l'échelle. La scène qu'il contient reste à
                        taille naturelle : c'est elle que la capture vise. */}
                    <div
                      style={{
                        transform: `scale(${scale})`,
                        transformOrigin: "0 0",
                        width: "max-content",
                        // Tant que le rendu n'est pas mesuré, l'échelle est
                        // fausse : on ne montre rien plutôt qu'un saut.
                        visibility: nat ? "visible" : "hidden",
                      }}
                    >
                      <MeasuredStage itemId={item.id} onMeasure={reportNatural}>
                        <ItemStage
                          item={item}
                          byRack={byRack}
                          locationRacksFor={locationRacksFor}
                          locationName={
                            item.kind === "location"
                              ? (locationById.get(item.locationId)?.name ??
                                "Emplacement")
                              : ""
                          }
                          // Mode PROPRE à l'objet, à défaut celui de l'onglet.
                          renderMode={item.renderMode ?? renderMode}
                          showInfo={showInfo}
                        />
                      </MeasuredStage>
                    </div>

                    {/* Liseré individuel — uniquement en sélection multiple :
                        en sélection unique la boîte du groupe se confond avec
                        l'objet, deux anneaux superposés feraient sale. */}
                    {isSelected && selectedIds.length > 1 && (
                      <div
                        data-composer-chrome=""
                        className="pointer-events-none absolute"
                        style={{
                          inset: -1 / zoom,
                          border: `${1 / zoom}px solid var(--accent)`,
                          opacity: 0.6,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </DndContext>

            {/* Chrome de sélection — porté par la BOÎTE du groupe, pas par un
                objet : sélection unique et multiple partagent le même rendu. */}
            {selectionBox && gesture?.kind !== "band" && (
              <SelectionChrome
                box={selectionBox}
                zoom={zoom}
                onStartResize={startResize}
              />
            )}

            {/* Lasso de sélection. */}
            {bandRect && (
              <div
                data-composer-chrome=""
                className="pointer-events-none absolute"
                style={{
                  left: bandRect.x * MM_PX,
                  top: bandRect.y * MM_PX,
                  width: bandRect.w * MM_PX,
                  height: bandRect.h * MM_PX,
                  border: `${1 / zoom}px solid var(--accent)`,
                  background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                }}
              />
            )}

            {/* Guides d'alignement — n'existent que pendant un geste.
                Épaisseur `1 / zoom` : exactement 1 px à l'écran, quel que soit
                le zoom. Position ramenée dans la feuille (qui est clippée),
                sinon un guide accroché au bord droit ou au bord bas serait
                dessiné juste en dehors et resterait invisible. */}
            {guides.x.map((mm) => (
              <div
                key={`gx-${mm}`}
                data-composer-chrome=""
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left: Math.min(mm * MM_PX, sheetW - 1 / zoom),
                  width: 1 / zoom,
                  background: "var(--accent)",
                }}
              />
            ))}
            {guides.y.map((mm) => (
              <div
                key={`gy-${mm}`}
                data-composer-chrome=""
                className="pointer-events-none absolute right-0 left-0"
                style={{
                  top: Math.min(mm * MM_PX, sheetH - 1 / zoom),
                  height: 1 / zoom,
                  background: "var(--accent)",
                }}
              />
            ))}

            {/* Cartouche du modèle — composité par-dessus les objets, comme
                dans le PDF : ses blocs pleins masquent ce qui passe dessous. */}
            {cartoucheUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cartoucheUrl}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Barre de pied : état de la sélection ────────────────────────── */}
      <div className="border-border/60 flex flex-none items-center gap-2 border-t px-3 py-1.5">
        {loading > 0 && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted-foreground)]" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            error || cartoucheError
              // arkyo-server: habillage Strata (texte d'erreur : --danger-text)
              ? "text-[var(--danger-text)]"
              : "text-[var(--muted-foreground)]",
          )}
        >
          {error ??
            cartoucheError ??
            (selectedItems.length === 1
              ? itemLabel(selectedItems[0]!)
              : selectedItems.length > 1
                ? `${selectedItems.length} vues sélectionnées`
                : "")}
        </span>
        {selectionBox && (
          <span
            className="shrink-0 text-[10px] text-[var(--muted-foreground)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {Math.round(selectionBox.w)}×{Math.round(selectionBox.h)} mm
          </span>
        )}
      </div>
    </div>
  );
}

// ── Rendu d'un objet selon sa nature ────────────────────────────────────────

function ItemStage({
  item,
  byRack,
  locationRacksFor,
  locationName,
  renderMode,
  showInfo,
}: {
  item: RackExportItem;
  byRack: Record<string, RackCanvasData>;
  locationRacksFor: (locationId: string) => RackCanvasData[] | null;
  locationName: string;
  renderMode: RackRenderMode;
  showInfo: boolean;
}) {
  if (item.kind === "placeholder") return <PlaceholderStage />;
  if (item.kind === "location") {
    // Le groupe n'est monté QUE lorsque tous ses contenants sont chargés :
    // le mesurer à moitié rempli figerait un ratio faux, et l'objet sauterait
    // de taille à l'arrivée des colonnes manquantes.
    const racks = locationRacksFor(item.locationId);
    if (!racks || racks.length === 0) return null;
    return (
      <LocationViewStage
        racks={racks}
        view={item.view}
        locationName={locationName}
        renderMode={renderMode}
        showInfo={showInfo}
        captureId={item.id}
        label={item.label}
      />
    );
  }
  const data = byRack[item.rackId];
  if (!data) return null;
  return (
    <RackViewsStage
      data={data}
      views={item.views}
      renderMode={renderMode}
      showInfo={showInfo}
      captureId={item.id}
      label={item.label}
    />
  );
}

// ── Chrome de sélection : anneau et poignées ────────────────────────────────

/**
 * Chrome porté par la BOÎTE de la sélection — une vue ou plusieurs, même
 * rendu. Tout est contre-mis à l'échelle par `1 / zoom` : anneau et poignées
 * gardent la même taille à l'écran quelle que soit l'échelle d'affichage de la
 * feuille. Sans ça, une poignée deviendrait insaisissable sur un grand format.
 *
 * AUCUNE action ici : dupliquer, réinitialiser la taille et supprimer vivent
 * dans la colonne de réglages, avec le reste de la configuration de la vue.
 * Une barre flottante au-dessus du dessin recouvrait la composition et
 * dispersait les commandes en deux endroits.
 */
function SelectionChrome({
  box,
  zoom,
  onStartResize,
}: {
  box: Rect;
  zoom: number;
  onStartResize: (e: ReactPointerEvent, handle: Handle) => void;
}) {
  const size = 9 / zoom;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: box.x * MM_PX,
        top: box.y * MM_PX,
        width: box.w * MM_PX,
        height: box.h * MM_PX,
      }}
    >
      <div
        data-composer-chrome=""
        className="absolute"
        style={{
          inset: -2 / zoom,
          border: `${2 / zoom}px solid var(--accent)`,
        }}
      />
      {(["nw", "ne", "sw", "se"] as const).map((hnd) => {
        const east = hnd === "ne" || hnd === "se";
        const south = hnd === "sw" || hnd === "se";
        return (
          <div
            key={hnd}
            data-composer-chrome=""
            onPointerDown={(e) => onStartResize(e, hnd)}
            className="pointer-events-auto absolute"
            style={{
              left: east ? box.w * MM_PX - size / 2 : -size / 2,
              top: south ? box.h * MM_PX - size / 2 : -size / 2,
              width: size,
              height: size,
              background: "var(--accent)",
              borderRadius: size / 4,
              cursor: hnd === "nw" || hnd === "se" ? "nwse-resize" : "nesw-resize",
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Mesure la taille NATURELLE (hors transformation) du rendu qu'il enveloppe.
 * `offsetWidth/Height` et `ResizeObserver` renvoient la taille de mise en page,
 * insensible au `scale` de l'ancêtre — c'est ce qu'il faut pour en déduire le
 * ratio, puis l'échelle d'affichage.
 */
function MeasuredStage({
  itemId,
  onMeasure,
  children,
}: {
  itemId: string;
  onMeasure: (itemId: string, w: number, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) onMeasure(itemId, w, h);
    };
    report();
    // Un groupe de lieu gagne ses colonnes au fil des chargements, et les
    // polices se substituent après le premier rendu : sans observation, le
    // ratio resterait celui du premier état.
    //
    // Le mode de rendu (STD/GFX/PIC), lui, ne change PAS le ratio : la boîte
    // du rack est dimensionnée par `RACK_BODY_W` et `rackBodyHeight(totalU)`,
    // et les visuels GFX/PIC s'inscrivent dans des slots absolus. L'observation
    // couvre tout de même le cas si cela venait à changer.
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemId, onMeasure]);
  return (
    <div ref={ref} style={{ width: "max-content" }}>
      {children}
    </div>
  );
}
