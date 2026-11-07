"use client";

/**
 * ExportLivePage — la colonne d'aperçu du modal d'export EST la page.
 *
 * Même principe que le composeur de l'export Rack : on ne prévisualise pas un
 * document généré, on montre la feuille elle-même — fond blanc au format
 * papier, plan à l'échelle sur la page, calque du cartouche par-dessus.
 * L'affichage est instantané et suit les réglages.
 *
 * Le plan n'est pas re-dessiné : c'est une COPIE du canvas réel
 * (`buildExportClone` côté vue), inerte. Deux conséquences qui justifient ce
 * choix face à un second montage de la vue (12 000 lignes, état collaboratif,
 * DnD) :
 *  - le rendu est fidèle par construction, il n'y a rien à maintenir en
 *    parallèle ;
 *  - c'est EXACTEMENT le sous-arbre que l'export capture, donc le document
 *    produit ne peut pas diverger de ce qui est affiché.
 *
 * La boîte de la copie est la FEUILLE, à son échelle : le plan est coupé au
 * bord de la page et masqué par les bandes opaques du cartouche, exactement
 * comme dans le document. Ni recadrage ni bande morte entre l'écran et le PDF.
 *
 * ── Cadrage ───────────────────────────────────────────────────────────────
 * Molette = échelle du plan, glisser = déplacement. Les deux commandes
 * « Ajuster » / « Centrer » sont publiées (`onActionsChange`) et rendues dans
 * la COLONNE DE RÉGLAGES, pas sur la feuille : une commande posée sur le
 * document laisse croire qu'elle en fait partie. Ce cadrage est remonté à
 * l'appelant (`onFrameChange`) et passé
 * tel quel au générateur : le document est ce que la page montre. C'est ce qui
 * a remplacé l'ancien réglage « périmètre » — un choix entre deux cadrages
 * figés alors que l'utilisateur veut choisir ce que le document montre.
 *
 * Le clone est un INSTANTANÉ : il est refait à l'ouverture du modal et à chaque
 * changement de réglage de page. Volontairement PAS de synchronisation
 * continue — pendant qu'on règle un export, le plan derrière ne bouge pas, et
 * suivre les événements temps réel coûterait plus cher que le service rendu.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Crosshair, Maximize2 } from "@/components/ui/icons";

/** Pixels d'affichage par millimètre de feuille, avant ajustement à la fenêtre. */
const MM_PX = 4;
/** Marge autour de la feuille dans la zone d'aperçu. */
const FIT_PADDING_PX = 24;
/** Respiration autour du plan lors de l'ajustement, en part du petit côté. */
const FIT_PADDING_RATIO = 0.03;
/** Bornes d'échelle du plan dans sa boîte. */
const MIN_CAMERA_ZOOM = 0.02;
const MAX_CAMERA_ZOOM = 6;

export type ExportPageCamera = { zoom: number; pan: { x: number; y: number } };
export type ExportPageBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ExportPageClone = {
  node: HTMLElement;
  width: number;
  height: number;
  camera: ExportPageCamera;
  bounds: ExportPageBounds | null;
};

export type ExportPageFrame = {
  box: { w: number; h: number };
  camera: ExportPageCamera;
};

/** Commandes de cadrage exposées à la colonne de réglages. */
export type ExportPageFramingActions = {
  /** Ajuste tout le contenu dans la zone visible de la feuille. */
  fit: () => void;
  /** Recentre le contenu sans changer l'échelle. */
  center: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Boîte de la copie, en px, pour une feuille donnée en mm.
 *
 * Exportée parce que le CADRAGE mémorisé s'exprime dans cette boîte : une
 * génération qui la recalculerait autrement produirait un document décalé par
 * rapport à ce que l'aperçu montrait.
 */
export function exportPageBoxPx(
  pageW: number,
  pageH: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(pageW * MM_PX)),
    h: Math.max(1, Math.round(pageH * MM_PX)),
  };
}

/**
 * Ajustement du contenu dans la zone visible — référence du bouton « Ajuster ».
 *
 * Exportée pour la même raison : une feuille jamais cadrée à la main doit
 * sortir EXACTEMENT comme si l'on avait cliqué « Ajuster », et non selon une
 * seconde règle d'ajustement écrite ailleurs.
 */
