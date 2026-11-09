/**
 * Navigation de l'interface Strata v2 (spec v2 §4.3) : trois onglets dans la
 * topbar, `Projets` · `Catalogue` · `Administration ▾`, sans barre latérale.
 *
 * Chaque entrée du rail Classique (`components/layout/sidebar.tsx`) a ici sa
 * place, avec la même route et la même permission (`topbar-v2.test.tsx` le
 * vérifie) :
 *   - Projets : l'onglet mène à `/dashboard` (page Projets) ; Prestation et
 *     Intégration sont les filtres de cette page (`filter`) ;
 *   - Catalogue : le catalogue et les modèles (spec v2 §7, « Catalogue ›
 *     Modèles »), dans la navigation de section de la topbar ;
 *   - Administration : le menu de l'onglet.
 */

import type { ComponentType, CSSProperties } from "react";
import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";
import {
  Antenna,
  Building2,
  Cpu,
  FileStack,
  Folder,
  Gauge,
  LayoutPanelTop,
  Lockers,
  Package,
  Settings,
  Users,
  Wrench,
} from "@/components/ui/icons";

export type StrataIcon = ComponentType<{ className?: string; style?: CSSProperties }>;

export type StrataNavItem = {
  href: string;
  label: string;
  icon: StrataIcon;
  /** Permission requise, celle du rail Classique. Absente : toujours visible. */
  perm?: { domain: TenantDomain; level: TenantLevel };
  /** Valeurs de `?tab=` qui désignent cette entrée (la première est celle du lien). */
  tabs?: string[];
  /** Entrée active quand la page est ouverte sans `?tab=`. */
  defaultTab?: boolean;
  /** Autres chemins (pages filles) qui rendent l'entrée active. */
  altPrefixes?: string[];
  /** Filtre de la page Projets (bouton de la page, pas lien de la topbar). */
  filter?: "prestation" | "integration";
  /** Sous-groupe de la navigation de section (« Modèles »). */
  group?: string;
};

export type StrataSection = {
  id: "projets" | "catalogue" | "administration";
  label: string;
  icon: StrataIcon;
  items: StrataNavItem[];
};

const PROJECTS_READ = { domain: "projects", level: "read" } as const;
const DESIGN_READ = { domain: "design", level: "read" } as const;
const CATALOG_ADMIN = { domain: "catalog", level: "admin" } as const;
const SETTINGS_ADMIN = { domain: "settings", level: "admin" } as const;
const MEMBERS_ADMIN = { domain: "members", level: "admin" } as const;

/** Sous-groupe « Modèles » de l'onglet Catalogue. */
export const MODELES = "Modèles";

export const STRATA_NAV: StrataSection[] = [
  {
    id: "projets",
    label: "Projets",
    icon: Folder,
    items: [
      { href: "/dashboard", label: "Projets", icon: Gauge },
      {
        href: "/projects?tab=prestation",
        label: "Prestation",
        icon: Antenna,
        tabs: ["prestation"],
        filter: "prestation",
        perm: PROJECTS_READ,
      },
      {
        href: "/projects?tab=integration",
        label: "Intégration",
        icon: Wrench,
        tabs: ["integration"],
        filter: "integration",
        perm: PROJECTS_READ,
      },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    icon: Package,
    items: [
      { href: "/admin/catalogue", label: "Catalogue", icon: Package, perm: CATALOG_ADMIN },
      {
        href: "/templates?tab=racks",
        label: "Contenants",
        icon: Lockers,
        tabs: ["racks"],
        defaultTab: true,
        altPrefixes: ["/racks", "/rigs"],
        perm: DESIGN_READ,
        group: MODELES,
      },
      {
        href: "/templates?tab=panels",
        label: "Panels",
        icon: LayoutPanelTop,
        tabs: ["panels"],
        altPrefixes: ["/panels"],
        perm: DESIGN_READ,
        group: MODELES,
      },
      {
        href: "/templates?tab=dossiers",
        label: "Dossiers",
        icon: FileStack,
        tabs: ["dossiers"],
        perm: DESIGN_READ,
        group: MODELES,
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: Settings,
    items: [
      { href: "/admin/espace", label: "Espace", icon: Building2, perm: SETTINGS_ADMIN },
      { href: "/admin/users", label: "Utilisateurs", icon: Users, perm: MEMBERS_ADMIN },
      { href: "/admin/catalogue", label: "Catalogue", icon: Package, perm: CATALOG_ADMIN },
      { href: "/admin/parametres", label: "Paramètres", icon: Settings, perm: SETTINGS_ADMIN },
      { href: "/admin/systeme", label: "Système", icon: Cpu, perm: SETTINGS_ADMIN },
    ],
  },
];

const startsWithPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** Onglet de la topbar auquel appartient une page (`null` : aucun, ex. le profil). */
export function sectionOf(pathname: string): StrataSection["id"] | null {
  if (startsWithPath(pathname, "/admin/catalogue")) return "catalogue";
  if (startsWithPath(pathname, "/admin")) return "administration";
  if (["/templates", "/racks", "/rigs", "/panels"].some((p) => startsWithPath(pathname, p))) return "catalogue";
  if (startsWithPath(pathname, "/dashboard") || startsWithPath(pathname, "/projects")) return "projets";
  return null;
}

/** Entrée active pour la page `pathname` (et son `?tab=`). */
export function isItemActive(item: StrataNavItem, pathname: string, tabParam: string | null): boolean {
  const base = item.href.split("?")[0];
  if (item.altPrefixes?.some((p) => startsWithPath(pathname, p))) return true;
  if (!startsWithPath(pathname, base)) return false;
  if (!item.tabs) return true;
  // Comme le rail Classique : sur la page et ses sous-pages, `?tab=` tranche,
  // et sans `?tab=` l'entrée par défaut est active.
  return tabParam ? item.tabs.includes(tabParam) : !!item.defaultTab;
}

/** Filtre de permission de la navigation, comme le rail Classique (hors provider : tout est visible). */
export function navFilter(has: ((domain: TenantDomain, level: TenantLevel) => boolean) | undefined) {
  return (item: StrataNavItem) => !item.perm || !has || has(item.perm.domain, item.perm.level);
}

/** Lien de l'onglet d'une section : sa première entrée visible (hors filtres de page). */
export function sectionHref(section: StrataSection, canSee: (item: StrataNavItem) => boolean): string | null {
  return section.items.find((i) => !i.filter && canSee(i))?.href ?? null;
}
