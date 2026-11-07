/**
 * Navigation de l'interface Strata : onglets de la topbar (une section par
 * onglet) et entrées de la barre latérale de bibliothèque.
 *
 * Les routes et les permissions sont exactement celles du rail Classique
 * (`components/layout/sidebar.tsx`) : `strata-app-shell.test.tsx` le vérifie.
 * Aucune route n'est retirée ; s'y ajoute le renvoi « Référentiels » vers
 * Paramètres dans l'onglet Catalogue.
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
  SlidersHorizontal,
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
  /** Listée dans le menu Administration seulement : sa page vit dans un autre onglet. */
  menuOnly?: boolean;
  /** Renvoi vers la page d'un autre onglet, affiché après les entrées de la section. */
  renvoi?: boolean;
};

export type StrataSection = {
  id: "projets" | "modeles" | "catalogue" | "administration";
  label: string;
  icon: StrataIcon;
  items: StrataNavItem[];
};

const PROJECTS_READ = { domain: "projects", level: "read" } as const;
const DESIGN_READ = { domain: "design", level: "read" } as const;
const CATALOG_ADMIN = { domain: "catalog", level: "admin" } as const;
const SETTINGS_ADMIN = { domain: "settings", level: "admin" } as const;
const MEMBERS_ADMIN = { domain: "members", level: "admin" } as const;

export const STRATA_NAV: StrataSection[] = [
  {
    id: "projets",
    label: "Projets",
    icon: Folder,
    items: [
      { href: "/dashboard", label: "Tableau de bord", icon: Gauge },
      {
        href: "/projects?tab=prestation",
        label: "Prestation",
        icon: Antenna,
        tabs: ["prestation"],
        defaultTab: true,
        perm: PROJECTS_READ,
      },
      {
        href: "/projects?tab=integration",
        label: "Intégration",
        icon: Wrench,
        tabs: ["integration"],
        perm: PROJECTS_READ,
      },
    ],
  },
  {
    id: "modeles",
    label: "Modèles",
    icon: Lockers,
    items: [
      {
        href: "/templates?tab=racks",
        label: "Contenants",
        icon: Lockers,
        tabs: ["racks"],
        defaultTab: true,
        altPrefixes: ["/racks", "/rigs"],
        perm: DESIGN_READ,
      },
      {
        href: "/templates?tab=panels",
        label: "Panels",
        icon: LayoutPanelTop,
        tabs: ["panels"],
        altPrefixes: ["/panels"],
        perm: DESIGN_READ,
      },
      {
        href: "/templates?tab=dossiers",
        label: "Dossiers",
        icon: FileStack,
        tabs: ["dossiers"],
        perm: DESIGN_READ,
      },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    icon: Package,
    // Une seule entrée : Équipements, Cordons et Adaptateurs sont les onglets
    // de la page, rendus dans la topbar Strata (`useTopbarTabs`).
    items: [
      { href: "/admin/catalogue", label: "Catalogue", icon: Package, perm: CATALOG_ADMIN },
      {
        href: "/admin/parametres",
        label: "Référentiels",
        icon: SlidersHorizontal,
        perm: SETTINGS_ADMIN,
        renvoi: true,
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
      { href: "/admin/catalogue", label: "Catalogue", icon: Package, perm: CATALOG_ADMIN, menuOnly: true },
      { href: "/admin/parametres", label: "Paramètres", icon: Settings, perm: SETTINGS_ADMIN },
      { href: "/admin/systeme", label: "Système", icon: Cpu, perm: SETTINGS_ADMIN },
    ],
  },
];

const startsWithPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** Onglet de la topbar auquel appartient une page. */
export function sectionOf(pathname: string): StrataSection["id"] {
  if (startsWithPath(pathname, "/admin/catalogue")) return "catalogue";
  if (startsWithPath(pathname, "/admin")) return "administration";
  if (["/templates", "/racks", "/rigs", "/panels"].some((p) => startsWithPath(pathname, p))) return "modeles";
  return "projets";
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

/** Entrées propres à la section (ni menu seul, ni renvoi) : elles portent l'onglet. */
export function primaryItems(section: StrataSection, canSee: (item: StrataNavItem) => boolean): StrataNavItem[] {
  return section.items.filter((i) => !i.menuOnly && !i.renvoi && canSee(i));
}

/** Filtre de permission de la navigation, comme le rail Classique (hors provider : tout est visible). */
export function navFilter(has: ((domain: TenantDomain, level: TenantLevel) => boolean) | undefined) {
  return (item: StrataNavItem) => !item.perm || !has || has(item.perm.domain, item.perm.level);
}