export function fitCamera(
  bounds: ExportPageBounds,
  zone: Rect,
): ExportPageCamera | null {
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  if (contentW <= 0 || contentH <= 0) return null;
  const pad = Math.min(zone.w, zone.h) * FIT_PADDING_RATIO;
  const zoom = Math.max(
    MIN_CAMERA_ZOOM,
    Math.min(
      MAX_CAMERA_ZOOM,
      (zone.w - pad * 2) / contentW,
      (zone.h - pad * 2) / contentH,
    ),
  );
  if (!isFinite(zoom) || zoom <= 0) return null;
  return { zoom, pan: centerPan(bounds, zone, zoom) };
}

/** Décalage plaçant le centre du contenu au centre de la zone visible. */
function centerPan(
  bounds: ExportPageBounds,
  zone: Rect,
  zoom: number,
): { x: number; y: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    x: zone.x + zone.w / 2 - cx * zoom,
    y: zone.y + zone.h / 2 - cy * zoom,
  };
}

export function ExportLivePage({
  buildClone,
  pageW,
  pageH,
  fitZone,
  cartoucheUrl,
  refreshKey,
  initialFrame,
  onFrameChange,
  onActionsChange,
}: {
  /** Fournit une copie inerte de la scène, cadrée dans la boîte demandée. */
  buildClone: (opts: {
    box: { w: number; h: number };
    camera?: ExportPageCamera;
  }) => ExportPageClone | null;
  /** Dimensions de la feuille en mm. */
  pageW: number;
  pageH: number;
  /**
   * Cadrage MÉMORISÉ à restaurer au montage de la copie. Sans lui, la feuille
   * s'ouvre sur « Ajuster » — et comme le cadrage courant est REMONTÉ, cet
   * ajustement écraserait le zoom que l'utilisateur avait réglé. Ignoré si sa
   * boîte n'est pas celle de la feuille courante (papier changé) : il
   * s'exprimait dans une autre géométrie.
   */
  initialFrame?: ExportPageFrame | null;
  /**
   * Zone visible de la feuille, en mm — sous les bandes opaques du cartouche.
   * Elle ne DÉCOUPE rien : le plan couvre toute la page et le calque masque ce
   * qui passe dessous. Elle sert de cible à l'ajustement, pour qu'un plan
   * ajusté se retrouve là où on le voit et non pour moitié sous l'en-tête.
   */
  fitZone: { x: number; y: number; w: number; h: number };
  /** Calque du cartouche rasterisé (data URL PNG transparent). */
  cartoucheUrl?: string | null;
  /** Change → la copie est refaite et le cadrage réajusté. */
  refreshKey: string;
  /** Cadrage courant, à transmettre au générateur. */
  onFrameChange?: (frame: ExportPageFrame) => void;
  /**
   * Publie les commandes de cadrage. `null` tant qu'aucun plan n'est monté :
   * la colonne de réglages affiche alors les boutons inertes plutôt que de les
   * faire apparaître et disparaître.
   */
  onActionsChange?: (actions: ExportPageFramingActions | null) => void;
}) {
  // Arrondi au pixel : la boîte de la copie EST la feuille, les deux cotes
  // doivent être le MÊME entier, sinon la copie déborde d'un demi-pixel.
  const { w: sheetW, h: sheetH } = exportPageBoxPx(pageW, pageH);
  // Le cadrage peut donc déborder sous le cartouche, comme dans le document.
  const boxW = sheetW;
  const boxH = sheetH;
  const zonePx = useMemo(
    () => ({
      x: fitZone.x * MM_PX,
      y: fitZone.y * MM_PX,
      w: fitZone.w * MM_PX,
      h: fitZone.h * MM_PX,
    }),
    [fitZone.x, fitZone.y, fitZone.w, fitZone.h],
  );

  // ── Cadrage de la FEUILLE : toujours ajustée à la zone disponible ─────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let frame = 0;
    const measure = () => {
      const rect = vp.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      // Comparaison de VALEUR : sans elle, un observateur qui repose l'état à
      // chaque passe entretient une boucle de rendu.
      setViewportSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h },
      );
    };
    measure();
    // Mesure différée d'une frame : un `ResizeObserver` dont le rappel modifie
    // la mise en page peut se ré-entrer dans la même passe.
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

  const { zoom: sheetZoom, pan: sheetPan } = useMemo(() => {
    if (viewportSize.w <= 0 || viewportSize.h <= 0) {
      return { zoom: 1, pan: { x: 0, y: 0 } };
    }
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
  // Lu par les gestes, qui vivent hors du cycle de rendu.
  const sheetZoomRef = useRef(sheetZoom);
  sheetZoomRef.current = sheetZoom;

  // ── Cadrage du PLAN : caméra pilotée à la main, hors de React ────────────
  // Aucun `useState` : un déplacement à la souris ne doit pas déclencher un
  // rendu par image. Le transform est écrit directement sur la copie montée.
  const planHostRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLElement | null>(null);
  const cameraRef = useRef<ExportPageCamera | null>(null);
  const boundsRef = useRef<ExportPageBounds | null>(null);
  const [hasPlan, setHasPlan] = useState(false);

  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;
  // Ref et non dépendance : le cadrage mémorisé change d'identité à chaque
  // commit — le mettre en dépendance referait la copie après chaque geste.
  const initialFrameRef = useRef(initialFrame);
  initialFrameRef.current = initialFrame;

  const applyCamera = useCallback(
    (cam: ExportPageCamera) => {
      cameraRef.current = cam;
      const t = transformRef.current;
      if (t) {
        t.style.transform = `translate(${cam.pan.x}px, ${cam.pan.y}px) scale(${cam.zoom})`;
      }
      onFrameChangeRef.current?.({ box: { w: boxW, h: boxH }, camera: cam });
    },
    [boxW, boxH],
  );

  // Montage de la copie. Refaite quand la page change de forme (le cadrage
  // n'aurait plus de sens dans une autre boîte) ou sur demande explicite.
  useEffect(() => {
    const host = planHostRef.current;
    if (!host) return;
    host.replaceChildren();
    transformRef.current = null;
    const clone = buildClone({ box: { w: boxW, h: boxH } });
    if (!clone) {
      boundsRef.current = null;
      setHasPlan(false);
      return;
    }
    host.appendChild(clone.node);
    transformRef.current = clone.node.querySelector<HTMLElement>(
      "[data-synoptic-transform]",
    );
    boundsRef.current = clone.bounds;
    // Cadrage initial : le cadrage MÉMORISÉ s'il existe et s'exprime dans
    // cette boîte, sinon « Ajuster » — celui que renvoie la copie ajuste sur
    // la boîte entière, donc sous le cartouche : on repose le nôtre, calé sur
    // la zone visible.
    const restored =
      initialFrameRef.current &&
      initialFrameRef.current.box.w === boxW &&
      initialFrameRef.current.box.h === boxH
        ? initialFrameRef.current.camera
        : null;
    applyCamera(
      restored ??
        ((clone.bounds && fitCamera(clone.bounds, zonePx)) || clone.camera),
    );
    setHasPlan(true);
    return () => {
      host.replaceChildren();
      transformRef.current = null;
    };
    // `buildClone` lit l'état courant du canvas : c'est `refreshKey` (et la
    // forme de la boîte) qui décide QUAND refaire la copie, pas l'identité de
    // la fonction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, boxW, boxH, zonePx]);

  // ── Gestes ───────────────────────────────────────────────────────────────
  const sheetRef = useRef<HTMLDivElement>(null);

  /** Point sous le curseur, en coordonnées de la BOÎTE du plan (= la feuille). */
  const pointerToBox = useCallback((clientX: number, clientY: number) => {
    const rect = sheetRef.current?.getBoundingClientRect();
    const z = sheetZoomRef.current || 1;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      // Écouteur NON passif : sans `preventDefault`, le geste remonte au
      // navigateur et zoome la page entière au lieu du plan. Coupé avant tout
      // test, sinon un cran de molette sur un aperçu vide passe au travers.
      e.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const anchor = pointerToBox(e.clientX, e.clientY);
      // `deltaMode` 1 compte en LIGNES, pas en pixels : sans conversion, le
      // même geste zoome vingt fois moins vite selon le navigateur.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const factor = Math.exp(-delta * 0.0015);
      const next = Math.min(
        MAX_CAMERA_ZOOM,
        Math.max(MIN_CAMERA_ZOOM, cam.zoom * factor),
      );
      const ratio = next / cam.zoom;
      applyCamera({
        zoom: next,
        pan: {
          x: anchor.x - (anchor.x - cam.pan.x) * ratio,
          y: anchor.y - (anchor.y - cam.pan.y) * ratio,
        },
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [applyCamera, pointerToBox]);

  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cameraRef.current) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const cam = cameraRef.current;
    if (!drag || drag.id !== e.pointerId || !cam) return;
    const z = sheetZoomRef.current || 1;
    applyCamera({
      zoom: cam.zoom,
      pan: {
        x: cam.pan.x + (e.clientX - drag.x) / z,
        y: cam.pan.y + (e.clientY - drag.y) / z,
      },
    });
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleFit = useCallback(() => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    const cam = fitCamera(bounds, zonePx);
    if (cam) applyCamera(cam);
  }, [applyCamera, zonePx]);
  const handleCenter = useCallback(() => {
    const bounds = boundsRef.current;
    const cam = cameraRef.current;
    if (!bounds || !cam) return;
    applyCamera({ zoom: cam.zoom, pan: centerPan(bounds, zonePx, cam.zoom) });
  }, [applyCamera, zonePx]);

  // Les commandes de cadrage sont REMONTÉES : elles se rendent dans la colonne
  // de réglages, avec le reste des décisions d'export. Une barre flottante sur
  // la feuille obligeait à chercher où agir — et une commande posée sur le
  // document laisse croire qu'elle en fait partie.
  const onActionsRef = useRef(onActionsChange);
  onActionsRef.current = onActionsChange;
  useEffect(() => {
    onActionsRef.current?.(
      hasPlan ? { fit: handleFit, center: handleCenter } : null,
    );
    return () => onActionsRef.current?.(null);
  }, [hasPlan, handleFit, handleCenter]);

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 w-full flex-1 overflow-hidden"
      style={{
        background:
          "color-mix(in srgb, var(--foreground) 5%, var(--background))",
        cursor: !hasPlan ? "default" : dragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate(${sheetPan.x}px, ${sheetPan.y}px) scale(${sheetZoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div
          ref={sheetRef}
          className="relative"
          style={{
            width: sheetW,
            height: sheetH,
            background: "#ffffff",
            boxShadow:
              "0 1px 2px rgba(15,17,26,0.06), 0 8px 28px rgba(15,17,26,0.10)",
            // Le document coupe au bord de la feuille : l'aperçu aussi.
            overflow: "hidden",
          }}
        >
          {/* Boîte du plan = la feuille entière. La copie porte déjà
              `overflow: hidden` : le plan est coupé au bord de la page, et le
              calque du cartouche masque le reste — comme dans le document. */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: "none" }}
          >
            <div ref={planHostRef} style={{ position: "relative" }} />
          </div>

          {/* Calque du cartouche — composité par-dessus, comme dans le
              document : ses bandes opaques masquent ce qui passe dessous. */}
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
  );
}

/**
 * Rangée d'actions de cadrage, rendue dans la COLONNE DE RÉGLAGES — même
 * grammaire que `RackExportSelectionActions` du composeur Rack, pour qu'une
 * commande d'export se cherche toujours au même endroit.
 */
export function ExportFramingActions({
  actions,
}: {
  actions: ExportPageFramingActions | null;
}) {
  const disabled = !actions;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
        Cadrage
      </p>
      <div className="grid grid-cols-2 gap-1">
        <FramingButton disabled={disabled} onClick={() => actions?.fit()}>
          <Maximize2 className="h-3 w-3 shrink-0" />
          Ajuster
        </FramingButton>
        <FramingButton disabled={disabled} onClick={() => actions?.center()}>
          <Crosshair className="h-3 w-3 shrink-0" />
          Centrer
        </FramingButton>
      </div>
    </div>
  );
}

function FramingButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border)]/60 px-1.5 py-1.5 text-[10px] font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
