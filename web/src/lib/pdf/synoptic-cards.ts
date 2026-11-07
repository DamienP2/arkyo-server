/**
 * Rendu VECTORIEL des cartes d'équipement.
 *
 * Les cartes sont le seul élément de la scène qui soit du HTML : les couches
 * SVG partent telles quelles au PDF, elles non. C'est donc ICI, et nulle part
 * ailleurs, qu'un second renderer existe — et c'est cette famille que le test
 * anti-dérive surveille (`tests/unit/scene-descriptor.test.ts`).
 *
 * Le module ne connaît que le descripteur : aucune lecture du DOM, aucun accès
 * à React. Il pose des primitives à partir de cotes déjà résolues.
 *
 * ── Palette ───────────────────────────────────────────────────────────────
 * Les cartes de l'écran s'habillent de variables de thème. Une feuille se lit
 * sur du papier blanc : la palette est donc RÉSOLUE depuis le thème courant
 * quand il est clair, et remplacée par celle du document quand il est sombre.
 * Reproduire un thème sombre sur une planche d'impression donnerait des aplats
 * d'encre et une carte illisible — le document a ses propres règles.
 */

import type {
  CardPanelRow,
  CardPort,
  EquipmentCardDescriptor,
  LegendDescriptor,
  PortDirection,
} from "@/components/synoptique/lib/scene-descriptor";
import { CARD_METRICS } from "@/components/synoptique/lib/scene-descriptor";
import { INK_HEX, MUTED_HEX, PT } from "@/lib/print/technical-frame";
import type { VectorFrame } from "@/lib/pdf/synoptic-vector";

/** Sous-ensemble de jsPDF utilisé par ce renderer. */
export type CardDoc = {
  setFillColor: (c: string) => void;
  setDrawColor: (c: string) => void;
  setTextColor: (c: string) => void;
  setLineWidth: (w: number) => void;
  setFontSize: (s: number) => void;
  setFont: (family: string, style?: string) => void;
  setGState: (g: unknown) => void;
  GState: (opts: Record<string, unknown>) => unknown;
  /**
   * `style` accepte `null` : idiome jsPDF pour poser un chemin SANS le peindre,
   * préalable à `clip()`. L'omettre retombe sur un TRAIT.
   */
  rect: (
    x: number,
    y: number,
    w: number,
    h: number,
    style?: string | null,
  ) => void;
  roundedRect: (
    x: number,
    y: number,
    w: number,
    h: number,
    rx: number,
    ry: number,
    style?: string,
  ) => void;
  circle: (x: number, y: number, r: number, style?: string) => void;
  triangle: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    style?: string,
  ) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  text: (
    t: string,
    x: number,
    y: number,
    opts?: { align?: "left" | "center" | "right" },
  ) => void;
  getTextWidth: (t: string) => number;
  saveGraphicsState: () => void;
  restoreGraphicsState: () => void;
  clip: () => void;
  discardPath?: () => void;
};

export type CardPalette = {
  surface: string;
  header: string;
  headerPanel: string;
  border: string;
  ink: string;
  muted: string;
  badgeBg: string;
};

/** Palette du DOCUMENT — même grammaire que le cartouche technique. */
export const PRINT_CARD_PALETTE: CardPalette = {
  surface: "#ffffff",
  header: "#f4f5f8",
  headerPanel: "#eeeff8",
  border: "#c9ccd8",
  ink: INK_HEX,
  muted: MUTED_HEX,
  badgeBg: "#eceef2",
};

/** Couleurs des flèches de direction — littérales à l'écran comme au PDF. */
const DIR_IN = "#ef4444";
const DIR_OUT = "#22c55e";
/** Teinte d'une pastille non câblée, et d'une traversée de panel inactive. */
const IDLE_LINE = "#d1d5db";

// ── Palette : résolution depuis le thème ────────────────────────────────────

const THEME_TOKENS = [
  "--surface",
  "--secondary",
  "--border",
  "--foreground",
  "--muted-foreground",
] as const;

function parseRgb(value: string): { r: number; g: number; b: number } | null {
  const m = /rgba?\(([^)]+)\)/i.exec(value);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
  return { r: p[0], g: p[1], b: p[2] };
}

function hex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Résout les couleurs de carte depuis le thème courant.
 *
 * Passe par des sondes plutôt que par la valeur brute de la variable : un
 * thème peut la définir en `oklch()` ou `color-mix()`, que jsPDF ne sait pas
 * lire. Lire la couleur CALCULÉE d'un élément donne toujours du `rgb()`.
 *
 * Thème sombre → palette du document. Une planche s'imprime sur du blanc.
 */
