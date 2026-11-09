"use client";

/**
 * Topbar de l'interface Strata v2 (46 px, spec v2 §4.3), de gauche à droite :
 *   - lockup Strata Arkyo (vers la page Projets), puis nom du site ;
 *   - onglets `Projets` · `Catalogue` · `Administration ▾`, filtrés par les
 *     permissions du rail Classique (`nav-model.ts`) ;
 *   - sur les pages des modèles, leur navigation (`Contenants` · `Panels` ·
 *     `Dossiers`) : il n'y a plus de barre latérale, et ces pages n'ont pas
 *     d'onglets ; le catalogue a les siens (`Équipements` · … · `Modèles`) ;
 *   - onglets de la page (`useTopbarTabs`), comme la topbar Classique ;
 *   - à droite : emplacement ⌘K, présence, notifications, langue, thème,
 *     badge de rôle et profil (menus de la topbar Classique, réutilisés tels
 *     quels).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { ChevronDown, Moon, Search, Sun } from "@/components/ui/icons";
import { StrataBrand } from "@/components/brand/strata-brand";
import { LanguageMenu, NotificationsMenu, ProfileMenu, ROLE_BADGE } from "@/components/layout/topbar";
import { PresenceAvatars } from "@/components/presence/presence-avatars";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { useTenantMembership } from "@/lib/tenant-membership-context";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";
import {
  isItemActive,
  MODELES,
  navFilter,
  sectionHref,
  sectionOf,
  STRATA_NAV,
  type StrataNavItem,
  type StrataSection,
} from "./nav-model";
import { CommandPalette } from "@/strata/palette/command-palette";
import { TOPBAR_ICON_BTN, TOPBAR_TAB, TOPBAR_TAB_OFF, TOPBAR_TAB_ON } from "./seg-tabs";

/** Évènement `window` qui ouvre la palette ⌘K (écouté par la palette). */
export const STRATA_PALETTE_EVENT = "strata:palette";

export function openStrataPalette() {
  window.dispatchEvent(new CustomEvent(STRATA_PALETTE_EVENT));
}

/** "demo studio" → "Demo Studio", comme le nom du site de la topbar Classique. */
function toTitleCase(input: string): string {
  return input
    .split(/(\s|-|_)/)
    .map((seg) =>
      /\s|-|_/.test(seg)
        ? seg
        : seg.charAt(0).toLocaleUpperCase("fr-FR") + seg.slice(1).toLocaleLowerCase("fr-FR"),
    )
    .join("");
}

const SUB_TAB =
  "inline-flex items-center rounded-[6px] px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Onglet « Administration ▾ » : menu des pages d'administration visibles. */
