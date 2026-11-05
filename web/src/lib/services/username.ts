/**
 * Username : identifiant utilisateur pour login.
 * Format : 3-30 caractères, lowercase, alphanum + `.` `_` `-`.
 */
export const USERNAME_REGEX = /^[a-z0-9._-]{3,30}$/;

const MAX_LENGTH = 30;

/**
 * Génère un username candidat à partir du prénom et nom.
 * - Lowercase
 * - Retire les accents (NFD + remove diacritics)
 * - Remplace les espaces par `.`
 * - Retire tout caractère non `[a-z0-9._-]`
 * - Clamp à `MAX_LENGTH` caractères
 */
export function slugifyUsername(firstName: string, lastName: string): string {
  const stripDiacritics = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const part = (s: string) =>
    stripDiacritics(s)
      .toLowerCase()
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9._-]/g, "");

  const first = part(firstName);
  const last = part(lastName);
  if (!first && !last) return "";
  if (!first) return last.slice(0, MAX_LENGTH);
  if (!last) return first.slice(0, MAX_LENGTH);
  return `${first}.${last}`.slice(0, MAX_LENGTH);
}

/**
 * Trouve un username unique en suffixant `.2`, `.3`, … si déjà pris.
 * `existsCheck` est une fonction async (DB lookup côté API) qui retourne true si pris.
 */
export async function findUniqueUsername(
  base: string,
  existsCheck: (candidate: string) => Promise<boolean>,
  maxAttempts = 50,
): Promise<string> {
  if (!base) throw new Error("base username requis");
  if (!(await existsCheck(base))) return base;
  for (let i = 2; i <= maxAttempts; i++) {
    const suffix = `.${i}`;
    const candidate = base.slice(0, MAX_LENGTH - suffix.length) + suffix;
    if (!(await existsCheck(candidate))) return candidate;
  }
  throw new Error("Impossible de trouver un username unique après plusieurs tentatives");
}