export function resolveCardPalette(host: Element): CardPalette {
  if (typeof window === "undefined") return PRINT_CARD_PALETTE;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "-99999px";
  probe.style.top = "0";
  probe.style.pointerEvents = "none";
  const spans = THEME_TOKENS.map((token) => {
    const s = document.createElement("span");
    s.style.color = `var(${token})`;
    probe.appendChild(s);
    return s;
  });
  // Dans le MÊME hôte que la scène : un thème posé sur un conteneur, et non
  // sur la racine, ne se lirait pas ailleurs.
  host.appendChild(probe);
  try {
    const values = spans.map((s) => parseRgb(getComputedStyle(s).color));
    if (values.some((v) => !v)) return PRINT_CARD_PALETTE;
    const [surface, secondary, border, foreground, muted] = values as Array<{
      r: number;
      g: number;
      b: number;
    }>;
    if (luminance(surface) < 0.5) return PRINT_CARD_PALETTE;
    return {
      surface: hex(surface),
      header: hex(secondary),
      // Le bandeau d'un panel est teinté d'indigo à l'écran ; on reproduit le
      // mélange plutôt que de relire une couleur composée.
      headerPanel: hex({
        r: secondary.r * 0.88 + 99 * 0.12,
        g: secondary.g * 0.88 + 102 * 0.12,
        b: secondary.b * 0.88 + 241 * 0.12,
      }),
      border: hex(border),
      ink: hex(foreground),
      muted: hex(muted),
      badgeBg: hex(border),
    };
  } catch {
    return PRINT_CARD_PALETTE;
  } finally {
    probe.remove();
  }
}

// ── Rendu ───────────────────────────────────────────────────────────────────

/** Repère scène → page : millimètres par unité de scène, et origine. */
type Mapping = { k: number; ox: number; oy: number };

function mappingOf(frame: VectorFrame): Mapping {
  const s = Math.min(frame.page.w / frame.box.w, frame.page.h / frame.box.h);
  return {
    k: frame.camera.zoom * s,
    ox: frame.camera.pan.x * s,
    oy: frame.camera.pan.y * s,
  };
}

/** Taille de police jsPDF (points) pour une hauteur donnée en unités de scène. */
function fontPt(scenePx: number, k: number): number {
  return (scenePx * k) / PT;
}

