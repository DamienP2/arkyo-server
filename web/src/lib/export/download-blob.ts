/**
 * Téléchargement d'un blob — avec la SEULE subtilité qui compte : le moment de
 * la révocation.
 *
 * ── Le piège ──────────────────────────────────────────────────────────────
 * Le motif naïf est partout :
 *
 *     const url = URL.createObjectURL(blob);
 *     a.href = url; a.click();
 *     URL.revokeObjectURL(url);        // ← dans le MÊME tour de boucle
 *
 * `a.click()` ne télécharge pas : il DEMANDE au navigateur de télécharger.
 * La récupération du blob se fait ensuite, de façon asynchrone. Révoquer
 * l'URL dans la foulée invalide la ressource avant qu'elle ne soit lue, et le
 * téléchargement est abandonné — sans erreur, sans trace, sans rien.
 *
 * Le défaut est INVISIBLE sur les petits fichiers : une liste de 20 Ko gagne
 * la course, la révocation arrive trop tard pour lui nuire. Un dossier de
 * plusieurs mégaoctets la perd. C'est exactement ce qui faisait qu'un export
 * unitaire arrivait et qu'un dossier complet ne sortait jamais, alors que la
 * génération avait parfaitement réussi.
 *
 * On diffère donc la révocation. La mémoire d'une URL d'objet est retenue
 * jusque-là ; c'est un coût transitoire assumé, sans commune mesure avec un
 * export qui disparaît en silence.
 */

/**
 * Délai avant révocation. Large à dessein : il doit couvrir l'écriture sur
 * disque d'un gros document sur une machine chargée, pas seulement le temps
 * de démarrage du téléchargement.
 */
const REVOKE_DELAY_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
