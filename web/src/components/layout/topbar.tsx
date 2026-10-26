"use client";

/**
 * Topbar tenant — alignée sur le pattern visuel de la SupervisorTopbar.
 *
 * Lockup : monogram + arkyo.io + | + Nom du tenant (Title Case).
 * Actions : Theme toggle (Sun/Moon icon), NotificationsMenu, LanguageMenu,
 *           séparateur, badge rôle MemberRole, ProfileMenu.
 *
 * Les sub-composants sont volontairement dupliqués depuis
 * `app/supervisor/components/supervisor-topbar.tsx` pour ne pas casser
 * Supervisor lors d'un refacto. Si on veut DRY un jour, extraire dans
 * `components/layout/topbar-menus.tsx` partagé.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  Bell,
  Check,
  CheckCheck,
  Globe,
  LogOut,
  Moon,
  Sun,
  User,
} from "@/components/ui/icons";

import { api } from "@/lib/api-client";
import { PresenceAvatars } from "@/components/presence/presence-avatars";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { useTenantMembership } from "@/lib/tenant-membership-context";
import { locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/lib/prisma/main-client";
import { LoadingState } from "@/components/ui/loading-state";

// ── Constantes ───────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<MemberRole, { label: string; cls: string }> = {
  OWNER: {
    label: "PROPRIÉTAIRE",
    cls: "text-purple-500 bg-purple-50 dark:bg-purple-950/30",
  },
  CHEF_PROJET: {
    label: "CHEF DE PROJET",
    cls: "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30",
  },
  TECHNICIEN: {
    label: "TECHNICIEN",
    cls: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30",
  },
  CONSULTATION: {
    label: "CONSULTATION",
    cls: "text-slate-500 bg-slate-50 dark:bg-slate-950/30",
  },
};

const LANG_LABEL: Record<Locale, { native: string; flag: string }> = {
  fr: { native: "Français", flag: "🇫🇷" },
  en: { native: "English", flag: "🇬🇧" },
  es: { native: "Español", flag: "🇪🇸" },
  de: { native: "Deutsch", flag: "🇩🇪" },
  it: { native: "Italiano", flag: "🇮🇹" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "demo" / "DEMO STUDIO" / "demo studio" → "Demo Studio". */
function toTitleCase(input: string): string {
  return input
    .split(/(\s|-|_)/) // garde les séparateurs
    .map((seg) =>
      /\s|-|_/.test(seg)
        ? seg
        : seg.charAt(0).toLocaleUpperCase("fr-FR") +
          seg.slice(1).toLocaleLowerCase("fr-FR"),
    )
    .join("");
}

/** Ferme un popover sur clic-extérieur ou Escape. */
function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open, onClose]);
  return ref;
}

// ── Notifications ────────────────────────────────────────────────────────────

