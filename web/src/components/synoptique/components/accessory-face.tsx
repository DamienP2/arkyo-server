"use client";

/**
 * AccessoryFace — dessin de la FACE AVANT d'un accessoire rack.
 *
 * UNE seule implémentation, partagée par :
 *  - l'aperçu du configurateur Accessoires (panneau Inventaire) ;
 *  - le rendu d'un slot accessoire dans le rack, quel que soit le mode
 *    d'affichage (STD / GFX / PIC) et la vue (infos ou réelle) — les
 *    accessoires n'ont jamais de visuel uploadé, c'est ce dessin qui tient
 *    lieu de représentation ;
 *  - l'aperçu de la palette accessoires du rack-editor historique.
 *
 * Règles de dessin :
 *  - aucun texte dans le dessin (les libellés sont posés par l'appelant) ;
 *  - tokens de l'app uniquement, jamais de couleur en dur ;
 *  - toutes les cotes de détail (vis, fentes, découpe, poils, poignée,
 *    oreilles, plateau) sont des CONSTANTES calées sur le rendu 1U. Changer la
 *    hauteur en U n'agrandit rien : seule la façade s'allonge, exactement comme
 *    une vraie pièce 19". Aucune cote ne doit dériver de `height` ;
 *  - le « U » de l'étagère est obtenu par deux calques `clip-path` empilés
 *    (contour puis remplissage) : la pièce est d'un seul tenant — un
 *    remplissage, un contour, aucune séparation entre oreilles et plateau —
 *    et reste correcte quelle que soit la largeur du conteneur, ce qu'un
 *    viewBox SVG ne permettait pas sans distordre le dessin.
 */

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type AccessoryFaceType = "plaque" | "etagere" | "tiroir";
export type AccessoryFaceVariant = "plein" | "pass-cable" | "aere";

// ── Tokens de dessin ─────────────────────────────────────────────────────────

/** Contour de la pièce. */
export const FACE_EDGE = "color-mix(in srgb, var(--foreground) 32%, transparent)";
/** Matière (tôle). */
export const FACE_FILL = "var(--secondary)";
/** Vis de fixation. */
const FACE_SCREW = "color-mix(in srgb, var(--foreground) 28%, transparent)";
/** Fentes de ventilation — lues comme des ouvertures. */
const FACE_VENT = "color-mix(in srgb, var(--foreground) 24%, transparent)";
/** Poils des balais du passe-câble — volontairement contrastés. */
const FACE_BRUSH = "color-mix(in srgb, var(--foreground) 46%, transparent)";
/** Poignée de tiroir. */
const FACE_HANDLE = "color-mix(in srgb, var(--foreground) 22%, transparent)";

/** Largeur maximale du dessin hors mode `fill` (aperçu du configurateur). */
export const FACE_MAX_W = 196;
/** Épaisseur du contour. */
const EDGE_W = 1.5;

// ── Cotes de détail — FIGÉES ─────────────────────────────────────────────────
//
// Toutes les cotes ci-dessous sont celles du rendu 1U et ne dépendent JAMAIS de
// `height` : une plaque 4U est une plaque 1U plus haute, pas un dessin agrandi.
// Seule la hauteur totale de la façade varie ; les motifs de remplissage (les
// fentes d'aération) s'étendent donc simplement sur plus de hauteur, avec le
// même pas et les mêmes retraits.

/** Vis de fixation : diamètre et retrait des angles. */
const SCREW_D = 5;
const SCREW_INSET = 3;
/** Plaque aérée : retraits de la bande de fentes, largeur d'une fente, pas. */
const VENT_INSET_Y = 6;
const VENT_INSET_X = 12;
const VENT_SLOT_W = 3;
const VENT_PITCH = 9;
/** Passe-câble : hauteur de la découpe, hauteur d'une rangée de poils, pas. */
const SLOT_H = 12;
const BRUSH_ROW_H = 5;
const BRISTLE_W = 3;
const BRUSH_PITCH = 7;
/** Tiroir : hauteur de la poignée (centrée, largeur en % de la façade). */
const HANDLE_H = 5;
/** Étagère : largeur d'une oreille de fixation. */
export const SHELF_FLANGE_W = 14;
/** Étagère : épaisseur du plateau bas. */
export const SHELF_PLATE_H = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hauteur de dessin de l'aperçu du configurateur : 28 px en 1U, 98 px en 8U.
 * Le rack, lui, passe la hauteur réelle du slot (`heightU × U_HEIGHT_PX`).
 */
