/**
 * Mesure de texte + padding — pour aligner le rendu TEXT du drawing-editor
 * sur le tool label synoptique (cf. `components/synoptique/synoptic-view.tsx`
 * fonctions `measureLabelWidth` et géométrie `8784-8804`).
 *
 * Module pur : pas de dépendance Prisma ni React. Utilise `document` via
 * un span temporaire si disponible (sinon fallback heuristique 0.55 × fs).
 */

let _measureSpan: HTMLSpanElement | null = null;

/**
 * Largeur de rendu (en unité fontSize) du texte. Fallback heuristique en
 * environnement non-DOM (SSR, tests).
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily?: string | null,
  fontWeight?: string,
  fontStyle?: string,
): number {
  if (typeof document === "undefined") return text.length * fontSize * 0.55;
  if (!_measureSpan) {
    _measureSpan = document.createElement("span");
    _measureSpan.style.position = "absolute";
    _measureSpan.style.visibility = "hidden";
    _measureSpan.style.whiteSpace = "pre";
    _measureSpan.style.top = "-9999px";
    _measureSpan.style.left = "-9999px";
    _measureSpan.style.pointerEvents = "none";
    document.body.appendChild(_measureSpan);
  }
  _measureSpan.style.fontFamily = fontFamily ?? "system-ui";
  _measureSpan.style.fontSize = `${fontSize}px`;
  _measureSpan.style.fontWeight = fontWeight ?? "normal";
  _measureSpan.style.fontStyle = fontStyle ?? "normal";
  _measureSpan.textContent = text || " ";
  return _measureSpan.getBoundingClientRect().width;
}

/**
 * Padding texte ↔ bbox synoptique. Le mode pill double les paddings pour
 * aérer la pillule visuelle (cf. synoptic-view.tsx:8796-8798).
 */
export function textPadding(fontSize: number, pill: boolean) {
  return {
    padX: pill ? Math.max(10, fontSize * 0.5) : 2,
    padTop: pill ? Math.max(4, fontSize * 0.22) : 1,
    padBot: pill ? Math.max(4, fontSize * 0.22) : 3,
  };
}

/**
 * Calcule la bbox (w, h) du TEXT à partir des propriétés visuelles.
 * Le `text` vide est traité comme un caractère espace pour avoir une bbox
 * minimale visible.
 */
export function computeTextBbox(opts: {
  text: string;
  fontSize: number;
  fontFamily?: string | null;
  fontWeight?: string;
  fontStyle?: string;
  pill?: boolean;
}): { w: number; h: number } {
  const isPill = !!opts.pill;
  const { padX, padTop, padBot } = textPadding(opts.fontSize, isPill);
  const measured = measureTextWidth(
    opts.text || "À modifier…",
    opts.fontSize,
    opts.fontFamily,
    opts.fontWeight,
    opts.fontStyle,
  );
  const lblW = Math.max(measured, opts.fontSize * 0.5);
  return {
    w: lblW + padX * 2,
    h: opts.fontSize + padTop + padBot,
  };
}
