import React from "react";

/**
 * ConnectorIcon — bibliothèque de symboles connecteurs (49 connecteurs).
 *
 * Refonte 2026-07-05 (spec docs/superpowers/specs/2026-07-05-connector-symbols-design.md) :
 * chaque connecteur a UNE représentation « vue de face » figée, choisie
 * variante par variante par l'admin sur la page de sélection :
 *  - style « épuré »    (trait moyen, détails min)  — majorité des connecteurs
 *  - style « classique » (contour épais + détails)  — xlr3, schuko, cee16/32
 *  - style « contrasté » (broches remplies)         — multipins denses (dsub,
 *    dvi, rj45, socapex, harting, euroblock, microhdmi, microusb)
 *
 * `dType` rend le connecteur dans une coque Neutrik D minimale (carré arrondi
 * + 2 vis torx en diagonale) — composition à la volée, valable pour tout id.
 *
 * Le SVG est généré en chaînes (primitives partagées, viewBox 0 0 100 100,
 * tout en currentColor) et injecté via dangerouslySetInnerHTML : contenu
 * 100 % constant construit localement, aucune entrée utilisateur.
 *
 * Compat : les anciens ids restent valides via LEGACY_ALIASES (vga→dsub,
 * displayport→dp, cee→cee16, jack635ts→jack635, phoenix→euroblock…) — aucune
 * migration DB/seed nécessaire. Un iconId inconnu retombe sur bnc ; une URL
 * (`/uploads/…` ou http) est rendue en <img> comme avant.
 */

type Props = {
  iconId: string;
  color?: string;
  size?: number;
  className?: string;
  /** Rend le connecteur monté dans une coque Neutrik D (carré + vis torx). */
  dType?: boolean;
  /** Ignore un éventuel override admin — rend toujours le dessin intégré
   *  (ex. aperçu « rétablir » dans l'éditeur de symboles). */
  ignoreOverride?: boolean;
};

// Liste des icônes intégrées disponibles (alimente les pickers d'icônes)
export const BUILTIN_CONNECTOR_ICONS: { id: string; label: string }[] = [
  { id: "bnc", label: "BNC" },
  { id: "microbnc", label: "Micro-BNC (HD-BNC)" },
  { id: "din102", label: "DIN 1.0/2.3" },
  { id: "triax", label: "Triax" },
  { id: "smpte", label: "SMPTE 311M" },
  { id: "f", label: "Fiche F" },
  { id: "n", label: "Fiche N" },
  { id: "sma", label: "SMA" },
  { id: "rca", label: "RCA" },
  { id: "hdmi", label: "HDMI" },
  { id: "microhdmi", label: "Micro-HDMI" },
  { id: "dp", label: "DisplayPort" },
  { id: "minidp", label: "Mini-DisplayPort" },
  { id: "dvi", label: "DVI" },
  { id: "dsub", label: "D-sub (VGA/DB9/DB25)" },
  { id: "xlr3", label: "XLR 3" },
  { id: "xlr4", label: "XLR 4" },
  { id: "xlr5", label: "XLR 5" },
  { id: "minixlr", label: "Mini-XLR" },
  { id: "jack635", label: "Jack 6.35" },
  { id: "jack35", label: "Mini-jack 3.5" },
  { id: "bantam", label: "Bantam TT" },
  { id: "speakon", label: "speakON" },
  { id: "din5", label: "DIN 5 (MIDI)" },
  { id: "euroblock", label: "Euroblock" },
  { id: "toslink", label: "TOSLINK" },
  { id: "rj45", label: "RJ45" },
  { id: "usba", label: "USB-A" },
  { id: "usbb", label: "USB-B" },
  { id: "usbc", label: "USB-C" },
  { id: "microusb", label: "Micro-USB" },
  { id: "sfp", label: "SFP" },
  { id: "lc", label: "LC" },
  { id: "sc", label: "SC" },
  { id: "st", label: "ST" },
  { id: "mtp", label: "MPO/MTP" },
  { id: "powercon", label: "powerCON" },
  { id: "true1", label: "powerCON TRUE1" },
  { id: "iec13", label: "IEC C13" },
  { id: "iec19", label: "IEC C19" },
  { id: "schuko", label: "Schuko" },
  { id: "cee16", label: "CEE P17 mono" },
  { id: "cee32", label: "CEE P17 tri" },
  { id: "socapex", label: "Socapex" },
  { id: "harting", label: "Harting" },
  { id: "gst18", label: "Wieland GST18" },
  { id: "camlock", label: "Camlock/Powerlock" },
  { id: "lemo", label: "Lemo" },
  { id: "hirose", label: "Hirose HR10" },
];