export function previewFaceHeight(heightU: number): number {
  return 18 + heightU * 10;
}

/**
 * Normalise le style de plaque persisté dans `RackSlot.notes.style`.
 * `transversal` / `longitudinal` sont les anciens libellés du passe-câble
 * (palette historique du rack-editor) : même pièce, donc même dessin.
 */
export function normalizeFaceVariant(style?: string | null): AccessoryFaceVariant {
  if (style === "aere") return "aere";
  if (style === "pass-cable" || style === "transversal" || style === "longitudinal") {
    return "pass-cable";
  }
  return "plein";
}

/**
 * Contour du « U » de l'étagère, insetté de `e` px : deux oreilles pleine
 * hauteur reliées par le plateau bas, centre ouvert.
 */
function shelfClipPath(e: number): string {
  const x0 = `${e}px`;
  const x1 = `${SHELF_FLANGE_W - e}px`;
  const x2 = `calc(100% - ${SHELF_FLANGE_W - e}px)`;
  const x3 = `calc(100% - ${e}px)`;
  const yTop = `${e}px`;
  const yNotch = `calc(100% - ${SHELF_PLATE_H - e}px)`;
  const yBot = `calc(100% - ${e}px)`;
  return `polygon(${x0} ${yTop}, ${x1} ${yTop}, ${x1} ${yNotch}, ${x2} ${yNotch}, ${x2} ${yTop}, ${x3} ${yTop}, ${x3} ${yBot}, ${x0} ${yBot})`;
}

/** Vis de fixation aux quatre angles — cotes fixes, simplement ancrées. */
function FaceScrews() {
  return (
    <>
      {(
        [
          { top: SCREW_INSET, left: SCREW_INSET },
          { top: SCREW_INSET, right: SCREW_INSET },
          { bottom: SCREW_INSET, left: SCREW_INSET },
          { bottom: SCREW_INSET, right: SCREW_INSET },
        ] as const
      ).map((pos, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-full"
          style={{ ...pos, width: SCREW_D, height: SCREW_D, background: FACE_SCREW }}
        />
      ))}
    </>
  );
}

// ── Composant ────────────────────────────────────────────────────────────────

