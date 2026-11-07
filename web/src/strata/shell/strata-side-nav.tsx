"use client";

/**
 * Barre latérale de bibliothèque de l'interface Strata (largeur
 * `--rail-width`, 240 px en Strata) : entrées de la section de l'onglet actif,
 * filtrées par les permissions du rail Classique, puis les renvois ; la
 * version en bas, comme le rail.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { cn } from "@/lib/utils";
import { isItemActive, navFilter, primaryItems, sectionOf, STRATA_NAV, type StrataNavItem } from "./nav-model";

function NavItem({ item, active, count }: { item: StrataNavItem; active: boolean; count?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-[9px] rounded-lg px-2.5 py-[7px] text-[13px] transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--foreground)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--accent-strong)]")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count != null && <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{count}</span>}
    </Link>
  );
}

/** `counts` : compteur facultatif par `href` d'entrée. */
export function StrataSideNav({ counts }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const perms = useTenantPermissionsOptional();
  const canSee = navFilter(perms?.has);

  const section = STRATA_NAV.find((s) => s.id === sectionOf(pathname)) ?? STRATA_NAV[0];
  const items = primaryItems(section, canSee);
  const renvois = section.items.filter((i) => i.renvoi && canSee(i));

  return (
    <aside
      className="fixed bottom-0 left-0 z-30 flex flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-2.5 py-[18px]"
      style={{ top: "var(--topbar-bottom)", width: "var(--rail-width)" }}
    >
      <nav aria-label={section.label} className="flex flex-col gap-0.5">
        <div className="px-2.5 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          {section.label}
        </div>
        {items.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            active={isItemActive(item, pathname, tabParam)}
            count={counts?.[item.href]}
          />
        ))}
        {renvois.length > 0 && (
          <>
            <div aria-hidden className="mx-2.5 my-2 h-px bg-[var(--border)]" />
            {renvois.map((item) => (
              <NavItem key={item.href} item={item} active={false} count={counts?.[item.href]} />
            ))}
          </>
        )}
      </nav>

      {/* Version, comme en bas du rail Classique (`sidebar.tsx`). */}
      <div className="mt-auto pt-3 text-center text-[10px] font-bold tracking-widest text-[var(--text-tertiary)] uppercase">
        v0.1.0
      </div>
    </aside>
  );
}