/**
 * Connecteurs builtin attestés en version Neutrik D (choix validés lors de la
 * refonte — cf. spec). Pour ces clés, la version D est rendue par le code
 * (`dType`) ; les autres builtin n'existent qu'en générique.
 */
export const D_TYPE_KEYS = new Set([
  "xlr3", "xlr4", "xlr5", "rj45", "powercon", "true1", "speakon", "bnc",
  "rca", "jack635", "jack35", "usba", "usbb", "usbc", "hdmi", "lc",
  "din5", "toslink",
]);

/** Anciens ids → nouveaux (compat DB/seed, aucune migration). */
const LEGACY_ALIASES: Record<string, string> = {
  jack635ts: "jack635",
  displayport: "dp",
  vga: "dsub",
  db9: "dsub",
  db15: "dsub",
  db25: "dsub",
  cee: "cee16",
  powercontrue1: "true1",
  phoenix: "euroblock",
  neutrikd: "bnc", // ancien pictogramme D générique — le rendu D passe par `dType`
};

// ─── Primitives SVG (chaînes, viewBox 0 0 100 100, currentColor) ─────────────

type P = { sw: number; det: boolean; fill: boolean };

const S = 'stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const ring = (cx: number, cy: number, r: number, sw: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" ${S} stroke-width="${sw}"/>`;
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, sw: number) => {
  const pt = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" ${S} stroke-width="${sw}"/>`;
};
const dot = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
const pin = (cx: number, cy: number, r: number, p: P) => (p.fill ? dot(cx, cy, r) : ring(cx, cy, r, p.sw * 0.75));
const seg = (x1: number, y1: number, x2: number, y2: number, sw: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${S} stroke-width="${sw}"/>`;
const rrect = (x: number, y: number, w: number, h: number, rx: number, sw: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${S} stroke-width="${sw}"/>`;
const pth = (d: string, sw: number) => `<path d="${d}" ${S} stroke-width="${sw}"/>`;
const grp = (inner: string, scale: number, tx = 0, ty = 0) =>
  `<g transform="translate(${50 + tx} ${50 + ty}) scale(${scale}) translate(-50 -50)">${inner}</g>`;
const hexa = (cx: number, cy: number, r: number, sw: number) => {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    d += (i ? "L" : "M") + (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1) + " ";
  }
  return pth(d + "Z", sw);
};

// ─── Faces (géométrie vue de face, paramétrée par le style) ──────────────────