export function AccessoryFace({
  type,
  variant,
  height,
  fill = false,
  screws = true,
  className,
  style,
  children,
  "aria-label": ariaLabel,
}: {
  type: AccessoryFaceType;
  /**
   * Plaque uniquement. Typé large : on reçoit aussi bien la variante du
   * configurateur que le style brut persisté dans `RackSlot.notes.style`,
   * y compris les libellés historiques (cf. `normalizeFaceVariant`).
   */
  variant?: AccessoryFaceVariant | string | null;
  /**
   * Hauteur de la façade en px — hors mode `fill` uniquement (le mode `fill`
   * prend la hauteur du parent). Elle ne pilote AUCUNE cote de détail : le
   * dessin est le même en 1U et en 8U, seule la façade s'allonge.
   */
  height: number;
  /** Remplir le parent (100 % × 100 %) — rendu dans un slot de rack. */
  fill?: boolean;
  /** Vis d'angle (désactivables pour un usage en vignette minuscule). */
  screws?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Contenu superposé (enfants d'étagère, poignée de drag…). */
  children?: ReactNode;
  /** Libellé accessible — jamais rendu visuellement. */
  "aria-label"?: string;
}) {
  const box: CSSProperties = fill
    ? { width: "100%", height: "100%" }
    : { width: "100%", maxWidth: FACE_MAX_W, height };

  // ── Étagère : ce n'est PAS une face pleine ────────────────────────────────
  // Vue de face on ne voit que les deux oreilles de fixation et le plateau bas ;
  // le centre est ouvert, on voit à travers.
  if (type === "etagere") {
    return (
      <div className={cn("relative", className)} style={{ ...box, ...style }} aria-label={ariaLabel}>
        <span
          className="pointer-events-none absolute inset-0"
          style={{ background: FACE_EDGE, clipPath: shelfClipPath(0) }}
        />
        <span
          className="pointer-events-none absolute inset-0"
          style={{ background: FACE_FILL, clipPath: shelfClipPath(EDGE_W) }}
        />
        {screws && <FaceScrews />}
        {children != null && (
          <div
            className="absolute"
            style={{
              left: SHELF_FLANGE_W,
              right: SHELF_FLANGE_W,
              top: 0,
              bottom: SHELF_PLATE_H,
            }}
          >
            {children}
          </div>
        )}
      </div>
    );
  }

  // ── Plaque / tiroir : façade pleine ───────────────────────────────────────
  const v = normalizeFaceVariant(variant ?? undefined);
  const isPlaque = type === "plaque";
  const isAere = isPlaque && v === "aere";
  const isPassCable = isPlaque && v === "pass-cable";

  return (
    <div
      className={cn("relative overflow-hidden rounded-[3px]", className)}
      style={{
        ...box,
        border: `${EDGE_W}px solid ${FACE_EDGE}`,
        background: FACE_FILL,
        ...style,
      }}
      aria-label={ariaLabel}
    >
      {screws && <FaceScrews />}

      {/* Aérée : fentes verticales qui FLOTTENT dans la plaque — elles ne
          touchent ni le haut, ni le bas, ni les bords latéraux. Retraits et pas
          fixes : sur une plaque plus haute, les fentes sont plus longues, pas
          plus larges ni plus espacées. */}
      {isAere && (
        <span
          className="pointer-events-none absolute rounded-[1px]"
          style={{
            left: VENT_INSET_X,
            right: VENT_INSET_X,
            top: VENT_INSET_Y,
            bottom: VENT_INSET_Y,
            backgroundImage: `repeating-linear-gradient(90deg, ${FACE_VENT} 0 ${VENT_SLOT_W}px, transparent ${VENT_SLOT_W}px ${VENT_PITCH}px)`,
          }}
        />
      )}

      {/* Passe-câble : découpe sombre bien marquée, garnie de deux rangées de
          balais qui se rejoignent au centre. La fente garde sa hauteur quelle
          que soit celle de la plaque — c'est une fente, pas une trappe ; elle
          est simplement centrée (`50 %` + translate, robuste au mode `fill`). */}
      {isPassCable && (
        <span
          className="pointer-events-none absolute overflow-hidden rounded-[2px]"
          style={{
            left: "14%",
            right: "14%",
            top: "50%",
            height: SLOT_H,
            transform: "translateY(-50%)",
            backgroundColor: "var(--background)",
            border: `1px solid ${FACE_EDGE}`,
          }}
        >
          {(["top", "bottom"] as const).map((row) => (
            <span
              key={row}
              className="absolute"
              style={{
                left: 0,
                right: 0,
                ...(row === "top" ? { top: 0 } : { bottom: 0 }),
                height: BRUSH_ROW_H,
                backgroundImage: `repeating-linear-gradient(90deg, ${FACE_BRUSH} 0 ${BRISTLE_W}px, transparent ${BRISTLE_W}px ${BRUSH_PITCH}px)`,
              }}
            />
          ))}
        </span>
      )}

      {/* Tiroir : poignée centrée sur la façade. */}
      {type === "tiroir" && (
        <span
          className="pointer-events-none absolute rounded-full"
          style={{
            left: "34%",
            right: "34%",
            top: "50%",
            height: HANDLE_H,
            transform: "translateY(-50%)",
            background: FACE_HANDLE,
          }}
        />
      )}

      {children}
    </div>
  );
}
