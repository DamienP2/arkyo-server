import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Nom lisible → segment de nom de fichier : accents retirés, séparateurs
 * réduits à `-`, longueur bornée. La CASSE est conservée (« Roland-Garros-2026 »)
 * — un nom de fichier reste un libellé, pas un identifiant technique.
 *
 * Partagé par tous les exports qui nomment leurs fichiers d'après le projet,
 * pour que `Inventaire_X_2026-01-01` et `Racks_X_2026-01-01` portent
 * exactement le même segment.
 */
export function slugifyName(name: string): string {
  const slug = name
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "Projet";
}