const FACES: Record<string, (p: P) => string> = {
  bnc: (p) =>
    ring(50, 50, 34, p.sw) +
    seg(8, 50, 16, 50, p.sw) +
    seg(84, 50, 92, 50, p.sw) +
    ring(50, 50, 15, p.sw * 0.85) +
    pin(50, 50, 4.5, p) +
    (p.det ? seg(50, 10, 50, 16, p.sw * 0.7) + seg(50, 84, 50, 90, p.sw * 0.7) : ""),

  microbnc: (p) =>
    rrect(22, 22, 56, 56, 10, p.sw) +
    ring(50, 50, 17, p.sw * 0.9) +
    pin(50, 50, 3.5, p) +
    (p.det ? seg(50, 14, 50, 22, p.sw * 0.7) + seg(50, 78, 50, 86, p.sw * 0.7) : ""),

  din102: (p) =>
    arc(50, 50, 30, -55, 235, p.sw) +
    seg(33, 25, 40, 33, p.sw * 0.9) +
    seg(67, 25, 60, 33, p.sw * 0.9) +
    ring(50, 50, 12, p.sw * 0.8) +
    pin(50, 50, 3.5, p),

  triax: (p) =>
    ring(50, 50, 34, p.sw) +
    seg(8, 50, 16, 50, p.sw) +
    seg(84, 50, 92, 50, p.sw) +
    ring(50, 50, 22, p.sw * 0.8) +
    ring(50, 50, 11, p.sw * 0.8) +
    pin(50, 50, 3.5, p),

  smpte: (p) =>
    ring(50, 50, 36, p.sw) +
    (p.det ? ring(50, 50, 28, p.sw * 0.6) : "") +
    pth("M 44 14 L 44 20 M 56 14 L 56 20", p.sw * 0.8) +
    ring(38, 44, 7, p.sw * 0.85) +
    ring(62, 44, 7, p.sw * 0.85) +
    pin(38, 44, 2.2, p) +
    pin(62, 44, 2.2, p) +
    pin(36, 64, 3, p) +
    pin(50, 68, 3, p) +
    pin(64, 64, 3, p),

  f: (p) => hexa(50, 50, 37, p.sw) + ring(50, 50, 20, p.sw * 0.85) + pin(50, 50, 4, p),

  n: (p) =>
    ring(50, 50, 35, p.sw) +
    (p.det
      ? `<circle cx="50" cy="50" r="29" ${S} stroke-width="${p.sw * 0.6}" stroke-dasharray="4 4"/>`
      : "") +
    ring(50, 50, 16, p.sw * 0.85) +
    pin(50, 50, 4.5, p),

  sma: (p) => hexa(50, 50, 32, p.sw) + ring(50, 50, 13, p.sw * 0.85) + pin(50, 50, 3, p),

  rca: (p) =>
    ring(50, 50, 34, p.sw) +
    ring(50, 50, 20, p.sw * 1.5) +
    pin(50, 50, 7, p) +
    (p.det ? seg(50, 84, 50, 92, p.sw * 0.8) : ""),

  hdmi: (p) =>
    pth("M 14 37 L 86 37 L 86 52 L 75 63 L 25 63 L 14 52 Z", p.sw) +
    pth("M 22 44 L 78 44 L 78 50 L 71 56 L 29 56 L 22 50 Z", p.sw * 0.65) +
    (p.det ? seg(32, 50, 68, 50, p.sw * 0.5) : ""),

  microhdmi: (p) =>
    pth("M 20 42 L 80 42 L 80 51 L 73 58 L 27 58 L 20 51 Z", p.sw) +
    (p.det ? pth("M 27 47 L 73 47 L 73 50 L 69 54 L 31 54 L 27 50 Z", p.sw * 0.55) : ""),

  dp: (p) =>
    pth("M 18 36 L 84 36 L 84 64 L 32 64 L 16 50 L 16 38 Q 16 36 18 36 Z", p.sw) +
    pth("M 24 44 L 76 44 L 76 56 L 34 56 L 24 47 Z", p.sw * 0.6),

  minidp: (p) => rrect(24, 38, 52, 24, 6, p.sw) + rrect(31, 45, 38, 10, 3, p.sw * 0.6),

  dvi: (p) => {
    let pins = "";
    if (p.det) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) pins += pin(28 + c * 7, 42 + r * 8, 1.7, p);
    } else {
      for (let c = 0; c < 3; c++) pins += pin(31 + c * 11, 50, 2, p);
    }
    return (
      rrect(16, 33, 68, 34, 3, p.sw) +
      pins +
      seg(72, 40, 72, 60, p.sw * 0.7) +
      pin(78, 45, 1.6, p) +
      pin(78, 55, 1.6, p)
    );
  },

  dsub: (p) => {
    let pins = "";
    if (p.det) {
      for (let c = 0; c < 5; c++) pins += pin(32 + c * 9, 45, 2, p);
      for (let c = 0; c < 4; c++) pins += pin(36.5 + c * 9, 55, 2, p);
    } else {
      pins = pin(38, 50, 2.4, p) + pin(50, 50, 2.4, p) + pin(62, 50, 2.4, p);
    }
    return (
      pth(
        "M 24 38 L 76 38 Q 80 38 79 42 L 75 58 Q 74 62 70 62 L 30 62 Q 26 62 25 58 L 21 42 Q 20 38 24 38 Z",
        p.sw,
      ) +
      ring(11, 50, 4, p.sw * 0.7) +
      ring(89, 50, 4, p.sw * 0.7) +
      pins
    );
  },

  xlr3: (p) =>
    ring(50, 50, 36, p.sw) +
    (p.det ? ring(50, 50, 29, p.sw * 0.6) : "") +
    pth("M 45 14 L 45 20 L 55 20 L 55 14", p.sw * 0.8) +
    pin(36, 44, 5, p) +
    pin(64, 44, 5, p) +
    pin(50, 64, 5, p),

  xlr4: (p) =>
    ring(50, 50, 36, p.sw) +
    (p.det ? ring(50, 50, 29, p.sw * 0.6) : "") +
    pth("M 45 14 L 45 20 L 55 20 L 55 14", p.sw * 0.8) +
    pin(37, 41, 4.6, p) +
    pin(63, 41, 4.6, p) +
    pin(37, 63, 4.6, p) +
    pin(63, 63, 4.6, p),

  xlr5: (p) =>
    ring(50, 50, 36, p.sw) +
    (p.det ? ring(50, 50, 29, p.sw * 0.6) : "") +
    pth("M 45 14 L 45 20 L 55 20 L 55 14", p.sw * 0.8) +
    pin(32, 50, 4.2, p) +
    pin(39, 34, 4.2, p) +
    pin(61, 34, 4.2, p) +
    pin(68, 50, 4.2, p) +
    pin(50, 63, 4.2, p),

  minixlr: (p) =>
    ring(50, 50, 29, p.sw) +
    pth("M 46 21 L 46 26 L 54 26 L 54 21", p.sw * 0.7) +
    pin(39, 46, 3.8, p) +
    pin(61, 46, 3.8, p) +
    pin(50, 61, 3.8, p),

  jack635: (p) =>
    ring(50, 50, 34, p.sw) + ring(50, 50, 19, p.sw * 0.85) + ring(50, 50, 9, p.sw * 0.75) + pin(50, 50, 2.5, p),

  jack35: (p) => ring(50, 50, 27, p.sw) + ring(50, 50, 13, p.sw * 0.8) + pin(50, 50, 3, p),

  bantam: (p) =>
    ring(50, 50, 23, p.sw) +
    ring(50, 50, 10, p.sw * 0.75) +
    pin(50, 50, 2.2, p) +
    (p.det ? ring(50, 50, 31, p.sw * 0.55) : ""),

  speakon: (p) =>
    ring(50, 50, 36, p.sw) +
    pth("M 45 14 L 45 21 L 55 21 L 55 14", p.sw * 0.8) +
    arc(50, 50, 20, 210, 255, p.sw * 1.25) +
    arc(50, 50, 20, 285, 330, p.sw * 1.25) +
    arc(50, 50, 20, 30, 75, p.sw * 1.25) +
    arc(50, 50, 20, 105, 150, p.sw * 1.25) +
    pin(50, 50, 4, p),

  din5: (p) =>
    ring(50, 50, 34, p.sw) +
    pin(30, 52, 3.6, p) +
    pin(37, 38, 3.6, p) +
    pin(50, 32, 3.6, p) +
    pin(63, 38, 3.6, p) +
    pin(70, 52, 3.6, p) +
    pth("M 43 84 L 43 76 L 57 76 L 57 84", p.sw * 0.8),

  euroblock: (p) => {
    let holes = "";
    for (let c = 0; c < 4; c++) holes += rrect(25 + c * 14, 46, 9, 9, 1.5, p.sw * 0.7);
    let screws = "";
    if (p.det) for (let c = 0; c < 4; c++) screws += ring(29.5 + c * 14, 38, 2.6, p.sw * 0.55);
    return rrect(18, 30, 64, 40, 4, p.sw) + holes + screws;
  },

  toslink: (p) =>
    pth("M 30 32 L 70 32 L 70 58 L 61 68 L 39 68 L 30 58 Z", p.sw) +
    ring(50, 50, 7, p.sw * 0.8) +
    (p.fill ? dot(50, 50, 3) : ""),

  rj45: (p) => {
    let contacts = "";
    if (p.det) for (let c = 0; c < 8; c++) contacts += seg(33 + c * 5, 34, 33 + c * 5, 40, p.sw * 0.5);
    return (
      pth(
        "M 28 30 L 72 30 L 72 58 L 63 58 L 63 65 L 56 65 L 56 70 L 44 70 L 44 65 L 37 65 L 37 58 L 28 58 Z",
        p.sw,
      ) + contacts
    );
  },

  usba: (p) =>
    rrect(17, 37, 66, 26, 3, p.sw) +
    rrect(23, 43, 54, 9, 1.5, p.sw * 0.65) +
    (p.det ? seg(32, 57, 68, 57, p.sw * 0.5) : ""),

  usbb: (p) =>
    pth("M 28 36 L 36 27 L 64 27 L 72 36 L 72 71 L 28 71 Z", p.sw) + rrect(38, 38, 24, 14, 2, p.sw * 0.65),

  usbc: (p) => rrect(15, 39, 70, 22, 11, p.sw) + rrect(23, 45, 54, 10, 5, p.sw * 0.65),

  microusb: (p) =>
    pth("M 23 42 L 77 42 L 77 47 L 71 58 L 29 58 L 23 47 Z", p.sw) +
    (p.det ? pth("M 30 47 L 70 47 L 66 53 L 34 53 Z", p.sw * 0.55) : ""),

  sfp: (p) =>
    rrect(15, 36, 70, 28, 2.5, p.sw) +
    seg(15, 52, 85, 52, p.sw * 0.6) +
    rrect(30, 55, 40, 5, 1, p.sw * 0.55) +
    (p.det ? arc(20, 42, 5, 90, 270, p.sw * 0.7) : ""),

  lc: (p) =>
    rrect(28, 32, 18, 38, 3, p.sw) +
    rrect(54, 32, 18, 38, 3, p.sw) +
    ring(37, 47, 4, p.sw * 0.7) +
    ring(63, 47, 4, p.sw * 0.7) +
    pin(37, 47, 1.3, p) +
    pin(63, 47, 1.3, p) +
    (p.det ? seg(33, 26, 41, 26, p.sw * 0.8) + seg(59, 26, 67, 26, p.sw * 0.8) : ""),

  sc: (p) =>
    rrect(23, 33, 24, 36, 2.5, p.sw) +
    rrect(53, 33, 24, 36, 2.5, p.sw) +
    ring(35, 49, 5, p.sw * 0.7) +
    ring(65, 49, 5, p.sw * 0.7) +
    pin(35, 49, 1.5, p) +
    pin(65, 49, 1.5, p),

  st: (p) =>
    ring(50, 50, 32, p.sw) +
    seg(11, 50, 18, 50, p.sw) +
    seg(82, 50, 89, 50, p.sw) +
    ring(50, 50, 9, p.sw * 0.8) +
    pin(50, 50, 2.5, p),

  mtp: (p) => {
    let fibres = "";
    const n = p.det ? 8 : 4;
    const step = p.det ? 6 : 12;
    const x0 = 50 - ((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) fibres += pin(x0 + i * step, 50, 1.6, p);
    return rrect(17, 38, 66, 24, 3, p.sw) + pth("M 45 38 L 50 32 L 55 38", p.sw * 0.8) + fibres;
  },

  powercon: (p) =>
    ring(50, 50, 36, p.sw) +
    pth("M 45 14 L 45 21 L 55 21 L 55 14", p.sw * 0.8) +
    arc(50, 50, 15, -50, 230, p.sw * 1.5) +
    dot(60, 39, 3),

  true1: (p) =>
    rrect(17, 17, 66, 66, 15, p.sw) +
    ring(50, 50, 22, p.sw * 0.85) +
    pth("M 45 17 L 45 23 L 55 23 L 55 17", p.sw * 0.75) +
    pin(41, 45, 3.4, p) +
    pin(59, 45, 3.4, p) +
    pin(50, 60, 3.4, p),

  iec13: (p) =>
    pth("M 24 37 L 76 37 L 85 50 L 76 63 L 24 63 L 15 50 Z", p.sw) +
    rrect(32, 44, 5, 12, 1.5, p.sw * 0.7) +
    rrect(47.5, 44, 5, 12, 1.5, p.sw * 0.7) +
    rrect(63, 44, 5, 12, 1.5, p.sw * 0.7),

  iec19: (p) =>
    rrect(19, 33, 62, 34, 4, p.sw) +
    rrect(28, 40, 14, 5, 1.5, p.sw * 0.7) +
    rrect(58, 40, 14, 5, 1.5, p.sw * 0.7) +
    rrect(43, 55, 14, 5, 1.5, p.sw * 0.7),

  schuko: (p) =>
    ring(50, 50, 35, p.sw) +
    pin(37, 50, 5, p) +
    pin(63, 50, 5, p) +
    pth("M 44 16 L 44 22 L 56 22 L 56 16", p.sw * 0.8) +
    pth("M 44 84 L 44 78 L 56 78 L 56 84", p.sw * 0.8),

  cee16: (p) =>
    ring(50, 50, 34, p.sw) +
    (p.det ? ring(50, 50, 27, p.sw * 0.55) : "") +
    pin(38, 44, 4, p) +
    pin(62, 44, 4, p) +
    pin(50, 63, 4.6, p) +
    seg(50, 80, 50, 86, p.sw * 0.9),

  cee32: (p) =>
    ring(50, 50, 34, p.sw) +
    (p.det ? ring(50, 50, 27, p.sw * 0.55) : "") +
    pin(50, 32, 3.8, p) +
    pin(66, 44, 3.8, p) +
    pin(60, 62, 3.8, p) +
    pin(40, 62, 3.8, p) +
    pin(34, 44, 3.8, p) +
    seg(50, 80, 50, 86, p.sw * 0.9),

  socapex: (p) => {
    let pins = pin(50, 50, 3, p);
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 * Math.PI) / 180;
      pins += pin(50 + 12 * Math.cos(a), 50 + 12 * Math.sin(a), 3, p);
    }
    if (p.det) {
      for (let i = 0; i < 12; i++) {
        const a = ((i * 30 + 15) * Math.PI) / 180;
        pins += pin(50 + 23 * Math.cos(a), 50 + 23 * Math.sin(a), 2.6, p);
      }
    }
    return (
      ring(50, 50, 37, p.sw) +
      (p.det ? ring(50, 50, 30.5, p.sw * 0.5) : "") +
      pins +
      seg(50, 13, 50, 19, p.sw * 0.8)
    );
  },

  harting: (p) => {
    let pins = "";
    if (p.det) {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) pins += pin(30 + c * 10, 44 + r * 13, 2.2, p);
    } else {
      for (let c = 0; c < 3; c++) pins += pin(36 + c * 14, 50, 2.6, p);
    }
    return (
      rrect(20, 30, 60, 40, 5, p.sw) +
      pth("M 14 38 L 10 42 L 10 58 L 14 62", p.sw * 0.9) +
      pth("M 86 38 L 90 42 L 90 58 L 86 62", p.sw * 0.9) +
      pins
    );
  },

  gst18: (p) =>
    pth("M 20 40 L 80 40 L 74 61 L 26 61 Z", p.sw) +
    rrect(33, 46, 5, 9, 1.5, p.sw * 0.7) +
    rrect(47.5, 46, 5, 9, 1.5, p.sw * 0.7) +
    rrect(62, 46, 5, 9, 1.5, p.sw * 0.7),

  camlock: (p) =>
    ring(50, 50, 35, p.sw) +
    arc(50, 50, 16, -35, 215, p.sw * 1.5) +
    dot(61, 40, 3.2) +
    (p.det ? seg(50, 12, 50, 18, p.sw * 0.8) : ""),

  lemo: (p) =>
    ring(50, 50, 33, p.sw) +
    `<circle cx="50" cy="50" r="27" ${S} stroke-width="${p.sw * 0.6}" stroke-dasharray="3.5 3.5"/>` +
    seg(50, 17, 50, 25, p.sw * 0.9) +
    pin(41, 52, 4, p) +
    pin(59, 52, 4, p),

  hirose: (p) =>
    ring(50, 50, 28, p.sw) +
    seg(50, 22, 50, 28, p.sw * 0.8) +
    pin(41, 44, 3.2, p) +
    pin(59, 44, 3.2, p) +
    pin(41, 60, 3.2, p) +
    pin(59, 60, 3.2, p),
};

