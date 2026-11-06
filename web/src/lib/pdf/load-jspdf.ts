/**
 * Chargement de jsPDF depuis le CDN, mutualisé.
 *
 * Isolé dans son propre module pour deux raisons :
 *  - svg2pdf se greffe sur le prototype de jsPDF et exige donc qu'il soit là
 *    AVANT lui ;
 *  - le modal d'export peut PRÉCHAUFFER les deux à son ouverture, pour que le
 *    clic sur « Télécharger » ne paie pas la latence réseau. Une génération qui
 *    commence par attendre un CDN donne l'impression d'une interface figée
 *    alors que rien n'a encore commencé.
 */

// arkyo-server: bundlé (hors ligne) : jsPDF 2.5.1 (version du CDN d'arkyo) vient
// du paquet npm `jspdf`, chargé à la demande par `import()` ; plus d'URL de CDN.

/**
 * Options communes à TOUT document jsPDF de l'application. À étaler dans
 * chaque `new jsPDF({ ...JSPDF_BASE, … })`.
 *
 * ── Pourquoi `compress` n'est pas négociable ──────────────────────────────
 * Par défaut, jsPDF écrit les flux SANS filtre (`/Filter None`) : une image
 * PNG y est stockée **décodée**, octet par octet. Un calque de cartouche A3 à
 * 300 dpi (4961 × 3508) pèse alors exactement 4961 × 3508 × 3 = 52 Mo dans le
 * PDF — pour du trait noir sur fond transparent. Le même flux dégonflé fait
 * 1 à 3 Mo.
 *
 * Ce n'est donc pas un réglage de confort : c'est la différence entre un
 * dossier transmissible et un dossier de 77 Mo. Le coût est un deflate en JS
 * à la génération, payé une fois.
 *
 * La constante existe pour que la décision vive à UN endroit : elle a dû être
 * prise sur douze sites de construction, et le treizième l'aurait oubliée.
 */
export const JSPDF_BASE = { compress: true } as const;

let jsPdfPromise: Promise<void> | null = null;

export function ensureJsPdf(): Promise<void> {
  if (jsPdfPromise) return jsPdfPromise;
  jsPdfPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR: no window"));
    const w = window as unknown as { jspdf?: unknown };
    if (w.jspdf) return resolve();
    // arkyo-server: bundlé (hors ligne) : `import()` du paquet à la place de la
    // balise <script> ; `window.jspdf` reste le point d'accès des appelants,
    // comme avec le build UMD du CDN.
    import("jspdf").then(
      (mod) => {
        w.jspdf = mod;
        resolve();
      },
      () => reject(new Error("Chargement de jsPDF impossible.")),
    );
  }).catch((e) => {
    // Un CDN indisponible une fois ne doit pas condamner la session.
    jsPdfPromise = null;
    throw e;
  });
  return jsPdfPromise;
}
