"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Upload, X, Loader2, CropIcon, ImageIcon, RotateCcw, Maximize2 } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface ImageCropUploadProps {
  value: string;
  onChange: (url: string) => void;
  folder?: string;
  label?: string;
  /**
   * Si fourni, le preview est rendu dans un cadre rack aux vraies proportions 19".
   * En mode rack, on affiche le ratio cible attendu pendant le crop, mais on ne
   * contraint pas l'utilisateur — il pose ses 2 points librement.
   */
  rackShape?: { heightU: number; widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER" };
  className?: string;
  /**
   * Source d'image externe (URL déjà uploadée côté serveur, p. ex. via
   * `/api/upload/from-url`) à passer dans le cropper comme s'il s'agissait
   * d'un fichier local. Quand cette prop devient non-null, le composant ouvre
   * automatiquement le modal `TwoPointCrop` avec cette image en source.
   * Au confirm/cancel, `onExternalCropResolved` est invoqué pour que le
   * parent reset la prop.
   */
  externalImageSrc?: string | null;
  /**
   * Callback appelé après que l'utilisateur a confirmé ou annulé le crop
   * lancé via `externalImageSrc`. Le parent doit reset `externalImageSrc`
   * (à null/undefined) dans ce callback.
   */
  onExternalCropResolved?: () => void;
  /**
   * Force le ratio width / height du crop final (ex. 16/9). Quand défini,
   * le rectangle dessiné s'aligne automatiquement sur ce ratio. Prime sur
   * `rackShape` (qui était seulement indicatif).
   */
  forceAspectRatio?: number;
  /**
   * Mode lecture pure : affiche uniquement l'image (object-cover) sans
   * cadre dashed, sans bouton "Changer/Supprimer", sans bouton URL, et sans
   * ouverture du cropper. Si pas d'image, le composant ne rend rien.
   */
  readOnly?: boolean;
  /**
   * Largeur source minimum requise (en pixels). Vérifié au moment où le
   * fichier sélectionné ou l'URL externe sont chargés — si l'image source
   * est en dessous, le cropper n'est pas ouvert et un message d'erreur clair
   * s'affiche sous les actions. Sert notamment à imposer un minimum de
   * résolution pour les logos.
   */
  minSourceWidth?: number;
  /**
   * Hauteur source minimum requise (en pixels). Mêmes règles que
   * `minSourceWidth`.
   */
  minSourceHeight?: number;
  /**
   * Image affichée DANS le placeholder (lieu de l'icône générique) quand
   * `value` est vide. Utilisée pour visualiser une image "héritée" / par
   * défaut (ex. icône uploadée du type catalogue).
   */
  placeholderImageUrl?: string | null;
  /**
   * Composant React affiché dans le placeholder quand `value` est vide
   * (alternative à `placeholderImageUrl` pour les icônes vectorielles
   * lucide-react). Si `placeholderImageUrl` est défini, il prime.
   */
  placeholderNode?: React.ReactNode;
  /**
   * Badge affiché en overlay sur le placeholder (ex. "GÉNÉRIQUE", "HÉRITÉ").
   * Ignoré si ni `placeholderImageUrl` ni `placeholderNode` n'est défini.
   */
  placeholderBadge?: string | null;
}

// 19" rack standard
const RACK_WIDTH_MM = 482.6;
const U_HEIGHT_MM = 44.45;
const WF_FRACTION: Record<string, number> = { FULL: 1, HALF: 0.5, THIRD: 1 / 3, QUARTER: 0.25 };

function rackAspect(heightU: number, widthFraction: string) {
  const wf = WF_FRACTION[widthFraction] ?? 1;
  return (RACK_WIDTH_MM * wf) / (heightU * U_HEIGHT_MM);
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getCroppedBlob(imageSrc: string, crop: CropArea): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(crop.width));
      canvas.height = Math.max(1, Math.round(crop.height));
      const ctx = canvas.getContext("2d")!;

      // Fond blanc opaque : quand le crop dépasse l'image (dézoom), le manque
      // est comblé par du blanc. Pour un crop entièrement inclus, le blanc est
      // intégralement recouvert par l'image (comportement identique à avant).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Intersection source calculée à la main : on ne passe à drawImage que
      // des coordonnées source strictement dans l'image (comportement fiable
      // cross-navigateur), et on positionne la destination à l'échelle.
      const sX = canvas.width / crop.width; // px canvas par px image (axe X)
      const sY = canvas.height / crop.height;
      const ix0 = Math.max(crop.x, 0);
      const iy0 = Math.max(crop.y, 0);
      const ix1 = Math.min(crop.x + crop.width, img.naturalWidth);
      const iy1 = Math.min(crop.y + crop.height, img.naturalHeight);
      const sw = ix1 - ix0;
      const sh = iy1 - iy0;
      if (sw > 0 && sh > 0) {
        const dx = (ix0 - crop.x) * sX;
        const dy = (iy0 - crop.y) * sY;
        ctx.drawImage(img, ix0, iy0, sw, sh, dx, dy, sw * sX, sh * sY);
      }
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// TwoPointCrop : sélection précise via 2 clics (top-left + bottom-right)
// avec crosshair full-area + loupe zoom 4x suivant le curseur
// ─────────────────────────────────────────────────────────────────────────

const MAGNIFY = 4;
const LOUPE_SIZE = 140;
const LOUPE_OFFSET = 24;
const ZOOM_MAX = 8; // multiplicateur max au-dessus du fit
const PAN_THRESHOLD = 4; // px : au-delà = pan, en-deçà = clic (pose de point)

type Point = { x: number; y: number }; // coords en pixels image (référentiel naturel)