// ─── Styles figés (choix validés par connecteur) ─────────────────────────────

const STYLE_A: P = { sw: 2.6, det: false, fill: false }; // épuré (défaut)
const STYLE_B: P = { sw: 4.2, det: true, fill: false }; // classique
const STYLE_D: P = { sw: 3.6, det: true, fill: true }; // contrasté

const STYLE_OVERRIDES: Record<string, P> = {
  xlr3: STYLE_B,
  schuko: STYLE_B,
  cee16: STYLE_B,
  cee32: STYLE_B,
  microhdmi: STYLE_D,
  dvi: STYLE_D,
  dsub: STYLE_D,
  euroblock: STYLE_D,
  microusb: STYLE_D,
  rj45: STYLE_D,
  socapex: STYLE_D,
  harting: STYLE_D,
};

// ─── Coque Neutrik D (variante « minimale » choisie, uniforme) ───────────────

const D_SHELL =
  rrect(11, 7, 78, 86, 12, 2.4) + ring(24, 21, 3.4, 1.8) + ring(76, 79, 3.4, 1.8);
const D_FACE_STYLE: P = { sw: 2.8, det: false, fill: false };

// ─── Overrides (SVG uploadés remplaçant le rendu code d'un builtin) ──────────
//
// Store module-level + useSyncExternalStore : chargé une fois par session
// navigateur depuis /api/symbol-overrides (échec → map vide, rendu code).
// `refreshSymbolOverrides()` force un rechargement (appelé après édition d'un
// symbole dans le panneau superviseur). Jamais exécuté côté serveur.

