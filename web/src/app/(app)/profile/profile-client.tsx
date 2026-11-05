"use client";

/**
 * /profile — orchestrateur client (tenant) à 2 sub-tabs dans la topbar :
 *   Identité / Notifications
 *
 * Pattern aligné sur `espace-client.tsx`, `catalogue-client.tsx`,
 * `support-client.tsx` :
 *  - pill nav rendu dans la topbar via `useTopbarTabs`
 *  - sub-tab actif persisté en localStorage (`tenant.profile.subtab`)
 *  - le param URL `?tab=` prend le pas sur la valeur stockée (les liens
 *    `/profile?tab=notifications` depuis la topbar le déclenchent).
 *
 * Différences notables vis-à-vis du supervisor profile :
 *  - Le rôle affiché dans le bandeau est le `MemberRole` du tenant courant
 *    (OWNER / CHEF_PROJET / TECHNICIEN / CONSULTATION), pas le rôle collaborateur.
 *  - Pas de `clientNumber`, pas de listing des memberships : un seul tenant.
 *  - Les onglets sont dans la topbar (pas une in-page tab-bar) pour respecter
 *    la cohérence visuelle tenant.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, Bell, Building2, Calendar, Check, Clock, Loader2, User } from "@/components/ui/icons";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api-client";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { useTopbarTabs } from "@/lib/topbar-tabs-context";
import { useGuardedRouter, useUnsavedChanges } from "@/lib/unsaved-changes";
import { USERNAME_REGEX } from "@/lib/services/username";
import type { MemberRole } from "@/lib/prisma/main-client";
import { cn } from "@/lib/utils";

import { AvatarUploadShared } from "@/app/supervisor/users/[id]/_editor/avatar-upload-shared";

import { IdentitySection, type IdentityForm } from "./_components/identity-tab";
import { NotificationsTab } from "./_components/notifications-tab";

// ── Constantes ────────────────────────────────────────────────────────────

// arkyo-server: habillage Strata — teintes de rôle conservées, nuances de la
// topbar (contraste >= 4,5:1 en clair et en sombre, vérifié par theme-sweep.test.ts).
const ROLE_BADGE: Record<MemberRole, { label: string; cls: string }> = {
  OWNER: { label: "PROPRIÉTAIRE", cls: "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30" }, // arkyo-server: habillage Strata
  CHEF_PROJET: {
    label: "CHEF DE PROJET",
    cls: "text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30", // arkyo-server: habillage Strata
  },
  TECHNICIEN: { label: "TECHNICIEN", cls: "text-emerald-700 bg-emerald-50 dark:text-emerald-500 dark:bg-emerald-950/30" }, // arkyo-server: habillage Strata
  CONSULTATION: {
    label: "CONSULTATION",
    cls: "text-slate-500 bg-slate-50 dark:text-slate-400 dark:bg-slate-950/30", // arkyo-server: habillage Strata
  },
};

const LOCALES_INFO: Record<string, { flag: string; label: string }> = {
  fr: { flag: "🇫🇷", label: "Français" },
  en: { flag: "🇬🇧", label: "English" },
  de: { flag: "🇩🇪", label: "Deutsch" },
  es: { flag: "🇪🇸", label: "Español" },
  it: { flag: "🇮🇹", label: "Italiano" },
};

type SubTab = "identity" | "notifications";

const STORAGE_KEY = "tenant.profile.subtab";

function isSubTab(v: unknown): v is SubTab {
  return v === "identity" || v === "notifications";
}

const TABS: {
  key: SubTab;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}[] = [
  { key: "identity", label: "Identité", icon: User },
  { key: "notifications", label: "Notifications", icon: Bell },
];

const TAB_PARAM: Record<string, SubTab> = {
  identity: "identity",
  identite: "identity",
  notifications: "notifications",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });
  } catch {
    return "";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type ProfileData = {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  locale: string;
  memberRole: MemberRole;
  createdAt: string;
  lastLogin: string | null;
  profile: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    company: string | null;
    jobTitle: string | null;
    avatarUrl: string | null;
  } | null;
  tenant: { id: string; slug: string; name: string };
};

// ── Composant ──────────────────────────────────────────────────────────────

export function ProfileClient({ data }: { data: ProfileData }) {
  const router = useGuardedRouter();
  const { setTabs } = useTopbarTabs();
  const searchParams = useSearchParams();

  // ── Form state (pattern user-editor) ────────────────────────────────────
  const buildInitialForm = (d: ProfileData): IdentityForm => ({
    firstName: d.profile?.firstName ?? "",
    lastName: d.profile?.lastName ?? "",
    username: d.username ?? "",
    phone: d.profile?.phone ?? "",
    jobTitle: d.profile?.jobTitle ?? "",
    locale: d.locale,
    avatarUrl: d.profile?.avatarUrl ?? "",
  });

  const [initialForm, setInitialForm] = useState<IdentityForm>(() => buildInitialForm(data));
  const [form, setForm] = useState<IdentityForm>(initialForm);
  const set = <K extends keyof IdentityForm>(key: K, val: IdentityForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  // Resync initialForm + form quand le data prop change (router.refresh post-save).
  const dataSnapshot = JSON.stringify(buildInitialForm(data));
  useEffect(() => {
    const next = buildInitialForm(data);
    setInitialForm(next);
    setForm(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSnapshot]);

  // ── Dirty detection ─────────────────────────────────────────────────────
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm],
  );

  const modifiedCount = useMemo(() => {
    let n = 0;
    for (const k of Object.keys(initialForm) as (keyof IdentityForm)[]) {
      if (form[k] !== initialForm[k]) n++;
    }
    return n;
  }, [form, initialForm]);

  // ── Active sub-tab (persisté en localStorage) ───────────────────────────
  const [subTab, setSubTab] = useLocalStorageState<SubTab>(STORAGE_KEY, "identity", {
    isValid: isSubTab,
  });

  // ?tab= override (lien topbar `/profile?tab=notifications`).
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (!tabParam) return;
    const mapped = TAB_PARAM[tabParam.toLowerCase()];
    if (mapped) setSubTab(mapped);
  }, [tabParam, setSubTab]);

  // Pousser les onglets pill dans la topbar.
  useEffect(() => {
    setTabs(
      <div className="flex items-center gap-0.5 rounded-full bg-[var(--background)] p-0.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === subTab;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>,
    );
    return () => setTabs(null);
  }, [subTab, setSubTab, setTabs]);

  // ── Validation ──────────────────────────────────────────────────────────
  const usernameError = useMemo(() => {
    if (!form.username) return null;
    if (!USERNAME_REGEX.test(form.username)) {
      return "3-30 caractères, lettres minuscules, chiffres, . _ -";
    }
    return null;
  }, [form.username]);

  const canSave = !usernameError && !!form.firstName.trim() && !!form.lastName.trim();

  // ── Save ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!canSave) return false;
    setSaving(true);
    setSavedAt(null);
    try {
      await api.patch("/api/tenant/profile", {
        firstName: form.firstName,
        lastName: form.lastName,
        username: form.username || null,
        phone: form.phone || null,
        jobTitle: form.jobTitle || null,
        locale: form.locale,
        avatarUrl: form.avatarUrl || null,
      });
      router.refresh();
      setSavedAt(Date.now());
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [canSave, form, router]);

  // Garde globale "modifications non enregistrées".
  useUnsavedChanges({ dirty, onSave: handleSave, isSaving: saving });

  // Auto-clear du badge "Modifications enregistrées" après 3s.
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(null), 3000);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  // Écoute les saves émis par les composants enfants (langue, email).
  useEffect(() => {
    const onSaved = () => setSavedAt(Date.now());
    window.addEventListener("arkyo:profile-saved", onSaved);
    return () => window.removeEventListener("arkyo:profile-saved", onSaved);
  }, []);

  // ── Bandeau header ──────────────────────────────────────────────────────
  const displayName =
    form.firstName && form.lastName
      ? `${form.firstName} ${form.lastName}`
      : (data.name ?? data.email);

  const initials =
    ((form.firstName?.[0] ?? "") + (form.lastName?.[0] ?? "")).toUpperCase() ||
    (data.name ?? data.email).slice(0, 1).toUpperCase();

  const localeInfo = LOCALES_INFO[form.locale];
  const roleBadge = ROLE_BADGE[data.memberRole];

  return (
    <ConfirmProvider>
      <div className="flex flex-col">
        {/* ── Actions toolbar (Save) au-dessus du bandeau ─────────────────── */}
        <div className="flex shrink-0 items-center justify-end gap-2 px-8 py-2">
          {savedAt && !dirty && (
            // arkyo-server: habillage Strata
            <div className="flex h-8 items-center gap-2 rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/10 px-3 text-xs font-semibold text-[var(--success-text)]">
              <Check className="h-3.5 w-3.5" />
              <span>Modifications enregistrées</span>
            </div>
          )}
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              title={
                canSave
                  ? "Cliquez pour enregistrer vos modifications"
                  : "Corrigez les erreurs de validation avant d'enregistrer"
              }
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50",
                // arkyo-server: habillage Strata
                canSave
                  ? "animate-pulse border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning-text)] hover:bg-[var(--warning)]/20"
                  : "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger-text)] hover:bg-[var(--danger)]/20",
              )}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              <span>
                {saving
                  ? "Enregistrement…"
                  : `${modifiedCount} modification${modifiedCount > 1 ? "s" : ""} non enregistrée${modifiedCount > 1 ? "s" : ""} · Enregistrer`}
              </span>
            </button>
          )}
        </div>

        {/* ── Bandeau enrichi (avatar éditable + identité + meta) ────────── */}
        <header className="flex shrink-0 items-center gap-5 px-8 py-4">
          <AvatarUploadShared
            value={form.avatarUrl}
            onChange={(v) => set("avatarUrl", v)}
            initials={initials}
          />

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg leading-tight font-semibold">{displayName}</h2>
              {localeInfo && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted-foreground)]"
                  title="Langue d'interface (modifiable depuis vos préférences)"
                >
                  {localeInfo.flag} {localeInfo.label}
                </span>
              )}
            </div>
            <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">
              {data.email}
              {data.username ? ` · @${data.username}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider",
                  roleBadge.cls,
                )}
                style={{ fontFamily: "var(--font-mono)" }}
                title={`Rôle dans cet espace : ${roleBadge.label}`}
              >
                {roleBadge.label}
              </span>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {data.tenant.name}
              </span>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {data.lastLogin ? `Connecté ${relativeTime(data.lastLogin)}` : "Jamais connecté"}
              </span>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Créé le {formatDate(data.createdAt)}
              </span>
            </div>
          </div>
        </header>

        {/* ── Sub-tab content ──────────────────────────────────────────── */}
        <div className="px-8 py-6">
          {subTab === "identity" && (
            <IdentitySection data={data} form={form} set={set} usernameError={usernameError} />
          )}
          {subTab === "notifications" && <NotificationsTab />}
        </div>
      </div>
    </ConfirmProvider>
  );
}
