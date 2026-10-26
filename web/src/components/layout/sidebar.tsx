"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import type { TenantDomain, TenantLevel } from "@/lib/tenant-permissions";
import {
  Gauge,
  Antenna,
  Wrench,
  Lockers,
  LayoutPanelTop,
  FileStack,
  Users,
  Package,
  Settings,
  // arkyo-server: icône `Headphones` (entrée Support) retirée — support SaaS arkyo.
  Building2,
  // arkyo-server: icône `Cpu` de l'entrée Système (page système du serveur local) ;
  // `Server` (HardDrives) était indiscernable de l'icône du Panel.
  Cpu,
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  altPrefixes?: string[];
  // Désambiguïse deux entrées qui partagent le même pathname (ex. /projects,
  // /templates) via le query param `?tab=`.
  tab?: string;
  // Entrée active par défaut quand l'URL n'a pas de `?tab=` (1ʳᵉ de la section).
  defaultTab?: boolean;
  // Permission RBAC tenant requise pour afficher l'entrée. Absente ⇒ toujours
  // visible (Dashboard, Support).
  perm?: { domain: TenantDomain; level: TenantLevel };
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
];

// Section « Projets » — séparée du Dashboard par un divider + libellé.
// Deux entrées : Prestation / Intégration (filtrent la page projets via ?tab=).
const projectItems: NavItem[] = [
  {
    href: "/projects?tab=prestation",
    label: "Prestation",
    icon: Antenna,
    tab: "prestation",
    defaultTab: true,
    perm: { domain: "projects", level: "read" },
  },
  {
    href: "/projects?tab=integration",
    label: "Intégration",
    icon: Wrench,
    tab: "integration",
    perm: { domain: "projects", level: "read" },
  },
];

// Section « Modèle » — séparée des projets par un divider + libellé.
const templateItems: NavItem[] = [
  {
    href: "/templates?tab=racks",
    // Lockers (casiers verticaux) — Server/HardDrives était indiscernable de
    // l'icône Panel (Rows) : deux piles de rectangles horizontaux.
    label: "Contenant",
    icon: Lockers,
    altPrefixes: ["/racks", "/rigs"],
    tab: "racks",
    defaultTab: true,
    perm: { domain: "design", level: "read" },
  },
  {
    href: "/templates?tab=panels",
    label: "Panel",
    icon: LayoutPanelTop,
    altPrefixes: ["/panels"],
    tab: "panels",
    perm: { domain: "design", level: "read" },
  },
  {
    href: "/templates?tab=dossiers",
    label: "Dossier",
    icon: FileStack,
    tab: "dossiers",
    perm: { domain: "design", level: "read" },
  },
];

// Section « Admin » — 4 entrées gouvernées par leur domaine RBAC respectif.
const adminItems: NavItem[] = [
  {
    href: "/admin/espace",
    label: "Espace",
    icon: Building2,
    perm: { domain: "settings", level: "admin" },
  },
  {
    href: "/admin/users",
    label: "Utilisateurs",
    icon: Users,
    perm: { domain: "members", level: "admin" },
  },
  {
    href: "/admin/catalogue",
    label: "Catalogue",
    icon: Package,
    perm: { domain: "catalog", level: "admin" },
  },
  {
    href: "/admin/parametres",
    label: "Paramètres",
    icon: Settings,
    perm: { domain: "settings", level: "admin" },
  },
  // arkyo-server: entrée Système ajoutée (état, sauvegardes et mises à jour du
  // serveur local), gouvernée comme Espace / Paramètres.
  {
    href: "/admin/systeme",
    label: "Système",
    icon: Cpu,
    perm: { domain: "settings", level: "admin" },
  },
];

// arkyo-server: entrée Support (`/support`, `/proposals`) retirée — support et
// propositions catalogue relèvent du SaaS arkyo.

// Ligne du rail : icône fixe à gauche (position invariante entre replié et
// déplié), libellé révélé à droite (fondu + translate-x) quand `expanded`.
function RailItem({
  href,
  label,
  icon: Icon,
  active,
  expanded,
  index = 0,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  expanded: boolean;
  index?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-9 w-full items-center rounded-md transition-colors duration-150",
        active
          ? "bg-[var(--rail-active-bg)] text-[var(--rail-icon-active)]" // arkyo-server: habillage Strata
          : "text-[var(--rail-icon)] hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]", // arkyo-server: habillage Strata
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span
        className={cn(
          "truncate pr-3 text-[13px] font-medium transition-all duration-150 ease-out",
          expanded ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-1 opacity-0",
        )}
        style={expanded ? { transitionDelay: `${40 + index * 12}ms` } : undefined}
      >
        {label}
      </span>
    </Link>
  );
}