type SymbolOverride = { svg: string | null; svgD: string | null };
let symbolOverrides: Record<string, SymbolOverride> = {};
let overridesFetched = false;
const overrideListeners = new Set<() => void>();

function fetchOverrides() {
  void fetch("/api/symbol-overrides")
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: unknown) => {
      symbolOverrides =
        data && typeof data === "object" ? (data as Record<string, SymbolOverride>) : {};
      overrideListeners.forEach((l) => l());
    })
    .catch(() => {
      /* pas de session / réseau — rendu code */
    });
}

function subscribeOverrides(cb: () => void) {
  overrideListeners.add(cb);
  if (!overridesFetched && typeof window !== "undefined") {
    overridesFetched = true;
    fetchOverrides();
  }
  return () => {
    overrideListeners.delete(cb);
  };
}
const getOverridesSnapshot = () => symbolOverrides;

/** Recharge les overrides (à appeler après création/édition d'un symbole). */
export function refreshSymbolOverrides() {
  if (typeof window === "undefined") return;
  overridesFetched = true;
  fetchOverrides();
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function ConnectorIcon({
  iconId,
  color = "#3b82f6",
  size = 32,
  className,
  dType,
  ignoreOverride,
}: Props) {
  const overrides = React.useSyncExternalStore(
    subscribeOverrides,
    getOverridesSnapshot,
    getOverridesSnapshot,
  );
  // URL custom (logo uploadé) : rendu <img> comme avant.
  if (!(iconId in FACES) && !(iconId in LEGACY_ALIASES) && (iconId.startsWith("/") || iconId.startsWith("http"))) {
    return (
      <img
        src={iconId}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain" }}
      />
    );
  }

  const resolved = LEGACY_ALIASES[iconId] ?? iconId;

  // Override admin : un SVG uploadé remplace le rendu code du builtin
  // (générique et/ou version D), partout dans l'app.
  const ov = ignoreOverride ? undefined : overrides[resolved];
  const ovUrl = dType ? ov?.svgD : ov?.svg;
  if (ovUrl) {
    return (
      <img
        src={ovUrl}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain" }}
      />
    );
  }

  const face = FACES[resolved] ?? FACES.bnc;
  const inner = dType
    ? D_SHELL + grp(face(D_FACE_STYLE), 0.6)
    : face(STYLE_OVERRIDES[resolved] ?? STYLE_A);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ color }}
      aria-hidden
      // Contenu 100 % constant généré par les primitives locales ci-dessus.
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