function TwoPointCrop({
  imageSrc,
  onConfirm,
  onCancel,
  label,
  rackShape,
  forceAspectRatio,
  uploading,
  errorMessage,
}: {
  imageSrc: string;
  onConfirm: (cropArea: CropArea) => void;
  onCancel: () => void;
  label: string;
  rackShape?: { heightU: number; widthFraction: "FULL" | "HALF" | "THIRD" | "QUARTER" };
  /** Force le ratio width / height du crop final (ex. 16/9). Quand défini,
   *  le 2ème point sert seulement à fixer la largeur ; la hauteur est
   *  recalculée automatiquement pour respecter le ratio. */
  forceAspectRatio?: number;
  uploading: boolean;
  errorMessage: string | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Transform : zoom = multiplicateur au-dessus du fit ; offset = pan (px viewport)
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Points stockés en coords image (pixels naturels)
  const [p1, setP1] = useState<Point | null>(null);
  const [p2, setP2] = useState<Point | null>(null);

  // Curseur en coords viewport + image (réticule / loupe)
  const [cursor, setCursor] = useState<{
    vx: number;
    vy: number;
    imgX: number;
    imgY: number;
  } | null>(null);

  // Distinction pan vs clic (seuil PAN_THRESHOLD)
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ vx: number; vy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const didInit = useRef(false);

  // Échelle « fit » (image entière visible) au zoom 1, puis échelle effective.
  const fitScale =
    imgNatural && viewport.w > 0 && viewport.h > 0
      ? Math.min(viewport.w / imgNatural.w, viewport.h / imgNatural.h)
      : 1;
  const s = fitScale * zoom; // image px → viewport px

  // Conversions image ↔ viewport
  const vX = (ix: number) => ix * s + offset.x;
  const vY = (iy: number) => iy * s + offset.y;
  const vLen = (v: number) => v * s;

  // Refs live pour que les listeners globaux (pan/wheel/clavier) lisent l'état
  // courant sans se ré-enregistrer à chaque frame.
  const sRef = useRef(s);
  sRef.current = s;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const imgNaturalRef = useRef(imgNatural);
  imgNaturalRef.current = imgNatural;
  const p1Ref = useRef(p1);
  p1Ref.current = p1;
  const p2Ref = useRef(p2);
  p2Ref.current = p2;

  // Borne l'offset pour garder l'image dans le viewport (centrée si plus petite).
  const clampOffset = useCallback((o: { x: number; y: number }, scale: number) => {
    const vw = viewportRef.current.w;
    const vh = viewportRef.current.h;
    const nat = imgNaturalRef.current;
    if (!nat) return o;
    const dw = nat.w * scale;
    const dh = nat.h * scale;
    const x = dw <= vw ? (vw - dw) / 2 : Math.min(0, Math.max(vw - dw, o.x));
    const y = dh <= vh ? (vh - dh) / 2 : Math.min(0, Math.max(vh - dh, o.y));
    return { x, y };
  }, []);

  // Vue par défaut : fit + centré.
  // Dimensions viewport avec repli : si l'état n'est pas encore mesuré
  // (course au montage), on lit le rect à la volée.
  const liveViewport = useCallback((): { w: number; h: number } => {
    const v = viewportRef.current;
    if (v.w > 0 && v.h > 0) return v;
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : v;
  }, []);

  const resetView = useCallback(() => {
    const nat = imgNaturalRef.current;
    const { w: vw, h: vh } = liveViewport();
    if (!nat || vw <= 0 || vh <= 0) return;
    const fs = Math.min(vw / nat.w, vh / nat.h);
    setZoom(1);
    setOffset({ x: (vw - nat.w * fs) / 2, y: (vh - nat.h * fs) / 2 });
  }, [liveViewport]);

  // Zoom en gardant le point pivot (viewport px) fixe sous la souris/centre.
  const zoomAt = useCallback(
    (rawZoom: number, pivotVX: number, pivotVY: number) => {
      const nat = imgNaturalRef.current;
      const { w: vw, h: vh } = liveViewport();
      if (!nat || vw <= 0 || vh <= 0) return;
      const fs = Math.min(vw / nat.w, vh / nat.h);
      const next = Math.min(ZOOM_MAX, Math.max(1, rawZoom));
      const s0 = fs * zoomRef.current;
      const s1 = fs * next;
      const o = offsetRef.current;
      const ipx = (pivotVX - o.x) / s0;
      const ipy = (pivotVY - o.y) / s0;
      setZoom(next);
      setOffset(clampOffset({ x: pivotVX - ipx * s1, y: pivotVY - ipy * s1 }, s1));
    },
    [clampOffset, liveViewport],
  );

  // Élément stage suivi en ÉTAT (callback ref) : les effets de mesure et de
  // wheel se re-déclenchent quand l'élément s'attache réellement — un effet
  // `[]` au mount peut tourner AVANT que le contenu du Dialog (portal) soit
  // en place, laissant viewport à 0×0 (image « déjà zoomée » + zoom mort).
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const setStageRefs = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  }, []);

  // Mesure du viewport (stage) via ResizeObserver — dès que l'élément existe.
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stageEl]);

  const handleImgLoad = () => {
    if (!imgRef.current) return;
    setImgNatural({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  // Mesure fiable des dimensions naturelles via une image SONDE détachée —
  // indépendante des aléas d'événements du <img> DOM (load déjà consommé,
  // src changé, cache, data-URL). Ré-arme aussi le fit initial (`didInit`) :
  // chaque nouvelle image rouvre en vue complète.
  useEffect(() => {
    didInit.current = false;
    setImgNatural(null);
    let cancelled = false;
    const probe = new window.Image();
    const commit = () => {
      if (!cancelled && probe.naturalWidth > 0) {
        setImgNatural({ w: probe.naturalWidth, h: probe.naturalHeight });
      }
    };
    probe.onload = commit;
    probe.src = imageSrc;
    if (probe.complete) commit();
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  // Initialise la vue (fit centré) une fois image + viewport prêts. Utilise
  // le repli de mesure directe : le fit ne dépend pas de l'ordre d'arrivée
  // entre la mesure du stage (RO async) et le chargement de l'image.
  useEffect(() => {
    if (!imgNatural || didInit.current) return;
    const lv = liveViewport();
    if (lv.w > 0 && lv.h > 0) {
      didInit.current = true;
      resetView();
    }
  }, [imgNatural, viewport, resetView, liveViewport]);

  // Wheel natif NON-passif : molette classique + pinch trackpad (ctrlKey).
  // React attache onWheel en passif → on passe par un listener natif pour
  // pouvoir preventDefault (pas de scroll de page) et zoomer au curseur.
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!imgNaturalRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      // Pinch trackpad (Chrome/Firefox = wheel + ctrlKey) : deltas fins →
      // sensibilité forte. Scroll deux doigts trackpad : deltas pixel fins
      // (±1…20) → sensibilité intermédiaire, sinon le zoom est imperceptible.
      // Molette souris : crans larges (±100) → sensibilité douce. Le facteur
      // par événement est borné pour lisser les à-coups.
      const isPinch = e.ctrlKey;
      const fineDelta = e.deltaMode === 0 && Math.abs(e.deltaY) < 40;
      const intensity = isPinch ? 0.02 : fineDelta ? 0.008 : 0.0018;
      const factor = Math.min(1.4, Math.max(0.7, Math.exp(-e.deltaY * intensity)));
      zoomAt(zoomRef.current * factor, vx, vy);
    };
    // Pinch Safari (macOS) : événements gesture* non standard (pas de wheel).
    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as unknown as { scale?: number }).scale;
      if (typeof scale !== "number" || !imgNaturalRef.current) return;
      const rect = el.getBoundingClientRect();
      zoomAt(gestureStartZoom * scale, rect.width / 2, rect.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart as EventListener);
    el.addEventListener("gesturechange", onGestureChange as EventListener);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
    };
  }, [stageEl, zoomAt]);

  // Pan (drag > seuil) + pose de point (clic sans mouvement), via listeners globaux.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = stageRef.current;
      const d = dragRef.current;
      if (!el || !d) return;
      const rect = el.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const dxp = vx - d.vx;
      const dyp = vy - d.vy;
      if (!d.moved && Math.hypot(dxp, dyp) > PAN_THRESHOLD) d.moved = true;
      if (d.moved) setOffset(clampOffset({ x: d.ox + dxp, y: d.oy + dyp }, sRef.current));
    };
    const onUp = (e: MouseEvent) => {
      const el = stageRef.current;
      const d = dragRef.current;
      const nat = imgNaturalRef.current;
      if (el && d && !d.moved && nat) {
        const rect = el.getBoundingClientRect();
        const vx = e.clientX - rect.left;
        const vy = e.clientY - rect.top;
        if (vx >= 0 && vy >= 0 && vx <= rect.width && vy <= rect.height) {
          const ix = Math.max(0, Math.min(nat.w, (vx - offsetRef.current.x) / sRef.current));
          const iy = Math.max(0, Math.min(nat.h, (vy - offsetRef.current.y) / sRef.current));
          if (!p1Ref.current) setP1({ x: ix, y: iy });
          else if (!p2Ref.current) setP2({ x: ix, y: iy });
        }
      }
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, clampOffset]);

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgNatural || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    dragRef.current = {
      vx: e.clientX - rect.left,
      vy: e.clientY - rect.top,
      ox: offset.x,
      oy: offset.y,
      moved: false,
    };
    setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgNatural || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    if (vx < 0 || vy < 0 || vx > rect.width || vy > rect.height) {
      setCursor(null);
      return;
    }
    const ix = Math.max(0, Math.min(imgNatural.w, (vx - offset.x) / s));
    const iy = Math.max(0, Math.min(imgNatural.h, (vy - offset.y) / s));
    setCursor({ vx, vy, imgX: ix, imgY: iy });
  };

  const handleMouseLeave = () => setCursor(null);

  const reset = () => {
    setP1(null);
    setP2(null);
  };

  // Rectangle de crop normalisé (en pixels image).
  // Si forceAspectRatio est défini, on garde la WIDTH du rect (déterminée
  // par l'écart horizontal entre p1 et p2) et on recalcule la HEIGHT pour
  // matcher le ratio. La position verticale prend le sens du delta y
  // (rectangle dessiné vers le haut ou vers le bas).
  const cropArea: CropArea | null = (() => {
    if (!p1 || !p2) return null;
    const x = Math.min(p1.x, p2.x);
    let width = Math.abs(p2.x - p1.x);
    let height = Math.abs(p2.y - p1.y);
    let y = Math.min(p1.y, p2.y);
    if (forceAspectRatio && forceAspectRatio > 0 && width > 0) {
      const enforcedHeight = width / forceAspectRatio;
      // Aligne y sur p1 pour suivre la direction du geste (haut → bas ou inverse).
      if (p2.y >= p1.y) {
        y = p1.y;
      } else {
        y = Math.max(0, p1.y - enforcedHeight);
      }
      height = enforcedHeight;
    }
    return { x, y, width, height };
  })();

  const cropRatio = cropArea && cropArea.height > 0 ? cropArea.width / cropArea.height : null;
  const targetRatio = forceAspectRatio
    ? forceAspectRatio
    : rackShape
      ? rackAspect(rackShape.heightU, rackShape.widthFraction)
      : null;

  const cropAreaRef = useRef(cropArea);
  cropAreaRef.current = cropArea;

  // Raccourcis clavier : zoom (+/-/0) centré sur le viewport, Entrée = valider.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cx = viewportRef.current.w / 2;
      const cy = viewportRef.current.h / 2;
      if (e.key === "+" || e.key === "=") {
        if (!imgNaturalRef.current) return;
        e.preventDefault();
        zoomAt(zoomRef.current * 1.25, cx, cy);
      } else if (e.key === "-" || e.key === "_") {
        if (!imgNaturalRef.current) return;
        e.preventDefault();
        zoomAt(zoomRef.current / 1.25, cx, cy);
      } else if (e.key === "0") {
        if (!imgNaturalRef.current) return;
        e.preventDefault();
        resetView();
      } else if (e.key === "Enter") {
        const ca = cropAreaRef.current;
        if (ca && ca.width >= 1 && ca.height >= 1 && !uploading) {
          e.preventDefault();
          onConfirm(ca);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, resetView, onConfirm, uploading]);

  // Hint message (mentionne la molette = zoom)
  const hint = !p1
    ? "Molette : zoom · glissez pour déplacer · cliquez pour poser le coin supérieur gauche"
    : !p2
      ? forceAspectRatio
        ? "Cliquez pour fixer la largeur — la hauteur s'ajuste automatiquement"
        : "Cliquez pour poser le coin inférieur droit"
      : "Rectangle défini — Validez ou recommencez";

  // Validate handler
  const handleValidate = () => {
    if (!cropArea || cropArea.width < 1 || cropArea.height < 1) return;
    onConfirm(cropArea);
  };

  // Loupe : magnifie l'image NATURELLE ×MAGNIFY autour du curseur, indépendante
  // du zoom du stage. Devient redondante une fois bien zoomé → masquée > 2×.
  const showLoupe = !!cursor && !!imgNatural && zoom <= 2 && !dragging;
  const loupeStyle: React.CSSProperties | null =
    showLoupe && cursor && imgNatural
      ? (() => {
          const bgW = imgNatural.w * MAGNIFY;
          const bgH = imgNatural.h * MAGNIFY;
          const bgX = LOUPE_SIZE / 2 - cursor.imgX * MAGNIFY;
          const bgY = LOUPE_SIZE / 2 - cursor.imgY * MAGNIFY;
          // Positionnée à côté du curseur, en coords viewport, repli si débordement.
          let left = cursor.vx + LOUPE_OFFSET;
          let top = cursor.vy - LOUPE_SIZE - LOUPE_OFFSET;
          if (left + LOUPE_SIZE > viewport.w) left = cursor.vx - LOUPE_SIZE - LOUPE_OFFSET;
          if (top < 0) top = cursor.vy + LOUPE_OFFSET;
          return {
            left,
            top,
            width: LOUPE_SIZE,
            height: LOUPE_SIZE,
            backgroundImage: `url(${imageSrc})`,
            backgroundSize: `${bgW}px ${bgH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
            backgroundRepeat: "no-repeat",
          };
        })()
      : null;

  // Dialog Radix imbriqué : permet d'ouvrir le crop AU-DESSUS d'un Dialog
  // parent (ex. wizard équipement) sans être piégé par son focus trap ni son
  // overlay. Radix gère nativement les dialogs imbriqués (z-index croissant,
  // focus stack).
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-[201] flex items-center justify-center p-0 outline-none"
        ><DialogPrimitive.Title className="sr-only">{label} — Définir le cadre</DialogPrimitive.Title>
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl bg-[var(--card)] shadow-2xl"
        style={{ width: "min(92vw, 900px)", maxHeight: "92vh" }}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">{label} — Définir le cadre</span>
            {rackShape ? (
              <span className="rounded-md bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                Format imposé{" "}
                {rackShape.widthFraction === "HALF"
                  ? "½ 19″"
                  : rackShape.widthFraction === "THIRD"
                    ? "⅓ 19″"
                    : rackShape.widthFraction === "QUARTER"
                      ? "¼ 19″"
                      : "19″"}{" "}
                · {rackShape.heightU}U
              </span>
            ) : forceAspectRatio ? (
              <span className="rounded-md bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--accent)]">
                Format imposé {forceAspectRatio.toFixed(2)}:1
              </span>
            ) : null}
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 hover:bg-[var(--border)]"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Hint banner ── */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--secondary)] px-5 py-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
          <span className="text-xs text-[var(--foreground)]">{hint}</span>
        </div>

        {/* ── Image area (viewport zoom/pan + réticule) ──
            PAS de `flex-1` : dans un parent flex-col en hauteur auto, la base
            flex 0 annule la hauteur inline → stage écrasé à 0. On fixe 60vh
            avec shrink autorisé (min-h-0) pour respecter le maxHeight 92vh. */}
        <div
          ref={setStageRefs}
          className="relative min-h-0 shrink select-none overflow-hidden bg-[#0a0a0a]"
          style={{
            height: "60vh",
            cursor: !imgNatural ? "wait" : dragging ? "grabbing" : "none",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleStageMouseDown}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Source"
            onLoad={handleImgLoad}
            draggable={false}
            className="absolute block select-none"
            style={
              imgNatural
                ? {
                    left: offset.x,
                    top: offset.y,
                    width: imgNatural.w * s,
                    height: imgNatural.h * s,
                    maxWidth: "none",
                  }
                : { opacity: 0 }
            }
          />

          {/* SVG overlay (coords viewport) : crop, aperçu, points, réticule */}
          {imgNatural && viewport.w > 0 && (
            <svg
              className="pointer-events-none absolute inset-0"
              width={viewport.w}
              height={viewport.h}
              style={{ width: viewport.w, height: viewport.h }}
            >
              {/* Rectangle de crop avec overlay assombrissant */}
              {cropArea && (
                <>
                  <defs>
                    <mask id="cropMask">
                      <rect x={0} y={0} width={viewport.w} height={viewport.h} fill="white" />
                      <rect
                        x={vX(cropArea.x)}
                        y={vY(cropArea.y)}
                        width={vLen(cropArea.width)}
                        height={vLen(cropArea.height)}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  <rect
                    x={0}
                    y={0}
                    width={viewport.w}
                    height={viewport.h}
                    fill="rgba(0,0,0,0.55)"
                    mask="url(#cropMask)"
                  />
                  <rect
                    x={vX(cropArea.x)}
                    y={vY(cropArea.y)}
                    width={vLen(cropArea.width)}
                    height={vLen(cropArea.height)}
                    fill="none"
                    stroke="rgb(99, 102, 241)"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Aperçu rectangle (entre p1 et curseur si seul p1 posé) */}
              {p1 && !p2 && cursor && (
                <rect
                  x={Math.min(vX(p1.x), cursor.vx)}
                  y={Math.min(vY(p1.y), cursor.vy)}
                  width={Math.abs(cursor.vx - vX(p1.x))}
                  height={Math.abs(cursor.vy - vY(p1.y))}
                  fill="rgba(99, 102, 241, 0.1)"
                  stroke="rgba(99, 102, 241, 0.6)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              )}

              {/* Réticule plein-stage — double trait (liseré sombre sous trait
                  clair) : visible sur toute image, sans mix-blend-mode (rendu
                  inégal selon navigateurs dans un SVG). */}
              {/* Réticule : rendu en divs HTML (voir après le SVG) — le
                  mix-blend-mode y est fiable, pas à l'intérieur d'un SVG. */}

              {/* Point 1 (TL) */}
              {p1 && (
                <g>
                  <circle
                    cx={vX(p1.x)}
                    cy={vY(p1.y)}
                    r={5}
                    fill="rgb(99, 102, 241)"
                    stroke="white"
                    strokeWidth={1.5}
                  />
                  <text
                    x={vX(p1.x) + 8}
                    y={vY(p1.y) - 8}
                    fontSize={10}
                    fontFamily="monospace"
                    fill="white"
                    stroke="black"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    TL
                  </text>
                </g>
              )}

              {/* Point 2 (BR) */}
              {p2 && (
                <g>
                  <circle
                    cx={vX(p2.x)}
                    cy={vY(p2.y)}
                    r={5}
                    fill="rgb(99, 102, 241)"
                    stroke="white"
                    strokeWidth={1.5}
                  />
                  <text
                    x={vX(p2.x) + 8}
                    y={vY(p2.y) + 14}
                    fontSize={10}
                    fontFamily="monospace"
                    fill="white"
                    stroke="black"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    BR
                  </text>
                </g>
              )}
            </svg>
          )}

          {/* ── Réticule ── lignes simples 1px en mix-blend difference :
              s'inversent sur le fond (visibles sur image claire comme sombre). */}
          {cursor && (
            <>
              <div
                className="pointer-events-none absolute left-0 right-0"
                style={{
                  top: cursor.vy,
                  height: 1,
                  background: "#fff",
                  mixBlendMode: "difference",
                }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left: cursor.vx,
                  width: 1,
                  background: "#fff",
                  mixBlendMode: "difference",
                }}
              />
            </>
          )}

          {/* ── Loupe ── (masquée au-delà de 2× : le zoom la remplace) */}
          {loupeStyle && (
            <div
              className="pointer-events-none absolute rounded-full border-2 border-[var(--accent)] bg-[#0a0a0a] shadow-2xl"
              style={loupeStyle}
            >
              {/* Crosshair de précision au centre de la loupe */}
              <div
                className="pointer-events-none absolute"
                style={{
                  left: LOUPE_SIZE / 2 - 10,
                  top: LOUPE_SIZE / 2 - 0.5,
                  width: 20,
                  height: 1,
                  background: "rgba(255, 255, 255, 0.9)",
                }}
              />
              <div
                className="pointer-events-none absolute"
                style={{
                  left: LOUPE_SIZE / 2 - 0.5,
                  top: LOUPE_SIZE / 2 - 10,
                  width: 1,
                  height: 20,
                  background: "rgba(255, 255, 255, 0.9)",
                }}
              />
              <div
                className="pointer-events-none absolute rounded-full"
                style={{
                  left: LOUPE_SIZE / 2 - 2,
                  top: LOUPE_SIZE / 2 - 2,
                  width: 4,
                  height: 4,
                  border: "1px solid rgb(99, 102, 241)",
                }}
              />
            </div>
          )}
        </div>

        {/* ── Info panel ── */}
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--secondary)] px-5 py-2.5">
          <div className="grid grid-cols-4 gap-3 font-mono text-[11px]">
            <div>
              <span className="text-[var(--muted-foreground)]">TL: </span>
              <span className="text-[var(--foreground)]">
                {p1 ? `${Math.round(p1.x)}, ${Math.round(p1.y)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">BR: </span>
              <span className="text-[var(--foreground)]">
                {p2 ? `${Math.round(p2.x)}, ${Math.round(p2.y)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">W×H: </span>
              <span className="text-[var(--foreground)]">
                {cropArea ? `${Math.round(cropArea.width)} × ${Math.round(cropArea.height)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">Ratio: </span>
              <span
                className={cn(
                  "text-[var(--foreground)]",
                  targetRatio &&
                    cropRatio &&
                    Math.abs(cropRatio - targetRatio) / targetRatio < 0.02 &&
                    "text-[var(--accent)]",
                )}
              >
                {cropRatio ? `${cropRatio.toFixed(2)}:1` : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)]"
          >
            Annuler
          </button>
          <div className="flex items-center gap-2">
            {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
            <button
              onClick={reset}
              disabled={!p1 && !p2}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Recommencer
            </button>
            <button
              onClick={handleValidate}
              disabled={!cropArea || uploading || cropArea.width < 1 || cropArea.height < 1}
              className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CropIcon className="h-3.5 w-3.5" />
              )}
              {uploading ? "Traitement…" : "Valider"}
            </button>
          </div>
        </div>
      </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RatioCrop : sélection moderne (drag-to-select + move + resize 8 handles)
// avec ratio forcé. Remplace TwoPointCrop quand un ratio est imposé.
// ─────────────────────────────────────────────────────────────────────────

type RatioCropPhase = "draw" | "selected";
type RatioCropDragMode =
  | "none"
  | "draw"
  | "move"
  | "resize-nw"
  | "resize-n"
  | "resize-ne"
  | "resize-e"
  | "resize-se"
  | "resize-s"
  | "resize-sw"
  | "resize-w";

const HANDLE_SIZE = 10; // px (en coords display)

function clampCrop(crop: CropArea, imgW: number, imgH: number): CropArea {
  let { x, y, width, height } = crop;
  width = Math.max(1, Math.min(width, imgW));
  height = Math.max(1, Math.min(height, imgH));
  x = Math.max(0, Math.min(x, imgW - width));
  y = Math.max(0, Math.min(y, imgH - height));
  return { x, y, width, height };
}

// Bornes du domaine autorisé pour le rectangle (en coords image). Pour
// RatioCrop c'est la « boîte englobante » au ratio imposé qui contient toute
// l'image (donc minX/minY peuvent être négatifs, maxX/maxY dépasser l'image).
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Ancre d'un axe pour le clamp ratio-préservant.
// - "edge"   : un bord est fixé à `pos`, le rect grandit dans le sens `dir`
//              (+1 = vers les valeurs croissantes, -1 = vers les décroissantes).
// - "center" : le centre est fixé à `pos`, le rect grandit symétriquement.
type AxisAnchor =
  | { mode: "edge"; pos: number; dir: 1 | -1 }
  | { mode: "center"; pos: number };

// Espace disponible pour la longueur totale sur un axe donné, depuis son ancre,
// borné par [lo, hi].
function availOnAxis(anchor: AxisAnchor, lo: number, hi: number): number {
  if (anchor.mode === "edge") {
    return anchor.dir > 0 ? hi - anchor.pos : anchor.pos - lo;
  }
  // center : symétrique → limité par le côté le plus proche du bord.
  return 2 * Math.min(anchor.pos - lo, hi - anchor.pos);
}

// Position (bord haut/gauche) du rect sur un axe, une fois sa longueur connue.
function originOnAxis(anchor: AxisAnchor, length: number): number {
  if (anchor.mode === "edge") {
    return anchor.dir > 0 ? anchor.pos : anchor.pos - length;
  }
  return anchor.pos - length / 2;
}

// Clamp position seule à l'intérieur de bornes arbitraires (pour le move dans
// l'espace étendu de RatioCrop). Taille inchangée.
function clampCropInBounds(crop: CropArea, b: Bounds): CropArea {
  const width = crop.width;
  const height = crop.height;
  const x = Math.max(b.minX, Math.min(crop.x, b.maxX - width));
  const y = Math.max(b.minY, Math.min(crop.y, b.maxY - height));
  return { x, y, width, height };
}

// Clamp qui GARANTIT width/height === ratio (aux arrondis près) ET le rect
// entièrement dans les bornes. La largeur pilote est `candidateW` ; la hauteur
// en est dérivée. Les deux axes sont bornés par l'espace réellement disponible
// depuis leur ancre, ce qui empêche à la fois la sortie du domaine et la
// rupture du ratio quel que soit le bord touché.
function clampCropWithRatio(
  candidateW: number,
  bounds: Bounds,
  ratio: number,
  ax: AxisAnchor,
  ay: AxisAnchor,
): CropArea {
  const availW = availOnAxis(ax, bounds.minX, bounds.maxX);
  const availH = availOnAxis(ay, bounds.minY, bounds.maxY);
  // La largeur ne peut dépasser ni l'espace horizontal, ni la conversion de
  // l'espace vertical disponible (availH * ratio), ni la demande.
  let width = Math.min(candidateW, availW, availH * ratio);
  width = Math.max(1, width);
  const height = width / ratio;
  const x = originOnAxis(ax, width);
  const y = originOnAxis(ay, height);
  return { x, y, width, height };
}

function RatioCrop({
  imageSrc,
  onConfirm,
  onCancel,
  label,
  aspectRatio,
  uploading,
  errorMessage,
}: {
  imageSrc: string;
  onConfirm: (cropArea: CropArea) => void;
  onCancel: () => void;
  label: string;
  aspectRatio: number;
  uploading: boolean;
  errorMessage: string | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  // Taille display de la « scène » = boîte englobante au ratio imposé.
  const [stageDisplay, setStageDisplay] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [phase, setPhase] = useState<RatioCropPhase>("draw");
  const [crop, setCrop] = useState<CropArea | null>(null);
  const [dragMode, setDragMode] = useState<RatioCropDragMode>("none");
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [cropAtDragStart, setCropAtDragStart] = useState<CropArea | null>(null);

  // Boîte englobante (en coords image) : plus petit rectangle au ratio imposé
  // qui CONTIENT toute l'image, centré dessus. Si l'image est plus « large »
  // que le ratio → marges verticales ; sinon marges horizontales. C'est le
  // domaine autorisé pour le rectangle de crop (le manque = fond blanc).
  const box = useMemo(() => {
    if (!imgNatural) return null;
    const { w: iw, h: ih } = imgNatural;
    const imgRatio = iw / ih;
    let bw: number;
    let bh: number;
    if (imgRatio >= aspectRatio) {
      bw = iw;
      bh = iw / aspectRatio;
    } else {
      bh = ih;
      bw = ih * aspectRatio;
    }
    return { x: (iw - bw) / 2, y: (ih - bh) / 2, w: bw, h: bh };
  }, [imgNatural, aspectRatio]);

  const bounds = useMemo<Bounds | null>(
    () =>
      box
        ? { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h }
        : null,
    [box],
  );

  // Calcule la taille display de la scène (boîte englobante) en `object-contain`
  // dans le container : plus grand rectangle au ratio imposé qui rentre dans la
  // zone dispo. La scène (image + marges blanches) est ainsi entièrement visible.
  const updateDisplaySize = useCallback(() => {
    if (!containerRef.current || !box) return;
    const c = containerRef.current.getBoundingClientRect();
    const cw = c.width;
    const ch = c.height;
    if (cw <= 0 || ch <= 0) return;
    const boxRatio = box.w / box.h; // = aspectRatio
    const containerRatio = cw / ch;
    let dw: number;
    let dh: number;
    if (boxRatio > containerRatio) {
      dw = cw;
      dh = cw / boxRatio;
    } else {
      dh = ch;
      dw = ch * boxRatio;
    }
    setStageDisplay({ w: dw, h: dh });
  }, [box]);

  useEffect(() => {
    updateDisplaySize();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateDisplaySize());
    ro.observe(el);
    window.addEventListener("resize", updateDisplaySize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateDisplaySize);
    };
  }, [updateDisplaySize, imgNatural]);

  const handleImgLoad = () => {
    if (!imgRef.current) return;
    const w = imgRef.current.naturalWidth;
    const h = imgRef.current.naturalHeight;
    setImgNatural({ w, h });
    // Pré-remplit un crop par défaut respectant aspectRatio, centré et au
    // plus grand qui rentre dans l'image. L'utilisateur peut le déplacer /
    // redimensionner / recommencer.
    const imgRatio = w / h;
    let cropW: number;
    let cropH: number;
    if (imgRatio > aspectRatio) {
      cropH = h;
      cropW = h * aspectRatio;
    } else {
      cropW = w;
      cropH = w / aspectRatio;
    }
    setCrop({
      x: (w - cropW) / 2,
      y: (h - cropH) / 2,
      width: cropW,
      height: cropH,
    });
    setPhase("selected");
    // updateDisplaySize sera relancé via useEffect (deps [imgNatural])
  };

  // Échelle uniforme scène↔display (image px → display px).
  const scale = box && stageDisplay.w > 0 ? stageDisplay.w / box.w : 1;
  // Conversion coords image → coords display (origine = coin de la scène).
  const posX = (ix: number) => (box ? (ix - box.x) * scale : ix);
  const posY = (iy: number) => (box ? (iy - box.y) * scale : iy);
  const len = (v: number) => v * scale; // longueur (pas de translation)
  // Placement de l'image DANS la scène (marges blanches autour).
  const imgOffsetX = box ? -box.x * scale : 0;
  const imgOffsetY = box ? -box.y * scale : 0;
  const imgDispW = imgNatural ? imgNatural.w * scale : 0;
  const imgDispH = imgNatural ? imgNatural.h * scale : 0;

  // Convertit la position d'un event en coords image (pixels naturels), bornée
  // à la scène (peut sortir de l'image → valeurs négatives / au-delà).
  const eventToImagePos = useCallback(
    (e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
      if (!stageRef.current || !box || scale <= 0) return null;
      const rect = stageRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const ix = Math.max(box.x, Math.min(box.x + box.w, box.x + sx / scale));
      const iy = Math.max(box.y, Math.min(box.y + box.h, box.y + sy / scale));
      return { x: ix, y: iy };
    },
    [box, scale],
  );

  const reset = useCallback(() => {
    setDragMode("none");
    setDragOrigin(null);
    setCropAtDragStart(null);
    if (!imgNatural) {
      setPhase("draw");
      setCrop(null);
      return;
    }
    // Recadre au cadre par défaut (centré, au max dans l'image).
    const imgRatio = imgNatural.w / imgNatural.h;
    let cropW: number;
    let cropH: number;
    if (imgRatio > aspectRatio) {
      cropH = imgNatural.h;
      cropW = imgNatural.h * aspectRatio;
    } else {
      cropW = imgNatural.w;
      cropH = imgNatural.w / aspectRatio;
    }
    setCrop({
      x: (imgNatural.w - cropW) / 2,
      y: (imgNatural.h - cropH) / 2,
      width: cropW,
      height: cropH,
    });
    setPhase("selected");
  }, [imgNatural, aspectRatio]);

  // Dézoom max : le rectangle épouse toute la boîte englobante = image entière
  // + fond blanc. L'utilisateur peut ensuite l'ajuster ou valider.
  const showWholeImage = useCallback(() => {
    if (!box) return;
    setDragMode("none");
    setDragOrigin(null);
    setCropAtDragStart(null);
    setCrop({ x: box.x, y: box.y, width: box.w, height: box.h });
    setPhase("selected");
  }, [box]);

  // ── Phase draw : démarrer le drag ────────────────────────────────────
  const handleDrawMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (phase !== "draw") return;
    if (!imgNatural) return;
    const pos = eventToImagePos(e);
    if (!pos) return;
    setDragMode("draw");
    setDragOrigin(pos);
    setCrop({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  // ── Phase selected : démarrer move ou resize ─────────────────────────
  const startInteraction = (
    e: React.MouseEvent,
    mode: Exclude<RatioCropDragMode, "none" | "draw">,
  ) => {
    if (!crop) return;
    e.stopPropagation();
    e.preventDefault();
    const pos = eventToImagePos(e);
    if (!pos) return;
    setDragMode(mode);
    setDragOrigin(pos);
    setCropAtDragStart({ ...crop });
  };

  // ── Global mousemove/mouseup pendant un drag ─────────────────────────
  useEffect(() => {
    if (dragMode === "none") return;
    if (!bounds) return;

    const onMove = (e: MouseEvent) => {
      const pos = eventToImagePos(e);
      if (!pos) return;

      if (dragMode === "draw" && dragOrigin) {
        // Ancre = origine du drag ; le rect grandit dans le sens du geste.
        // La largeur demandée est |dx| ; clampCropWithRatio la borne pour ne
        // jamais sortir de la scène ni casser le ratio.
        const dx = pos.x - dragOrigin.x;
        const dy = pos.y - dragOrigin.y;
        const dirX: 1 | -1 = dx >= 0 ? 1 : -1;
        const dirY: 1 | -1 = dy >= 0 ? 1 : -1;
        setCrop(
          clampCropWithRatio(
            Math.abs(dx),
            bounds,
            aspectRatio,
            { mode: "edge", pos: dragOrigin.x, dir: dirX },
            { mode: "edge", pos: dragOrigin.y, dir: dirY },
          ),
        );
        return;
      }

      if (!cropAtDragStart || !dragOrigin) return;
      const dx = pos.x - dragOrigin.x;
      const dy = pos.y - dragOrigin.y;

      if (dragMode === "move") {
        // Position seule : la taille (donc le ratio) ne change pas.
        setCrop(
          clampCropInBounds(
            {
              x: cropAtDragStart.x + dx,
              y: cropAtDragStart.y + dy,
              width: cropAtDragStart.width,
              height: cropAtDragStart.height,
            },
            bounds,
          ),
        );
        return;
      }

      // Resize : la largeur pilote est déduite du geste, la hauteur du ratio.
      // clampCropWithRatio borne les deux axes depuis l'ancre (coin/bord
      // opposé) → jamais de sortie d'image ni de ratio cassé, quel que soit
      // le bord touché. Chaque case ne fournit que son ancre + sa demande.
      const r = cropAtDragStart;
      const centerX = r.x + r.width / 2;
      const centerY = r.y + r.height / 2;
      let newCrop: CropArea = { ...r };

      switch (dragMode) {
        // ── Bords : dimension perpendiculaire centrée (ancre "center"). ──
        case "resize-e": {
          newCrop = clampCropWithRatio(
            Math.max(1, r.width + dx),
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x, dir: 1 },
            { mode: "center", pos: centerY },
          );
          break;
        }
        case "resize-w": {
          newCrop = clampCropWithRatio(
            Math.max(1, r.width - dx),
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x + r.width, dir: -1 },
            { mode: "center", pos: centerY },
          );
          break;
        }
        case "resize-n": {
          // Hauteur pilote → convertie en largeur candidate via le ratio.
          newCrop = clampCropWithRatio(
            Math.max(1, r.height - dy) * aspectRatio,
            bounds,
            aspectRatio,
            { mode: "center", pos: centerX },
            { mode: "edge", pos: r.y + r.height, dir: -1 },
          );
          break;
        }
        case "resize-s": {
          newCrop = clampCropWithRatio(
            Math.max(1, r.height + dy) * aspectRatio,
            bounds,
            aspectRatio,
            { mode: "center", pos: centerX },
            { mode: "edge", pos: r.y, dir: 1 },
          );
          break;
        }
        // ── Coins : ancre = coin opposé (deux bords "edge"). ──
        // Largeur candidate = plus grande extension entre l'axe X et l'axe Y.
        case "resize-se": {
          const candidateW = Math.max(
            Math.max(1, r.width + dx),
            Math.max(1, r.height + dy) * aspectRatio,
          );
          newCrop = clampCropWithRatio(
            candidateW,
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x, dir: 1 },
            { mode: "edge", pos: r.y, dir: 1 },
          );
          break;
        }
        case "resize-ne": {
          const candidateW = Math.max(
            Math.max(1, r.width + dx),
            Math.max(1, r.height - dy) * aspectRatio,
          );
          newCrop = clampCropWithRatio(
            candidateW,
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x, dir: 1 },
            { mode: "edge", pos: r.y + r.height, dir: -1 },
          );
          break;
        }
        case "resize-sw": {
          const candidateW = Math.max(
            Math.max(1, r.width - dx),
            Math.max(1, r.height + dy) * aspectRatio,
          );
          newCrop = clampCropWithRatio(
            candidateW,
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x + r.width, dir: -1 },
            { mode: "edge", pos: r.y, dir: 1 },
          );
          break;
        }
        case "resize-nw": {
          const candidateW = Math.max(
            Math.max(1, r.width - dx),
            Math.max(1, r.height - dy) * aspectRatio,
          );
          newCrop = clampCropWithRatio(
            candidateW,
            bounds,
            aspectRatio,
            { mode: "edge", pos: r.x + r.width, dir: -1 },
            { mode: "edge", pos: r.y + r.height, dir: -1 },
          );
          break;
        }
      }

      // clampCropWithRatio garantit déjà l'inclusion et le ratio.
      setCrop(newCrop);
    };

    const onUp = () => {
      if (dragMode === "draw") {
        // Valide la sélection si elle dépasse un seuil min
        setCrop((current) => {
          if (current && current.width > 10 && current.height > 10) {
            setPhase("selected");
            return current;
          }
          return null;
        });
      }
      setDragMode("none");
      setDragOrigin(null);
      setCropAtDragStart(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragMode, dragOrigin, cropAtDragStart, aspectRatio, eventToImagePos, bounds]);

  // Dernier filet de sécurité : si le ratio a dérivé (> 0.5 %) sur un chemin
  // imprévu, on force height = width / ratio avant de confirmer.
  const confirmWithRatioGuard = useCallback(
    (c: CropArea) => {
      const current = c.height > 0 ? c.width / c.height : aspectRatio;
      if (Math.abs(current - aspectRatio) / aspectRatio > 0.005) {
        onConfirm({ ...c, height: c.width / aspectRatio });
      } else {
        onConfirm(c);
      }
    },
    [aspectRatio, onConfirm],
  );

  // ── Raccourcis clavier ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        if (phase === "selected" && crop && crop.width >= 1 && crop.height >= 1 && !uploading) {
          e.preventDefault();
          confirmWithRatioGuard(crop);
        }
      } else if (e.key === "r" || e.key === "R") {
        if (phase === "selected") {
          e.preventDefault();
          reset();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, crop, uploading, onCancel, confirmWithRatioGuard, reset]);

  const handleValidate = () => {
    if (!crop || crop.width < 1 || crop.height < 1) return;
    confirmWithRatioGuard(crop);
  };

  // Dimensions display du crop pour l'overlay SVG (coords scène).
  const cropDisp = crop && box
    ? {
        x: posX(crop.x),
        y: posY(crop.y),
        width: len(crop.width),
        height: len(crop.height),
      }
    : null;

  const cropRatio = crop && crop.height > 0 ? crop.width / crop.height : null;

  // Liste des 8 poignées avec leur position et le mode associé
  const handles: {
    mode: Exclude<RatioCropDragMode, "none" | "draw">;
    cx: number;
    cy: number;
    cursor: string;
  }[] = cropDisp
    ? [
        { mode: "resize-nw", cx: cropDisp.x, cy: cropDisp.y, cursor: "nwse-resize" },
        { mode: "resize-n", cx: cropDisp.x + cropDisp.width / 2, cy: cropDisp.y, cursor: "ns-resize" },
        {
          mode: "resize-ne",
          cx: cropDisp.x + cropDisp.width,
          cy: cropDisp.y,
          cursor: "nesw-resize",
        },
        {
          mode: "resize-e",
          cx: cropDisp.x + cropDisp.width,
          cy: cropDisp.y + cropDisp.height / 2,
          cursor: "ew-resize",
        },
        {
          mode: "resize-se",
          cx: cropDisp.x + cropDisp.width,
          cy: cropDisp.y + cropDisp.height,
          cursor: "nwse-resize",
        },
        {
          mode: "resize-s",
          cx: cropDisp.x + cropDisp.width / 2,
          cy: cropDisp.y + cropDisp.height,
          cursor: "ns-resize",
        },
        {
          mode: "resize-sw",
          cx: cropDisp.x,
          cy: cropDisp.y + cropDisp.height,
          cursor: "nesw-resize",
        },
        {
          mode: "resize-w",
          cx: cropDisp.x,
          cy: cropDisp.y + cropDisp.height / 2,
          cursor: "ew-resize",
        },
      ]
    : [];

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-[201] flex items-center justify-center p-0 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Recadrer l&apos;image
          </DialogPrimitive.Title>
          <div
            className="relative flex flex-col overflow-hidden rounded-2xl bg-[var(--card)] shadow-2xl"
            style={{ width: "min(92vw, 1100px)", height: "min(88vh, 720px)" }}
          >
            {/* ── Header ── */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <span className="text-sm font-semibold">Recadrer l&apos;image</span>
              <button
                onClick={onCancel}
                className="rounded-lg p-1.5 hover:bg-[var(--border)]"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Image area (image centrée et ajustée, pas de scroll) ── */}
            <div
              ref={containerRef}
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0a0a0a]"
            >
              <div
                ref={stageRef}
                className="relative select-none bg-white"
                style={{
                  cursor:
                    !imgNatural
                      ? "wait"
                      : phase === "draw"
                        ? "crosshair"
                        : "default",
                  width: stageDisplay.w > 0 ? stageDisplay.w : undefined,
                  height: stageDisplay.h > 0 ? stageDisplay.h : undefined,
                }}
                onMouseDown={phase === "draw" ? handleDrawMouseDown : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="Source"
                  onLoad={handleImgLoad}
                  draggable={false}
                  className="absolute block select-none"
                  style={
                    box && stageDisplay.w > 0
                      ? {
                          left: imgOffsetX,
                          top: imgOffsetY,
                          width: imgDispW,
                          height: imgDispH,
                        }
                      : { inset: 0, width: "100%", height: "100%", opacity: 0 }
                  }
                />

                {imgNatural && stageDisplay.w > 0 && cropDisp && (
                  <svg
                    className="absolute inset-0"
                    width={stageDisplay.w}
                    height={stageDisplay.h}
                    style={{
                      width: stageDisplay.w,
                      height: stageDisplay.h,
                      pointerEvents: "none",
                    }}
                  >
                    {/* Overlay sombre avec trou via mask */}
                    <defs>
                      <mask id="ratioCropMask">
                        <rect
                          x={0}
                          y={0}
                          width={stageDisplay.w}
                          height={stageDisplay.h}
                          fill="white"
                        />
                        <rect
                          x={cropDisp.x}
                          y={cropDisp.y}
                          width={cropDisp.width}
                          height={cropDisp.height}
                          fill="black"
                        />
                      </mask>
                    </defs>
                    <rect
                      x={0}
                      y={0}
                      width={stageDisplay.w}
                      height={stageDisplay.h}
                      fill="rgba(0,0,0,0.55)"
                      mask="url(#ratioCropMask)"
                      style={{
                        opacity: phase === "draw" && dragMode !== "draw" ? 0 : 1,
                        transition: "opacity 120ms ease-out",
                      }}
                    />

                    {/* Bordure du crop */}
                    <rect
                      x={cropDisp.x}
                      y={cropDisp.y}
                      width={cropDisp.width}
                      height={cropDisp.height}
                      fill="transparent"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      style={{
                        // Zone intérieure cliquable pour move (phase selected)
                        pointerEvents: phase === "selected" ? "auto" : "none",
                        cursor: phase === "selected" ? "move" : undefined,
                      }}
                      onMouseDown={
                        phase === "selected"
                          ? (e) => startInteraction(e, "move")
                          : undefined
                      }
                    />

                    {/* Lignes guides 1/3 (rule of thirds) */}
                    {phase === "selected" && (
                      <g pointerEvents="none">
                        <line
                          x1={cropDisp.x + cropDisp.width / 3}
                          y1={cropDisp.y}
                          x2={cropDisp.x + cropDisp.width / 3}
                          y2={cropDisp.y + cropDisp.height}
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth={1}
                          shapeRendering="crispEdges"
                        />
                        <line
                          x1={cropDisp.x + (2 * cropDisp.width) / 3}
                          y1={cropDisp.y}
                          x2={cropDisp.x + (2 * cropDisp.width) / 3}
                          y2={cropDisp.y + cropDisp.height}
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth={1}
                          shapeRendering="crispEdges"
                        />
                        <line
                          x1={cropDisp.x}
                          y1={cropDisp.y + cropDisp.height / 3}
                          x2={cropDisp.x + cropDisp.width}
                          y2={cropDisp.y + cropDisp.height / 3}
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth={1}
                          shapeRendering="crispEdges"
                        />
                        <line
                          x1={cropDisp.x}
                          y1={cropDisp.y + (2 * cropDisp.height) / 3}
                          x2={cropDisp.x + cropDisp.width}
                          y2={cropDisp.y + (2 * cropDisp.height) / 3}
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth={1}
                          shapeRendering="crispEdges"
                        />
                      </g>
                    )}

                    {/* Poignées (uniquement en phase selected) */}
                    {phase === "selected" &&
                      handles.map((h) => (
                        <rect
                          key={h.mode}
                          x={h.cx - HANDLE_SIZE / 2}
                          y={h.cy - HANDLE_SIZE / 2}
                          width={HANDLE_SIZE}
                          height={HANDLE_SIZE}
                          fill="var(--accent)"
                          stroke="white"
                          strokeWidth={1.5}
                          className="ratio-crop-handle"
                          style={{
                            cursor: h.cursor,
                            pointerEvents: "auto",
                            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
                            transformBox: "fill-box",
                            transformOrigin: "center",
                            transition: "transform 100ms ease-out",
                          }}
                          onMouseDown={(e) => startInteraction(e, h.mode)}
                        />
                      ))}
                  </svg>
                )}
              </div>
            </div>

            {/* ── Info panel ── */}
            {/* ── Footer actions ── */}
            <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
              <button
                onClick={onCancel}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)]"
              >
                Annuler
              </button>
              <div className="flex items-center gap-2">
                {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
                <button
                  onClick={showWholeImage}
                  disabled={!box}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Image entière
                </button>
                <button
                  onClick={reset}
                  disabled={phase !== "selected"}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Recommencer
                </button>
                <button
                  onClick={handleValidate}
                  disabled={
                    !crop || uploading || crop.width < 1 || crop.height < 1 || phase !== "selected"
                  }
                  className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CropIcon className="h-3.5 w-3.5" />
                  )}
                  {uploading ? "Traitement…" : "Valider"}
                </button>
              </div>
            </div>
          </div>
          <style>{`
            .ratio-crop-handle:hover { transform: scale(1.15); }
          `}</style>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────