// En-tête de section : divider (court + centré au repos, pleine largeur déplié)
// + libellé uppercase muted. `labelAtRest` conserve le micro-libellé 7px actuel
// pour Projets/Modèle ; Admin n'affiche son libellé qu'une fois déplié.
function SectionHeader({
  label,
  expanded,
  labelAtRest = true,
}: {
  label: string;
  expanded: boolean;
  labelAtRest?: boolean;
}) {
  return (
    <div className="w-full">
      <div
        aria-hidden
        className={cn(
          "bg-border/60 mt-1.5 mb-1 h-px transition-all duration-200 ease-out",
          expanded ? "mx-2" : "mx-auto w-5",
        )}
      />
      {(expanded || labelAtRest) && (
        <div
          className={cn(
            "text-[var(--rail-icon)] mb-0.5 font-bold tracking-widest uppercase transition-all duration-150 ease-out", // arkyo-server: habillage Strata
            expanded ? "px-2 text-left text-[9px]" : "text-center text-[7px]",
          )}
        >
          {label}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const perms = useTenantPermissionsOptional();

  // Dépliage au survol (après 150ms, annulé si on ressort avant) ou au focus
  // clavier (immédiat, pour la navigation Tab). Repli immédiat à la sortie.
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expanded = hovering || focused;

  const handleEnter = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovering(true), 150);
  };
  const handleLeave = () => {
    clearTimeout(hoverTimer.current);
    setHovering(false);
  };
  // Ne déplie au focus QUE s'il vient du clavier (`:focus-visible`) : un clic
  // souris donne aussi le focus au lien cliqué, et sans ce garde le rail
  // restait déplié après navigation même souris sortie.
  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (typeof t.matches === "function" && t.matches(":focus-visible")) setFocused(true);
  };
  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };
  // Hors contexte tenant (provider absent) : aucun masquage — la sidebar reste
  // complète. Sous provider : gouvernance RBAC réelle (OWNER bypass dans `has`).
  const has = perms?.has ?? (() => true);

  // Une entrée est visible si elle n'a pas de permission requise, ou si le
  // membre satisfait cette permission.
  const canSee = (item: NavItem) => !item.perm || has(item.perm.domain, item.perm.level);

  const visibleProjectItems = projectItems.filter(canSee);
  const visibleTemplateItems = templateItems.filter(canSee);
  const visibleAdminItems = adminItems.filter(canSee);

  const isActive = (item: NavItem) => {
    const base = item.href.split("?")[0];
    if (base === "/dashboard") return pathname === "/dashboard";
    // Entrées partageant un même pathname (ex. /projects, /templates) :
    // on tranche via le query param `?tab=` (1ʳᵉ entrée active par défaut).
    if (item.tab) {
      if (pathname.startsWith(base)) {
        return tabParam ? tabParam === item.tab : !!item.defaultTab;
      }
      return item.altPrefixes?.some((p) => pathname.startsWith(p)) ?? false;
    }
    if (pathname.startsWith(base)) return true;
    if (item.altPrefixes?.some((p) => pathname.startsWith(p))) return true;
    return false;
  };

  return (
    <aside
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      className={cn(
        "fixed bottom-0 left-0 z-30 flex flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--rail-bg)] px-1.5 py-2 transition-[width] duration-200 ease-out", // arkyo-server: habillage Strata
        expanded && "shadow-lg",
      )}
      style={{ top: "var(--topbar-bottom)", width: expanded ? "190px" : "var(--rail-width)" }}
    >
      <nav className="flex w-full flex-col gap-0.5">
        {navItems.map((item, i) => (
          <RailItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item)}
            expanded={expanded}
            index={i}
          />
        ))}

        {/* Section Projets — masquée si aucune entrée visible (projects < read) */}
        {visibleProjectItems.length > 0 && (
          <>
            <SectionHeader label="Projets" expanded={expanded} />
            {visibleProjectItems.map((item, i) => (
              <RailItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item)}
                expanded={expanded}
                index={i}
              />
            ))}
          </>
        )}

        {/* Section Modèle — masquée si design < read */}
        {visibleTemplateItems.length > 0 && (
          <>
            <SectionHeader label="Modèle" expanded={expanded} />
            {visibleTemplateItems.map((item, i) => (
              <RailItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item)}
                expanded={expanded}
                index={i}
              />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto flex w-full flex-col gap-0.5">
        {/* Section Admin — divider masqué si aucun des 4 items n'est visible.
            Libellé « Admin » révélé uniquement une fois déplié. */}
        {visibleAdminItems.length > 0 && (
          <>
            <SectionHeader label="Admin" expanded={expanded} labelAtRest={false} />
            {visibleAdminItems.map((item, i) => (
              <RailItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item)}
                expanded={expanded}
                index={i}
              />
            ))}
          </>
        )}

        {/* arkyo-server: entrée Support et son divider dédié retirés (support
            SaaS arkyo). */}

        {/* arkyo-server: habillage Strata */}
        <div className="text-[var(--rail-icon)] mt-1 mb-1 text-center text-[7px] font-bold tracking-widest uppercase">
          v0.1.0
        </div>
      </div>
    </aside>
  );
}
