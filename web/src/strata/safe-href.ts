/**
 * Lien d'un document saisi ou importé (fiche du catalogue, documents du
 * projet) : seules les adresses sûres deviennent des liens. Toute autre
 * adresse (`javascript:`, `data:`, schéma inconnu, `//hôte`) reste du texte.
 *
 * Acceptés : `http(s)://`, `mailto:`, et les chemins du site (`/uploads/…`).
 */
export function safeDocumentHref(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  // Les navigateurs retirent tabulations et retours à la ligne d'une URL
  // (`/\t/hôte` devient `//hôte`) : une adresse qui en contient reste du texte.
  if (/[\t\r\n]/.test(u)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  // Chemin du site : une seule barre en tête (ni `//hôte`, ni `/\hôte`).
  if (/^\/(?![/\\])/.test(u)) return u;
  return null;
}