type Notif = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const router = useRouter();

  const fetchCount = useCallback(async () => {
    try {
      const r = await api.get<{ count: number }>("/api/notifications/count");
      setCount(r.count ?? 0);
    } catch {
      // silencieux
    }
  }, []);

  useEffect(() => {
    void fetchCount();
    const id = window.setInterval(fetchCount, 60_000);
    return () => window.clearInterval(id);
  }, [fetchCount]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: Notif[]; count: number }>(
        "/api/notifications?limit=15&unread=true",
      );
      setItems(r.items ?? []);
      setCount(r.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggle = () => {
    if (open) setOpen(false);
    else {
      setOpen(true);
      void fetchList();
    }
  };

  const deleteOne = async (id: string) => {
    try {
      await api.delete(`/api/notifications/${id}`);
      void fetchCount();
    } catch {
      // silencieux
    }
  };

  const handleItemClick = (n: Notif) => {
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.readAt) setCount((c) => Math.max(0, c - 1));
    void deleteOne(n.id);
    setOpen(false);
    // Côté tenant, on ne route pas par type — on laisse le clic juste marquer
    // comme lu et fermer. Si plus tard on veut router (vers projets, support…),
    // on ajoutera une fonction `getTenantNotificationHref(n)`.
    void router; // reserved for future use
  };

  const markAllRead = async () => {
    try {
      await api.patch("/api/notifications", { action: "read-all" });
      setItems([]);
      setCount(0);
    } catch {
      // silencieux
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-[var(--arkyo-soft)] transition-colors hover:bg-[var(--arkyo-ink)] hover:text-white"
        aria-label="Notifications"
      >
        <Bell className="h-3.5 w-3.5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <p className="text-xs font-semibold">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-[10px] font-medium text-[var(--accent)] hover:underline"
              >
                <CheckCheck className="h-3 w-3" />
                Tout marquer lu
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <LoadingState className="py-8" />
            ) : items.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">
                Aucune notification non lue
              </p>
            ) : (
              items.map((n) => {
                const unread = !n.readAt;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-[var(--border)]/50 px-3 py-2.5 text-left transition-colors",
                      unread
                        ? "bg-[var(--accent)]/[0.04] hover:bg-[var(--accent)]/[0.08]"
                        : "hover:bg-[var(--secondary)]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        unread ? "bg-[var(--accent)]" : "bg-transparent",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-xs leading-tight",
                          unread && "font-semibold",
                        )}
                      >
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--muted-foreground)]">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-[9px] text-[var(--muted-foreground)]">
                        {new Date(n.createdAt).toLocaleString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-[var(--border)] px-3 py-2">
            <Link
              href="/profile?tab=notifications"
              onClick={() => setOpen(false)}
              className="block w-full text-center text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Voir toutes les notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Langue ───────────────────────────────────────────────────────────────────

function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Locale>("fr");
  const [busy, setBusy] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const router = useRouter();

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )locale=([^;]+)/);
    if (m && (locales as readonly string[]).includes(m[1])) {
      setCurrent(m[1] as Locale);
    }
  }, []);

  useEffect(() => {
    function onLocaleChange(e: Event) {
      const detail = (e as CustomEvent<{ locale?: Locale }>).detail;
      if (detail?.locale && (locales as readonly string[]).includes(detail.locale)) {
        setCurrent(detail.locale);
      }
    }
    window.addEventListener("arkyo:locale-changed", onLocaleChange);
    return () => window.removeEventListener("arkyo:locale-changed", onLocaleChange);
  }, []);

  const change = async (loc: Locale) => {
    if (loc === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/platform/locale", { locale: loc });
      setCurrent(loc);
      setOpen(false);
      window.dispatchEvent(
        new CustomEvent("arkyo:locale-changed", { detail: { locale: loc } }),
      );
      router.refresh();
    } catch {
      setBusy(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-[var(--arkyo-soft)] transition-colors hover:bg-[var(--arkyo-ink)] hover:text-white"
        aria-label="Langue"
        title={`Langue : ${LANG_LABEL[current].native}`}
      >
        <Globe className="h-3.5 w-3.5" />
        <span
          className="text-[10px] font-bold tracking-wider uppercase"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {current}
        </span>
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
          {locales.map((loc) => {
            const info = LANG_LABEL[loc];
            const active = loc === current;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => void change(loc)}
                disabled={busy}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors",
                  active
                    ? "bg-[var(--accent)]/8 font-medium text-[var(--accent)]"
                    : "hover:bg-[var(--secondary)]",
                )}
              >
                <span className="text-base leading-none">{info.flag}</span>
                <span className="flex-1 text-left">{info.native}</span>
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Profil ───────────────────────────────────────────────────────────────────

function ProfileMenu({
  email,
  badge,
  onLogout,
}: {
  email: string;
  badge: { label: string; cls: string };
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--arkyo-soft)] transition-colors hover:bg-[var(--arkyo-ink)] hover:text-white"
        aria-label="Profil"
      >
        <User className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
          <div className="border-b border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{email}</p>
                <span
                  className={cn(
                    "mt-1 inline-block rounded px-1.5 py-0.5 text-[8px] font-semibold tracking-wider",
                    badge.cls,
                  )}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-[var(--secondary)]"
            >
              <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="flex-1 text-left">Profil</span>
            </Link>
          </div>

          <div className="border-t border-[var(--border)] py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-500 transition-colors hover:bg-red-500/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Déconnexion</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Topbar ───────────────────────────────────────────────────────────────────

export function Topbar() {
  const { tabs: topbarTabs } = useTopbarTabs();
  const { tenantName, role } = useTenantMembership();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  const sessionEmail = session?.user?.email ?? "";

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  async function handleLogout() {
    await signOut({ callbackUrl: "/auth" });
  }

  const badge = role ? ROLE_BADGE[role] : ROLE_BADGE.CONSULTATION;
  const displayName = tenantName ? toTitleCase(tenantName) : "";

  return (
    <header
      className="fixed right-0 left-0 z-40 flex items-center bg-[var(--arkyo-slate)]"
      style={{ top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))", height: "var(--topbar-height)" }}
    >
      {/* Lockup: monogram + arkyo.io | Tenant Name */}
      <Link
        href="/dashboard"
        className="group flex shrink-0 items-center gap-2.5 px-3"
        title={tenantName ? `Espace ${displayName}` : "Accueil"}
      >
        <svg
          width={20}
          height={20}
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="text-[var(--arkyo-blue-light)] transition-transform duration-150 group-hover:scale-105"
        >
          <path
            d="M26 84 L26 28 C26 6 74 6 74 28 L74 84"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="26"
            y1="58"
            x2="74"
            y2="58"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            opacity="0.4"
          />
          <circle cx="62" cy="58" r="2.5" fill="currentColor" opacity="0.7" />
        </svg>
        <span className="text-[13px] font-bold tracking-tight text-white">
          arkyo<span className="font-normal text-[var(--arkyo-soft)]">.io</span>
        </span>
        {displayName && (
          <>
            <span className="text-[13px] text-[var(--arkyo-mid)]">|</span>
            <span className="text-[13px] font-medium text-[var(--arkyo-soft)]">
              {displayName}
            </span>
          </>
        )}
      </Link>

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5 px-3">
        {/* Présence — autres membres sur la même page (rien si salle vide). */}
        <PresenceAvatars className="mr-1" />
        {mounted && (
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--arkyo-soft)] transition-colors hover:bg-[var(--arkyo-ink)] hover:text-white"
            aria-label="Thème"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        )}
        <NotificationsMenu />
        <LanguageMenu />
        <div className="mx-1 h-4 w-px bg-white/10" />
        {role && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[8px] font-semibold tracking-wider",
              badge.cls,
            )}
            style={{ fontFamily: "var(--font-mono)" }}
            title={`Rôle : ${badge.label}`}
          >
            {badge.label}
          </span>
        )}
        <ProfileMenu
          email={sessionEmail || "—"}
          badge={badge}
          onLogout={handleLogout}
        />
      </div>

      {/* Topbar tabs slot (utilisé par useTopbarTabs(...))
          Gated on `mounted` : `topbarTabs` est toujours null au SSR mais peut
          devenir non-null avant le premier paint client (effet d'enfant qui
          appelle setTabs() pendant l'hydratation). Sans ce gate, on a une
          mismatch d'hydratation qui casse les event listeners Radix en aval
          (cf. bouton "+ Nouveau projet"). Pattern à cheval (`translate-y-1/2`)
          pour les pages standards (liste projects, supervisor, etc.). Le
          project-editor utilise sa propre topbar (`ProjectGlobalTopbar`) et
          ne passe pas par ce slot. */}
      {mounted && topbarTabs && (
        <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
          <div className="pointer-events-auto">{topbarTabs}</div>
        </div>
      )}
    </header>
  );
}
