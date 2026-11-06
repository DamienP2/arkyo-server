/**
 * Capture DOM (html-to-image via CDN, chargement paresseux).
 *
 * But : exporter EXACTEMENT ce que l'utilisateur voit à l'écran (nodes HTML,
 * SVG cables/zones/labels, adapters…) sans avoir à re-dessiner chaque type
 * d'élément en Canvas manuel (approche historique de `lib/pdf/synoptic-export`
 * qui oublie régulièrement des éléments).
 *
 * ── Pourquoi on n'utilise PAS `toCanvas` de la bibliothèque ────────────────
 *
 * Dans html-to-image@1.11, `toCanvas` résout à l'intérieur d'un
 * `requestAnimationFrame`. Or un onglet masqué n'en déclenche aucun : la
 * promesse ne se résout alors JAMAIS, et tout l'export reste suspendu — sans
 * erreur, sans fin. Le `decode().then(…)` qui la précède est de surcroît
 * dépourvu de `.catch` : un décodage refusé (image très grande) fige de la
 * même manière, onglet visible ou non.
 *
 * On ne lui confie donc que la SÉRIALISATION (`toSvg`, robuste et rapide) et
 * on rasterise nous-mêmes : `new Image()` + `onload`/`onerror`, sans rAF ni
 * `decode`, avec un délai de garde. Tous les appelants en bénéficient.
 *
 * Options `hideSelectors` : permet à l'appelant de masquer temporairement des
 * sous-arbres (grille, repères, mini-map, règles…) le temps du capture puis de
 * les restaurer. Utile pour proposer des toggles "inclure grille/repères".
 */

// Chargement lazy de html-to-image depuis CDN (aucune devDep).
// html-to-image gère les fonctions CSS modernes (color(), oklch, color-mix) via
// un rendu SVG foreignObject — contrairement à html2canvas qui plante dessus.
type HtmlToImageModule = {
  toCanvas: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  toPng: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<string>;
  /** Sérialisation seule → data URL SVG. C'est la seule étape qu'on lui confie. */
  toSvg: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<string>;
};

let htmlToImagePromise: Promise<HtmlToImageModule> | null = null;

function loadHtmlToImage(): Promise<HtmlToImageModule> {
  if (htmlToImagePromise) return htmlToImagePromise;
  htmlToImagePromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR: no window"));
    const w = window as unknown as { htmlToImage?: HtmlToImageModule };
    if (w.htmlToImage) return resolve(w.htmlToImage);
    // arkyo-server: bundlé (hors ligne) : html-to-image 1.11.13 (version du CDN
    // d'arkyo) vient du paquet npm, chargé à la demande par `import()` à la
    // place de la balise <script> du CDN.
    import("html-to-image").then(
      (mod) => resolve(mod as unknown as HtmlToImageModule),
      () => reject(new Error("Failed to load html-to-image")),
    );
  });
  return htmlToImagePromise;
}

export type CaptureOptions = {
  /** Sélecteurs CSS à masquer temporairement pendant le capture. */
  hideSelectors?: string[];
  /** Ratio de pixel (2 = retina). Défaut : 2. */
  pixelRatio?: number;
  /** Fond du canvas (sinon transparent). */
  background?: string | null;
  /** Dimensions logiques forcées. Défaut : `offsetWidth`/`offsetHeight`. */
  width?: number;
  height?: number;
};

/** Au-delà, on considère l'image irrécupérable plutôt que d'attendre sans fin. */
const IMAGE_LOAD_TIMEOUT_MS = 60_000;

/**
 * Charge une data URL en `HTMLImageElement`.
 *
 * Volontairement minimal : `onload` / `onerror`, rien d'autre. Pas de
 * `requestAnimationFrame` — il ne se déclenche pas dans un onglet masqué — et
 * pas de `decode()`, dont le rejet sur une image très grande laisserait la
 * promesse en suspens. C'est exactement le piège qui figeait `toCanvas`.
 *
 * Un délai de garde borne malgré tout l'attente : aucun appelant ne doit
 * pouvoir rester bloqué indéfiniment sur une capture.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("Chargement de la capture interrompu (délai dépassé)."));
    }, IMAGE_LOAD_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Capture illisible (sérialisation invalide)."));
    };
    img.src = src;
  });
}

/**
 * Capture un élément DOM et retourne un canvas. L'appelant gère ensuite
 * la conversion (PNG blob, embed PDF, etc.).
 */
export async function captureElementToCanvas(
  el: HTMLElement,
  opts: CaptureOptions = {},
): Promise<HTMLCanvasElement> {
  const mod = await loadHtmlToImage();

  const hidden: HTMLElement[] = [];
  const prevDisplay: string[] = [];
  for (const sel of opts.hideSelectors ?? []) {
    const nodes = el.querySelectorAll<HTMLElement>(sel);
    nodes.forEach((n) => {
      hidden.push(n);
      prevDisplay.push(n.style.display);
      n.style.display = "none";
    });
  }
  try {
    // ── Sérialisation : confiée à la bibliothèque ────────────────────────
    // C'est l'étape dominante sur un grand plan (~5 s pour 4300 nœuds) :
    // html-to-image y appelle `getComputedStyle` sur chaque nœud et inline le
    // résultat. Coût inhérent à la taille du DOM, pas un défaut.
    const svgDataUrl = await mod.toSvg(el, {
      backgroundColor: opts.background ?? undefined,
      // `cacheBust` force le re-téléchargement de chaque image inlinée. Sur un
      // plan qui en porte beaucoup, c'est autant de requêtes sérialisées.
      cacheBust: true,
    });

    // ── Rasterisation : la NÔTRE ────────────────────────────────────────
    // `toCanvas` de html-to-image@1.11 ne peut pas être utilisé : sa
    // résolution passe par `requestAnimationFrame`, qui ne se déclenche JAMAIS
    // dans un onglet masqué — la promesse pend alors indéfiniment. Son
    // `decode().then(…)` est de surcroît sans `.catch`, donc un décodage refusé
    // (image très grande) fige tout aussi définitivement.
    //
    // On ne garde donc de la bibliothèque que la sérialisation, qui marche, et
    // on charge l'image nous-mêmes : `onload`/`onerror`, sans rAF ni `decode`.
    // Correction valable pour TOUS les appelants de cette fonction.
    const img = await loadImage(svgDataUrl);
    const width = opts.width ?? el.offsetWidth;
    const height = opts.height ?? el.offsetHeight;
    const ratio = opts.pixelRatio ?? 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D indisponible pour la capture.");
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    hidden.forEach((n, i) => {
      n.style.display = prevDisplay[i] ?? "";
    });
  }
}

/**
 * Encode un canvas en data URL PNG SANS bloquer le fil principal.
 *
 * `toDataURL` est synchrone : sur un canvas de plusieurs dizaines de mégapixels
 * il fige l'onglet plusieurs secondes, sans curseur d'attente ni repeinte —
 * l'utilisateur croit à un plantage. `toBlob` confie l'encodage au navigateur,
 * qui le sort du fil, et `FileReader` fait de même pour la conversion base64.
 *
 * Le PNG reste le format : le plan est du trait et du texte, un JPEG y sèmerait
 * des artefacts de blocs sur chaque filet.
 */
export function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Encodage PNG échoué."));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Lecture de la capture échouée."));
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

/** Télécharge un canvas en PNG (file save). */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
}