function AdminMenu({
  section,
  items,
  active,
  isCurrent,
}: {
  section: StrataSection;
  items: StrataNavItem[];
  active: boolean;
  isCurrent: (item: StrataNavItem) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const Icon = section.icon;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? "page" : undefined}
        className={cn(TOPBAR_TAB, active ? TOPBAR_TAB_ON : TOPBAR_TAB_OFF)}
      >
        <Icon className="hidden h-4 w-4 2xl:block" />
        {section.label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={section.label}
          className="absolute top-full left-0 z-50 mt-2 min-w-[210px] rounded-lg border border-[var(--border-strong)] bg-[var(--popover)] p-1 shadow-xl"
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            const current = isCurrent(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={current ? "page" : undefined}
                onClick={close}
                className={cn(
                  "flex w-full items-center gap-[9px] rounded-[6px] px-2.5 py-[7px] text-[13px] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                  current ? "bg-[var(--accent-soft)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                )}
              >
                <ItemIcon className={cn("h-3.5 w-3.5 shrink-0", current && "text-[var(--accent-strong)]")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Groupe de liens de section (navigation propre à l'onglet actif). */
function SubNav({ label, links }: { label: string; links: { href: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.current ? "page" : undefined}
          className={cn(SUB_TAB, l.current ? TOPBAR_TAB_ON : TOPBAR_TAB_OFF)}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

const Divider = () => <div aria-hidden className="h-4 w-px shrink-0 bg-[var(--border)]" />;

/**
 * Navigation des modèles (`Contenants` · `Panels` · `Dossiers`), sur leurs
 * pages seulement (`/templates`, `/racks`, `/rigs`, `/panels`) : ces pages
 * d'arkyo n'ont pas d'onglets à elles. Sur `/admin/catalogue`, les onglets de
 * la page (dont « Modèles ») suffisent : pas de navigation en plus.
 */
function ModelesNav({
  section,
  canSee,
  pathname,
  tabParam,
}: {
  section: StrataSection;
  canSee: (item: StrataNavItem) => boolean;
  pathname: string;
  tabParam: string | null;
}) {
  const modeles = section.items.filter((i) => i.group === MODELES && canSee(i));
  const onModeles = modeles.some((i) => isItemActive(i, pathname, tabParam)) || pathname === "/templates";
  if (!onModeles || modeles.length === 0) return null;
  return (
    <>
      <Divider />
      <SubNav
        label={MODELES}
        links={modeles.map((i) => ({ href: i.href, label: i.label, current: isItemActive(i, pathname, tabParam) }))}
      />
    </>
  );
}

export function TopbarV2() {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const perms = useTenantPermissionsOptional();
  const { tabs: pageTabs } = useTopbarTabs();
  const { tenantName, role } = useTenantMembership();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const canSee = navFilter(perms?.has);
  const current = sectionOf(pathname);
  const isDark = resolvedTheme === "dark";
  const badge = role ? ROLE_BADGE[role] : ROLE_BADGE.CONSULTATION;
  const displayName = tenantName ? toTitleCase(tenantName) : "";
  const catalogue = STRATA_NAV.find((s) => s.id === "catalogue")!;

  return (
    <header
      className="fixed right-0 left-0 z-40 flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface)] px-3.5 2xl:gap-3.5"
      style={{
        top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))",
        height: "var(--topbar-height)",
      }}
    >
      <div className="flex shrink-0 items-center gap-3">
        <Link href="/dashboard" className="flex items-center" title="Projets">
          <StrataBrand />
        </Link>
        {displayName && (
          <span className="text-[12px] whitespace-nowrap text-[var(--muted-foreground)]">{displayName}</span>
        )}
      </div>

      <nav
        aria-label="Navigation principale"
        className="flex shrink-0 items-center gap-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]"
      >
        {STRATA_NAV.map((section) => {
          const active = section.id === current;
          if (section.id === "administration") {
            const items = section.items.filter(canSee);
            if (items.length === 0) return null;
            return (
              <AdminMenu
                key={section.id}
                section={section}
                items={items}
                active={active}
                isCurrent={(item) => isItemActive(item, pathname, tabParam)}
              />
            );
          }
          const href = sectionHref(section, canSee);
          if (!href) return null;
          const Icon = section.icon;
          return (
            <Link
              key={section.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(TOPBAR_TAB, active ? TOPBAR_TAB_ON : TOPBAR_TAB_OFF)}
            >
              <Icon className="hidden h-4 w-4 2xl:block" />
              {section.label}
            </Link>
          );
        })}
      </nav>

      {current === "catalogue" && (
        <ModelesNav section={catalogue} canSee={canSee} pathname={pathname} tabParam={tabParam} />
      )}

      {/* Onglets de la page : même slot que la topbar Classique, monté côté
          client seulement (voir `Topbar`). */}
      {mounted && pageTabs && (
        <div className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]">{pageTabs}</div>
      )}

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={openStrataPalette}
          aria-label="Rechercher ou agir (⌘K)"
          className="inline-flex h-[30px] items-center gap-2 rounded-[7px] border border-[var(--border)] bg-[var(--muted)] px-2 text-[12.5px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--muted-foreground)] 2xl:mr-1 2xl:w-[230px]"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden flex-1 text-left 2xl:inline">Rechercher, agir…</span>
          <kbd className="hidden rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-sans text-[10.5px] text-[var(--muted-foreground)] 2xl:inline">
            ⌘K
          </kbd>
        </button>
        <PresenceAvatars className="mr-1" />
        <NotificationsMenu />
        <LanguageMenu />
        {mounted && (
          <button onClick={() => setTheme(isDark ? "light" : "dark")} className={TOPBAR_ICON_BTN} aria-label="Thème">
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        )}
        <div className="mx-1 h-4 w-px bg-[var(--border)]" />
        {role && (
          <span
            className={cn("rounded px-1.5 py-0.5 text-[8px] font-semibold tracking-wider", badge.cls)}
            style={{ fontFamily: "var(--font-mono)" }}
            title={`Rôle : ${badge.label}`}
          >
            {badge.label}
          </span>
        )}
        <ProfileMenu
          email={session?.user?.email || "—"}
          badge={badge}
          onLogout={() => void signOut({ callbackUrl: "/auth" })}
        />
      </div>
      <CommandPalette />
    </header>
  );
}
