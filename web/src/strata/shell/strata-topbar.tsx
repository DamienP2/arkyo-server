"use client";

/**
 * Topbar de l'interface Strata (46 px), de gauche à droite :
 *   - lockup Strata Arkyo, puis nom du site ;
 *   - onglets segmentés Projets · Modèles · Catalogue · Administration ▾,
 *     filtrés par les permissions du rail Classique ;
 *   - onglets de la page (`useTopbarTabs`), second groupe segmenté ;
 *   - à droite : présence, thème, notifications, langue, badge de rôle, profil
 *     (menus de la topbar Classique, réutilisés tels quels).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { ChevronDown, Moon, Sun } from "@/components/ui/icons";
import { StrataBrand } from "@/components/brand/strata-brand";
import { LanguageMenu, NotificationsMenu, ProfileMenu, ROLE_BADGE } from "@/components/layout/topbar";
import { PresenceAvatars } from "@/components/presence/presence-avatars";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { useTenantMembership } from "@/lib/tenant-membership-context";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { cn } from "@/lib/utils";
import { navFilter, primaryItems, sectionOf, STRATA_NAV, type StrataNavItem, type StrataSection } from "./nav-model";
import { TOPBAR_ICON_BTN, TOPBAR_TAB, TOPBAR_TAB_OFF, TOPBAR_TAB_ON } from "./seg-tabs";

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

/** Onglet « Administration ▾ » : menu des pages d'administration visibles. */
function AdminMenu({ section, items, active }: { section: StrataSection; items: StrataNavItem[]; active: boolean }) {
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
        <Icon className="h-4 w-4" />
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
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={close}
                className="flex w-full items-center gap-[9px] rounded-[6px] px-2.5 py-[7px] text-[13px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <ItemIcon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StrataTopbar() {
  const pathname = usePathname();
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

  return (
    <header
      className="fixed right-0 left-0 z-40 flex items-center gap-[18px] border-b border-[var(--border)] bg-[var(--surface)] px-3.5"
      style={{
        top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))",
        height: "var(--topbar-height)",
      }}
    >
      <div className="flex shrink-0 items-center gap-3">
        <Link href="/dashboard" className="flex items-center" title="Accueil">
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
            return <AdminMenu key={section.id} section={section} items={items} active={active} />;
          }
          const first = primaryItems(section, canSee)[0];
          if (!first) return null;
          const Icon = section.icon;
          return (
            <Link
              key={section.id}
              href={first.href}
              aria-current={active ? "page" : undefined}
              className={cn(TOPBAR_TAB, active ? TOPBAR_TAB_ON : TOPBAR_TAB_OFF)}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </Link>
          );
        })}
      </nav>

      {/* Onglets de la page : même slot que la topbar Classique, monté côté
          client seulement (voir `Topbar`). */}
      {mounted && pageTabs && (
        <div className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]">{pageTabs}</div>
      )}

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        <PresenceAvatars className="mr-1" />
        {mounted && (
          <button onClick={() => setTheme(isDark ? "light" : "dark")} className={TOPBAR_ICON_BTN} aria-label="Thème">
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        )}
        <NotificationsMenu />
        <LanguageMenu />
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
    </header>
  );
}