/** Tronque avec une ellipse pour tenir dans une largeur, en mm. */
function fitText(doc: CardDoc, text: string, maxMm: number): string {
  if (maxMm <= 0) return "";
  if (doc.getTextWidth(text) <= maxMm) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${text.slice(0, mid)}…`) <= maxMm) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

function withOpacity(doc: CardDoc, opacity: number, draw: () => void): void {
  if (opacity >= 1) return draw();
  doc.saveGraphicsState();
  try {
    doc.setGState(doc.GState({ opacity }));
    draw();
  } finally {
    doc.restoreGraphicsState();
  }
}

/**
 * Familles d'éléments effectivement REDESSINÉES en objets PDF.
 *
 * Ces deux listes sont le garde-fou anti-dérive, confronté à
 * `SCENE_ELEMENT_KINDS` par `tests/unit/scene-descriptor.test.ts`. Elles
 * vivent ici parce que ce module est le SEUL à redessiner quoi que ce soit :
 * les couches SVG transitent telles quelles, elles n'ont rien à déclarer.
 */
export const RENDERED_ELEMENT_KINDS: readonly string[] = [
  "equipment-card",
  "cable-legend",
];

/**
 * Familles `redraw` dont l'absence serait ASSUMÉE — elles sortiraient en image
 * plutôt qu'en objets. VIDE depuis que les cartes sont dessinées, et elle doit
 * le rester : chaque entrée serait une dette explicite, jamais un oubli.
 */
export const PENDING_REDRAW_KINDS: readonly string[] = [];

/**
 * Dessine la légende des signaux.
 *
 * Elle est posée dans le repère de la FEUILLE, pas dans celui de la scène :
 * c'est un panneau flottant calé au coin de la zone de travail, il ne suit ni
 * le zoom ni le déplacement du plan. Sa boîte vient donc de la copie, mesurée
 * telle qu'elle s'affiche dans l'aperçu.
 */
export function drawLegend(
  doc: CardDoc,
  legend: LegendDescriptor,
  frame: VectorFrame,
  palette: CardPalette,
): void {
  const s = Math.min(frame.page.w / frame.box.w, frame.page.h / frame.box.h);
  const X = (v: number) => v * s;
  const x = X(legend.x);
  const y = X(legend.y);
  const w = X(legend.w);
  const h = X(legend.h);
  const padX = X(12);
  const hair = Math.max(0.05, X(1));

  doc.setFillColor(palette.surface);
  doc.setDrawColor(palette.border);
  doc.setLineWidth(hair);
  doc.roundedRect(x, y, w, h, X(6), X(6), "FD");

  doc.setFont("helvetica", "bold");
  doc.setTextColor(palette.muted);
  doc.setFontSize(fontPt(9, s));
  doc.text(legend.title.toUpperCase(), x + padX, y + X(13));

  let ty = y + X(28);
  if (legend.rows.length === 0 && legend.emptyText) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(fontPt(10, s));
    doc.text(fitText(doc, legend.emptyText, w - padX * 2), x + padX, ty);
    return;
  }
  const rowH = X(15);
  for (const row of legend.rows) {
    // À l'écran la boîte défile au-delà de `max-h`. Sur papier il n'y a pas de
    // défilement : on s'arrête au bord plutôt que d'écrire par-dessus.
    if (ty > y + h - X(4)) break;
    doc.setFillColor(row.color);
    doc.circle(x + padX + X(5), ty - X(3), X(5), "F");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(palette.ink);
    doc.setFontSize(fontPt(11, s));
    doc.text(
      fitText(doc, row.name, w - padX * 2 - X(38)),
      x + padX + X(16),
      ty,
    );
    doc.setFont("courier", "normal");
    doc.setTextColor(palette.muted);
    doc.setFontSize(fontPt(10, s));
    doc.text(String(row.count), x + w - padX, ty, { align: "right" });
    ty += rowH;
  }
}

export function drawEquipmentCards(
  doc: CardDoc,
  cards: readonly EquipmentCardDescriptor[],
  frame: VectorFrame,
  palette: CardPalette,
): void {
  const m = mappingOf(frame);
  const X = (sceneX: number) => m.ox + sceneX * m.k;
  const Y = (sceneY: number) => m.oy + sceneY * m.k;
  const L = (len: number) => len * m.k;

  for (const card of cards) {
    drawCard(doc, card, m, X, Y, L, palette);
  }
}

function drawCard(
  doc: CardDoc,
  card: EquipmentCardDescriptor,
  m: Mapping,
  X: (v: number) => number,
  Y: (v: number) => number,
  L: (v: number) => number,
  palette: CardPalette,
): void {
  const x = X(card.x);
  const y = Y(card.y);
  const w = L(card.w);
  const h = L(card.h);
  const r = L(CARD_METRICS.radius);
  const headerH = L(CARD_METRICS.headerH);
  const hair = Math.max(0.05, L(1));

  // ── Corps ────────────────────────────────────────────────────────────────
  doc.setFillColor(palette.surface);
  doc.setDrawColor(palette.border);
  doc.setLineWidth(hair);
  doc.roundedRect(x, y, w, h, r, r, "FD");

  // ── Bandeau ──────────────────────────────────────────────────────────────
  // Coins hauts arrondis seulement : jsPDF n'expose pas de rayon par coin, on
  // pose donc un rectangle arrondi puis on carre le bas.
  doc.setFillColor(card.isPanel ? palette.headerPanel : palette.header);
  doc.roundedRect(x, y, w, headerH, r, r, "F");
  doc.rect(x, y + headerH - r, w, r, "F");
  doc.setDrawColor(palette.border);
  doc.setLineWidth(hair);
  doc.line(x, y + headerH, x + w, y + headerH);

  // Le bandeau est la SEULE zone à texte libre : titre, marque·modèle, badges.
  // On l'enferme, un seul état graphique par carte.
  //
  // Le CORPS, lui, n'est pas découpé — et ce n'est pas un oubli : les pastilles
  // de port sont centrées SUR le bord de la carte, un découpage les couperait
  // en deux. L'écran a la même règle (`overflow: visible`), et les libellés de
  // rangée sont déjà tronqués à la mesure.
  doc.saveGraphicsState();
  try {
    // `null` : chemin posé, PAS peint — sinon le rectangle de découpe se
    // dessine par-dessus le bandeau.
    doc.rect(x, y, w, headerH, null);
    doc.clip();
    doc.discardPath?.();
    drawHeader(doc, card, x, y, w, m, L, palette);
  } finally {
    doc.restoreGraphicsState();
  }

  // ── Filets ───────────────────────────────────────────────────────────────
  doc.setDrawColor(palette.muted);
  for (const d of card.dividers) {
    const dy = Y(d.y);
    const short = d.kind === "port";
    const dw = short ? L(CARD_METRICS.portDividerW) : w;
    const dx = short ? x + (w - dw) / 2 : x;
    doc.setLineWidth(hair);
    withOpacity(doc, short ? 0.3 : 0.22, () => doc.line(dx, dy, dx + dw, dy));
  }

  // ── Mini-en-têtes de bande ───────────────────────────────────────────────
  doc.setFont("courier", "normal");
  doc.setTextColor(palette.muted);
  doc.setFontSize(fontPt(9, m.k));
  for (const seg of card.segments) {
    const label = fitText(doc, seg.label.toUpperCase(), w - L(16));
    withOpacity(doc, 0.75, () =>
      doc.text(label, x + w / 2, Y(seg.y) + L(3), { align: "center" }),
    );
  }

  // ── Rangées ──────────────────────────────────────────────────────────────
  for (const port of card.ports) drawPortRow(doc, port, card, m, X, Y, L, palette);
  for (const row of card.panelRows) {
    drawPanelRow(doc, row, card, m, X, Y, L, palette);
  }
}

function drawHeader(
  doc: CardDoc,
  card: EquipmentCardDescriptor,
  x: number,
  y: number,
  w: number,
  m: Mapping,
  L: (v: number) => number,
  palette: CardPalette,
): void {
  const padX = L(CARD_METRICS.headerPadX);
  const inner = w - padX * 2;

  // Le bandeau centre son contenu verticalement (`justify-center` à l'écran) :
  // on empile les lignes, puis on centre la pile. Des décalages fixes auraient
  // décollé dès qu'une ligne manque — un panel n'a ni sous-titre ni badges.
  type Line = { h: number; draw: (top: number) => void };
  const lines: Line[] = [];
  const GAP = L(2);

  lines.push({
    h: L(13),
    draw: (top) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(palette.ink);
      doc.setFontSize(fontPt(12, m.k));
      doc.text(fitText(doc, card.title, inner), x + padX, top + L(10));
    },
  });

  const second = card.isPanel ? card.rowLabel : card.subtitle;
  if (second) {
    lines.push({
      h: L(10),
      draw: (top) => {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(palette.muted);
        doc.setFontSize(fontPt(9, m.k));
        doc.text(fitText(doc, second, inner), x + padX, top + L(7.5));
      },
    });
  }

  const chips: Array<{ text: string; color: string | null; tinted: boolean }> = [];
  if (card.container) {
    chips.push({ text: card.container.label, color: card.container.color, tinted: true });
  }
  for (const b of card.badges) chips.push({ text: b.text, color: b.color, tinted: false });

  if (chips.length > 0) {
    lines.push({
      h: L(12),
      draw: (top) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(fontPt(7, m.k));
        let cx = x + padX;
        const chipH = L(11);
        for (const chip of chips) {
          const label = chip.text.toUpperCase();
          const tw = doc.getTextWidth(label);
          const cw = tw + L(9);
          if (cx + cw > x + w - padX) break; // pas de débordement du bandeau
          const tint = chip.color ?? palette.muted;
          if (chip.tinted) {
            doc.setDrawColor(tint);
            doc.setLineWidth(Math.max(0.05, L(1)));
            withOpacity(doc, 0.45, () =>
              doc.roundedRect(cx, top, cw, chipH, L(2), L(2), "D"),
            );
          } else {
            doc.setFillColor(palette.badgeBg);
            doc.roundedRect(cx, top, cw, chipH, L(2), L(2), "F");
          }
          doc.setTextColor(chip.color ?? palette.muted);
          doc.text(label, cx + cw / 2, top + chipH / 2 + L(2.5), {
            align: "center",
          });
          cx += cw + L(6);
        }
      },
    });
  }

  const stackH =
    lines.reduce((s, l) => s + l.h, 0) + GAP * Math.max(0, lines.length - 1);
  let top = y + (L(CARD_METRICS.headerH) - stackH) / 2;
  for (const line of lines) {
    line.draw(top);
    top += line.h + GAP;
  }
}

function drawDot(
  doc: CardDoc,
  port: CardPort,
  X: (v: number) => number,
  Y: (v: number) => number,
  L: (v: number) => number,
): void {
  const cx = X(port.x);
  const cy = Y(port.y);
  const rad = L(CARD_METRICS.dotSize / 2);
  doc.setFillColor(port.color);
  // Pastille libre : même teinte, très diluée — c'est ce qui distingue d'un
  // coup d'œil un point câblé d'un point disponible.
  withOpacity(doc, port.filled ? 1 : 0.33, () => doc.circle(cx, cy, rad, "F"));
  doc.setDrawColor(port.color);
  doc.setLineWidth(Math.max(0.05, L(2)));
  doc.circle(cx, cy, rad, "D");
}

/** Flèche de direction, pointe vers l'intérieur ou l'extérieur de la carte. */
function drawArrow(
  doc: CardDoc,
  dir: PortDirection,
  side: "left" | "right",
  edgeX: number,
  cy: number,
  inward: number,
  L: (v: number) => number,
): void {
  const s = L(10);
  const half = s / 2;
  // Le motif est calé sur le bord de la carte, comme à l'écran : bord GAUCHE
  // de la flèche à `edgeX + 10` côté gauche, bord DROIT à `edgeX - 10` côté
  // droit. C'est ce décalage constant qui laisse la place à la pastille.
  const x0 = side === "left" ? edgeX + inward : edgeX - inward - s;
  const tri = (color: string, pointsRight: boolean, left: number, width: number) => {
    doc.setFillColor(color);
    if (pointsRight) {
      doc.triangle(left, cy - half, left + width, cy, left, cy + half, "F");
    } else {
      doc.triangle(left + width, cy - half, left, cy, left + width, cy + half, "F");
    }
  };
  if (dir === "BIDIR") {
    // Deux pointes opposées accolées, dans la MÊME largeur qu'une flèche
    // simple : rouge vers l'extérieur, vert vers l'intérieur.
    tri(DIR_IN, false, x0, half);
    tri(DIR_OUT, true, x0 + half, half);
    return;
  }
  const isIn = dir === "IN";
  const pointsRight = (side === "left" && isIn) || (side === "right" && !isIn);
  tri(isIn ? DIR_IN : DIR_OUT, pointsRight, x0, s);
}

function drawPortRow(
  doc: CardDoc,
  port: CardPort,
  card: EquipmentCardDescriptor,
  m: Mapping,
  X: (v: number) => number,
  Y: (v: number) => number,
  L: (v: number) => number,
  palette: CardPalette,
): void {
  drawDot(doc, port, X, Y, L);
  const cy = Y(port.y);
  const left = X(card.x);
  const right = X(card.x + card.w);
  if (port.direction) {
    drawArrow(
      doc,
      port.direction,
      port.side,
      port.side === "left" ? left : right,
      cy,
      L(10),
      L,
    );
  }
  doc.setFont("helvetica", "bold");
  doc.setTextColor(palette.ink);
  doc.setFontSize(fontPt(9, m.k));
  const pad = L(CARD_METRICS.portLabelPadX);
  const maxW = L(80);
  const label = fitText(doc, port.label, maxW);
  if (port.side === "left") {
    doc.text(label, left + pad, cy + L(3));
  } else {
    doc.text(label, right - pad, cy + L(3), { align: "right" });
  }
}

function drawPanelRow(
  doc: CardDoc,
  row: CardPanelRow,
  card: EquipmentCardDescriptor,
  m: Mapping,
  X: (v: number) => number,
  Y: (v: number) => number,
  L: (v: number) => number,
  palette: CardPalette,
): void {
  const cy = Y(row.y);
  const left = X(card.x);
  const right = X(card.x + card.w);
  const lineColor = row.active ? row.color : IDLE_LINE;

  doc.setDrawColor(lineColor);
  doc.setLineWidth(Math.max(0.05, L(row.active ? 2 : 1.5)));
  withOpacity(doc, row.active ? 0.7 : 1, () => doc.line(left, cy, right, cy));

  // Le libellé se pose SUR la traversée, avec un fond plein : à l'écran c'est
  // le fond de carte qui interrompt le trait, et le PDF n'hérite d'aucun
  // empilement — il faut le poser explicitement.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontPt(9, m.k));
  const label = fitText(doc, row.label, L(card.w - 24));
  const tw = doc.getTextWidth(label);
  const boxW = tw + L(8);
  const boxH = L(12);
  doc.setFillColor(palette.surface);
  doc.rect((left + right) / 2 - boxW / 2, cy - boxH / 2, boxW, boxH, "F");
  doc.setTextColor(row.active ? row.color : palette.muted);
  doc.text(label, (left + right) / 2, cy + L(3), { align: "center" });

  if (row.left) {
    drawDot(doc, row.left, X, Y, L);
    if (row.left.direction) {
      drawArrow(doc, row.left.direction, "left", left, cy, L(10), L);
    }
  }
  drawDot(doc, row.right, X, Y, L);
  if (row.right.direction) {
    drawArrow(doc, row.right.direction, "right", right, cy, L(10), L);
  }
}
