"use client";

/**
 * Capture des objets d'une planche d'élévations, pour le PDF.
 *
 * Partagé par l'export de l'onglet Rack et par la planche du dossier : les deux
 * capturent exactement les mêmes nœuds, aux mêmes cotes, et se posaient la même
 * question de résolution et de codec — en double, donc à divergence garantie.
 *
 * ── Résolution ────────────────────────────────────────────────────────────
 * On vise ~300 dpi À LA TAILLE IMPRIMÉE, pas une résolution fixe. Une vue posée
 * en 50 mm n'a pas besoin du même nombre de pixels qu'une vue en 200 mm, et une
 * planche de six élévations capturées « au maximum » produirait un PDF
 * impossible à ouvrir.
 *
 * ── Codec ─────────────────────────────────────────────────────────────────
 * Le PNG est SANS PERTE : sur une élévation en mode photo, il produisait des
 * images de 50 Mo pour une seule planche. Le contenu est alors photographique,
 * et le PNG est le mauvais codec.
 *
 * Mais le JPEG n'a pas de couche alpha, et la transparence n'est pas
 * décorative ici : les objets d'une planche peuvent se chevaucher, et le
 * cartouche est composité par-dessus. D'où la règle : un objet qui n'en
 * recouvre aucun autre est aplati sur blanc et encodé en JPEG (le résultat est
 * pixel pour pixel celui du PNG sur une page blanche) ; un objet qui en
 * chevauche un autre garde sa transparence et son PNG.
 *
 * Le chevauchement se décide sur les cotes RÉELLES, mesurées dans le DOM avant
 * la capture — pas sur une hauteur supposée.
 */

import type { ComposedBlueprintItem } from "@/lib/print/export-with-cartouche";

import { captureWithFlatten } from "../../reseau/_components/shared/export-capture";
import { rackViewCaptureSelector } from "./rack-export-composer";
import { rectsIntersect, type Rect } from "./rack-export-layout";

/** Résolution visée à la taille imprimée. */
const CAPTURE_DPI = 300;
/**
 * Bornes du facteur de capture. Le plancher évite de DÉGRADER une vue rendue
 * plus grande que sa taille imprimée ; le plafond évite qu'une vue rendue
 * minuscule ne soit multipliée à l'infini pour atteindre les 300 dpi.
 */
const RATIO_MIN = 1;
const RATIO_MAX = 4;

/**
 * Plafond absolu de pixels par objet. Le calcul en dpi suffit dans les cas
 * normaux ; ce garde-fou couvre l'objet démesuré — un lieu de dix racks posé en
 * pleine page — dont la seule capture épuiserait la mémoire de l'onglet.
 */
const ITEM_BUDGET_PX = 20_000_000;

/** Qualité JPEG. Au-delà le gain de finesse ne se voit plus, le poids si. */
const JPEG_QUALITY = 0.85;

/** Objet à capturer : son identifiant et sa place sur la feuille (mm). */
export type RackCaptureTarget = { id: string; x: number; y: number; w: number };

/**
 * Capture les objets d'une planche et renvoie de quoi les poser sur la page.
 *
 * Séquentiel à dessein : chaque capture monopolise le rasteriseur de
 * html-to-image, les paralléliser ne gagne rien et sature la mémoire sur les
 * grandes élévations.
 *
 * Un objet introuvable dans le DOM est SAUTÉ, pas deviné : l'appelant constate
 * le manque sur le résultat.
 */
export async function captureRackItems(
  targets: ReadonlyArray<RackCaptureTarget>,
): Promise<ComposedBlueprintItem[]> {
  // ── 1. Mesure ─────────────────────────────────────────────────────────────
  // Toutes les cotes AVANT toute capture : le chevauchement se décide sur la
  // planche entière, et capturer modifie le DOM le temps d'une passe.
  type Measured = RackCaptureTarget & { el: HTMLElement; rect: Rect };
  const measured: Measured[] = [];
  for (const t of targets) {
    const el = document.querySelector<HTMLElement>(
      rackViewCaptureSelector(t.id),
    );
    if (!el) continue;
    const naturalW = el.offsetWidth;
    const naturalH = el.offsetHeight;
    if (naturalW <= 0 || naturalH <= 0) continue;
    measured.push({
      ...t,
      el,
      rect: { x: t.x, y: t.y, w: t.w, h: (t.w * naturalH) / naturalW },
    });
  }

  // ── 2. Codec ──────────────────────────────────────────────────────────────
  const overlapping = new Set<string>();
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) {
      if (rectsIntersect(measured[i]!.rect, measured[j]!.rect)) {
        overlapping.add(measured[i]!.id);
        overlapping.add(measured[j]!.id);
      }
    }
  }

  // ── 3. Capture ────────────────────────────────────────────────────────────
  const out: ComposedBlueprintItem[] = [];
  for (const m of measured) {
    const opaque = !overlapping.has(m.id);
    const canvas = await captureWithFlatten(m.el, {
      pixelRatio: pixelRatioFor(m.el.offsetWidth, m.el.offsetHeight, m.w),
      // Aplati sur blanc UNIQUEMENT quand il n'y a rien dessous : le JPEG
      // rendrait sinon les zones transparentes NOIRES, pas blanches.
      background: opaque ? "#ffffff" : undefined,
    });
    const dataUrl = opaque
      ? canvas.toDataURL("image/jpeg", JPEG_QUALITY)
      : canvas.toDataURL("image/png");
    const shotW = canvas.width;
    const shotH = canvas.height;
    // Une planche peut compter six vues : sans relâchement, six tampons de
    // pleine résolution restent vivants jusqu'à l'assemblage.
    canvas.width = 0;
    canvas.height = 0;
    out.push({
      dataUrl,
      x: m.x,
      y: m.y,
      w: m.w,
      // Hauteur dérivée du ratio de la CAPTURE : aucune dérive possible entre
      // ce qui est mesuré et ce qui est posé sur la page.
      h: (m.w * shotH) / shotW,
    });
  }
  return out;
}

/** Facteur de capture d'un objet, bornes et budget compris. */
function pixelRatioFor(
  naturalW: number,
  naturalH: number,
  widthMm: number,
): number {
  const targetPx = (widthMm / 25.4) * CAPTURE_DPI;
  let ratio = Math.max(
    RATIO_MIN,
    Math.min(RATIO_MAX, targetPx / Math.max(1, naturalW)),
  );
  const budgetRatio = Math.sqrt(
    ITEM_BUDGET_PX / Math.max(1, naturalW * naturalH),
  );
  if (ratio > budgetRatio) ratio = budgetRatio;
  return Math.max(0.1, ratio);
}
