/**
 * Connexions externes — présentation de la bulle.
 *
 * Deux natures (cf. `ExternalPortKind`) :
 *  - `INTER_LIEU` : la bulle affiche la cible résolue côté serveur
 *    (`targetLabel`), sinon « Non rattaché ».
 *  - `MONDE` : « lien externe » côté UI — sortie hors projet. La bulle affiche
 *    l'étiquette libre saisie dans le panneau de propriétés (`label`), jamais
 *    « Non rattaché », et porte un badge `EXT`. (La valeur d'enum stockée reste
 *    `MONDE`, seul le libellé visible a été renommé.)
 *
 * Le texte ET la largeur de la bulle sont calculés ici parce que trois endroits
 * en dépendent : le rendu SVG, le hit-test du rubber-band (preview) et son
 * commit. Un seul point de vérité = pas de dérive entre la boîte dessinée et la
 * boîte testée.
 */

import {
  EXTERNAL_PORT_KIND_DEFAULT,
  type ExternalPortData,
  type ExternalPortKind,
} from "@/components/synoptique/types/synoptic";

/** Texte affiché quand un port MONDE n'a pas encore d'étiquette. */
export const EXTERNAL_WORLD_PLACEHOLDER = "Étiquette…";
/** Texte affiché quand un port INTER_LIEU n'a pas de cible résolue. */
export const EXTERNAL_UNRESOLVED_LABEL = "Non rattaché";

/** Largeur réservée au badge `EXT` dans une bulle MONDE (0 sinon). */
export const EXTERNAL_BADGE_W = 30;

const BOX_PAD_X = 14;
const CHAR_W = 6.2;
const BOX_MIN_W = 120;

type ExternalPortLike = Pick<ExternalPortData, "kind" | "label" | "targetLabel">;

/** Nature du port, avec repli sur `INTER_LIEU` (payload antérieur). */
export function externalPortKind(ext: { kind?: string | null }): ExternalPortKind {
  return ext.kind === "MONDE" ? "MONDE" : EXTERNAL_PORT_KIND_DEFAULT;
}

export type ExternalBubble = {
  kind: ExternalPortKind;
  isWorld: boolean;
  /** Texte à rendre dans la bulle. */
  text: string;
  /** `true` = texte de remplacement (rendu en muted italique). */
  isPlaceholder: boolean;
  /** Largeur totale de la bulle, badge inclus. */
  width: number;
  /** Largeur réservée au badge `EXT` (0 si INTER_LIEU). */
  badgeW: number;
};

/** Contenu + géométrie de la bulle d'une connexion externe. */
export function externalBubble(ext: ExternalPortLike): ExternalBubble {
  const kind = externalPortKind(ext);
  const isWorld = kind === "MONDE";
  const raw = isWorld ? (ext.label ?? "").trim() : (ext.targetLabel ?? "").trim();
  const isPlaceholder = raw.length === 0;
  const text = isPlaceholder
    ? isWorld
      ? EXTERNAL_WORLD_PLACEHOLDER
      : EXTERNAL_UNRESOLVED_LABEL
    : raw;
  const badgeW = isWorld ? EXTERNAL_BADGE_W : 0;
  const width =
    Math.max(BOX_MIN_W, Math.round(text.length * CHAR_W + BOX_PAD_X * 2)) + badgeW;
  return { kind, isWorld, text, isPlaceholder, width, badgeW };
}