export function ImageCropUpload({
  value,
  onChange,
  folder = "equipment",
  label = "Image",
  rackShape,
  className,
  externalImageSrc,
  onExternalCropResolved,
  forceAspectRatio,
  readOnly,
  minSourceWidth,
  minSourceHeight,
  placeholderImageUrl,
  placeholderNode,
  placeholderBadge,
}: ImageCropUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vérifie la résolution source d'une dataURL ou URL distante par rapport
  // aux minimums `minSourceWidth`/`minSourceHeight`. Retourne `true` si
  // l'image satisfait la contrainte (ou s'il n'y a pas de contrainte).
  const checkMinSourceSize = useCallback(
    (src: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (!minSourceWidth && !minSourceHeight) {
          resolve(true);
          return;
        }
        const probe = new window.Image();
        probe.crossOrigin = "anonymous";
        probe.onload = () => {
          const okW = minSourceWidth ? probe.naturalWidth >= minSourceWidth : true;
          const okH = minSourceHeight ? probe.naturalHeight >= minSourceHeight : true;
          resolve(okW && okH);
        };
        probe.onerror = () => resolve(false);
        probe.src = src;
      }),
    [minSourceWidth, minSourceHeight],
  );

  // Message d'erreur générique pour un format trop petit.
  const minSizeErrorMessage = useMemo(() => {
    if (!minSourceWidth && !minSourceHeight) return null;
    if (minSourceWidth && minSourceHeight) {
      return `Le ${(label || "fichier").toLowerCase()} doit faire au moins ${minSourceWidth}×${minSourceHeight} pixels.`;
    }
    if (minSourceWidth) {
      return `Le ${(label || "fichier").toLowerCase()} doit faire au moins ${minSourceWidth} pixels de large.`;
    }
    return `Le ${(label || "fichier").toLowerCase()} doit faire au moins ${minSourceHeight} pixels de haut.`;
  }, [minSourceWidth, minSourceHeight, label]);

  // Si une `externalImageSrc` est fournie alors qu'elle est trop petite,
  // on la rejette dès qu'elle arrive (sans ouvrir le cropper).
  useEffect(() => {
    if (!externalImageSrc) return;
    if (!minSourceWidth && !minSourceHeight) return;
    let cancelled = false;
    void checkMinSourceSize(externalImageSrc).then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setError(minSizeErrorMessage);
        onExternalCropResolved?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    externalImageSrc,
    minSourceWidth,
    minSourceHeight,
    checkMinSourceSize,
    minSizeErrorMessage,
    onExternalCropResolved,
  ]);

  const isRack = !!rackShape;
  const rackH = rackShape?.heightU ?? 1;
  const aspect = rackShape ? rackAspect(rackShape.heightU, rackShape.widthFraction) : undefined;

  // ── Mode lecture pure ────────────────────────────────────────────────────
  //
  // On affiche l'image (si présente) ou un placeholder (icône centrée) dans
  // un conteneur respectant le même ratio que le mode édition. Pas de bordure
  // dashed, pas d'overlay d'upload, pas de bouton "Changer/Supprimer".
  if (readOnly) {
    const hasImage = !!value;
    return (
      <div className={cn("space-y-2", className)}>
        {label && (
          <p className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            {label}
          </p>
        )}
        {isRack ? (
          <div
            className="relative flex w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--secondary)]"
            style={{ aspectRatio: aspect }}
          >
            <div
              className="flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--secondary)]"
              style={{ width: 18 }}
            >
              {Array.from({ length: rackH }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-1 items-center justify-center border-b border-[var(--border)] last:border-b-0"
                >
                  <span className="font-mono text-[7px] text-[var(--muted-foreground)]">
                    {rackH - i}
                  </span>
                </div>
              ))}
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--secondary)]/60">
              {hasImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={value}
                  alt={label}
                  className="absolute inset-0 h-full w-full object-fill"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-center">
                  <ImageIcon
                    className="h-6 w-6 text-[var(--muted-foreground)]/40"
                    strokeWidth={1.5}
                  />
                  <p className="text-[9px] font-medium tracking-wider uppercase text-[var(--muted-foreground)]/60">
                    Aucune image
                  </p>
                </div>
              )}
            </div>
            <div
              className="flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--secondary)]"
              style={{ width: 18 }}
            >
              {Array.from({ length: rackH }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-1 items-center justify-center border-b border-[var(--border)] last:border-b-0"
                >
                  <span className="font-mono text-[7px] text-[var(--muted-foreground)]">
                    {rackH - i}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border)]/60 bg-[var(--secondary)]/40"
            style={
              forceAspectRatio
                ? { aspectRatio: forceAspectRatio }
                : { height: 100 }
            }
          >
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value}
                alt={label || "Aperçu"}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : placeholderImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={placeholderImageUrl}
                  alt={label || "Aperçu hérité"}
                  className="absolute inset-0 h-full w-full object-contain opacity-70"
                />
                {placeholderBadge && (
                  <span className="border-border bg-card/95 text-muted-foreground absolute top-2 left-2 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.15em] uppercase shadow-sm">
                    {placeholderBadge}
                  </span>
                )}
              </>
            ) : placeholderNode ? (
              <>
                <div className="text-muted-foreground/70 flex items-center justify-center opacity-70">
                  {placeholderNode}
                </div>
                {placeholderBadge && (
                  <span className="border-border bg-card/95 text-muted-foreground absolute top-2 left-2 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.15em] uppercase shadow-sm">
                    {placeholderBadge}
                  </span>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-center">
                <ImageIcon
                  className="h-8 w-8 text-[var(--muted-foreground)]/40"
                  strokeWidth={1.5}
                />
                <p className="text-[10px] font-medium tracking-wider uppercase text-[var(--muted-foreground)]/60">
                  Aucune image
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Source effective pour le cropper : la source locale (file upload) prime,
  // sinon on retombe sur la prop externe (image téléchargée par le parent).
  // Si l'image source ne respecte pas les minimums (cf. `minSourceWidth`/
  // `minSourceHeight`), on ne renvoie rien — le cropper n'est pas ouvert.
  const cropSrc = rawSrc ?? externalImageSrc ?? null;
  const cropSrcIsExternal = !rawSrc && !!externalImageSrc;

  const openFile = () => {
    inputRef.current?.click();
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string | undefined;
      if (!dataUrl) return;
      // Valide la résolution source AVANT d'ouvrir le cropper.
      const okSize = await checkMinSourceSize(dataUrl);
      if (!okSize) {
        setError(minSizeErrorMessage);
        return;
      }
      setRawSrc(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Confirmation crop : on reçoit cropArea en pixels image, on génère le blob, upload
  const handleConfirm = async (cropArea: CropArea) => {
    if (!cropSrc) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(cropSrc, cropArea);
      const fd = new FormData();
      fd.append("file", blob, "image.png");
      fd.append("folder", folder);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur upload");
        return;
      }
      onChange(data.url);
      setRawSrc(null);
      if (cropSrcIsExternal) onExternalCropResolved?.();
    } catch {
      setError("Erreur traitement image");
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setRawSrc(null);
    setError(null);
    if (cropSrcIsExternal) onExternalCropResolved?.();
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <p className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          {label}
        </p>
      )}

      {/* ── Cropper overlay ──
          Visuels RACK (rackShape fourni) : TwoPointCrop — 2 points + zoom
          molette/clavier + pan + réticule (précision sur les bords de
          façade), ratio imposé via forceAspectRatio géré en interne.
          Autres images à ratio imposé (photo 16:9, icônes…) : RatioCrop
          (drag-to-select + handles + fond blanc « Image entière »).
          Sans ratio : TwoPointCrop libre. */}
      {cropSrc &&
        (forceAspectRatio && !rackShape ? (
          <RatioCrop
            imageSrc={cropSrc}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            label={label}
            aspectRatio={forceAspectRatio}
            uploading={uploading}
            errorMessage={error}
          />
        ) : (
          <TwoPointCrop
            imageSrc={cropSrc}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            label={label}
            rackShape={rackShape}
            forceAspectRatio={forceAspectRatio}
            uploading={uploading}
            errorMessage={error}
          />
        ))}

      {/* ── Preview ── */}
      {isRack ? (
        <div
          className="group relative flex w-full cursor-pointer overflow-hidden rounded border border-[var(--border)] bg-[var(--secondary)]"
          style={{ aspectRatio: aspect }}
          onClick={openFile}
        >
          {/* Colonne gauche : numéros U */}
          <div
            className="flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--secondary)]"
            style={{ width: 18 }}
          >
            {Array.from({ length: rackH }).map((_, i) => (
              <div
                key={i}
                className="flex flex-1 items-center justify-center border-b border-[var(--border)] last:border-b-0"
              >
                <span className="font-mono text-[7px] text-[var(--muted-foreground)]">
                  {rackH - i}
                </span>
              </div>
            ))}
          </div>

          {/* Zone image centrale — l'image remplit totalement (object-fill)
              quitte à légèrement déformer le ratio L×l du crop. Placeholder
              minimaliste (icône seule) — pas d'overlay au hover. */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
            ) : value ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={value}
                alt={label}
                className="absolute inset-0 h-full w-full object-fill"
              />
            ) : (
              <ImageIcon className="h-5 w-5 text-[var(--muted-foreground)] opacity-40" />
            )}
          </div>

          {/* Colonne droite : numéros U (miroir de la gauche) */}
          <div
            className="flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--secondary)]"
            style={{ width: 18 }}
          >
            {Array.from({ length: rackH }).map((_, i) => (
              <div
                key={i}
                className="flex flex-1 items-center justify-center border-b border-[var(--border)] last:border-b-0"
              >
                <span className="font-mono text-[7px] text-[var(--muted-foreground)]">
                  {rackH - i}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--secondary)]/40 transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/60"
          style={
            forceAspectRatio
              ? { aspectRatio: forceAspectRatio }
              : { height: 100 }
          }
          onClick={openFile}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
          ) : value ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={value}
              alt={label || "Aperçu"}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : placeholderImageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={placeholderImageUrl}
                alt={label || "Aperçu hérité"}
                className="absolute inset-0 h-full w-full object-contain opacity-70"
              />
              {placeholderBadge && (
                <span className="border-border bg-card/95 text-muted-foreground absolute top-2 left-2 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.15em] uppercase shadow-sm">
                  {placeholderBadge}
                </span>
              )}
            </>
          ) : placeholderNode ? (
            <>
              <div className="text-muted-foreground/70 flex items-center justify-center opacity-70">
                {placeholderNode}
              </div>
              {placeholderBadge && (
                <span className="border-border bg-card/95 text-muted-foreground absolute top-2 left-2 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.15em] uppercase shadow-sm">
                  {placeholderBadge}
                </span>
              )}
            </>
          ) : (
            <ImageIcon className="h-7 w-7 text-[var(--muted-foreground)]/60" />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openFile}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          <Upload className="h-3 w-3" />
          {value ? "Changer" : "Uploader"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500"
          >
            <X className="h-3 w-3" />
            Supprimer
          </button>
        )}
        {error && !rawSrc && <p className="ml-auto text-[11px] text-red-500">{error}</p>}
      </div>
      <p className="text-[10px] text-[var(--muted-foreground)]">PNG, JPG, WebP, SVG — max 10 Mo</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
        onClick={(e) => {
          (e.target as HTMLInputElement).value = "";
        }}
      />
    </div>
  );
}
