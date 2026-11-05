"use client";

/**
 * IdentitySection — sub-tab "Identité" du profil tenant.
 *
 * Calquée sur la version supervisor (`app/supervisor/profile/_components/identity-tab.tsx`)
 * pour garantir la cohérence visuelle :
 *  - 2 colonnes : [Identité] | [Préférences (langue + thème)]
 *  - Email éditable inline avec OTP envoyé à l'ancienne adresse
 *    (réutilise `/api/users/change-email` qui marche pour tout user authentifié)
 *  - Préférences langue branchées sur `/api/platform/locale` (partagé)
 *
 * Le PATCH des autres champs (firstName / lastName / username / phone /
 * jobTitle / avatarUrl) passe par le profile-client parent via `api.patch
 * ("/api/tenant/profile", …)`.
 *
 * arkyo-server: comptes locaux — l'email se modifie directement par
 * `PATCH /api/tenant/profile { email }` (unicité vérifiée par l'API, sans code
 * envoyé par email), et une carte « Mot de passe » (actuel, nouveau,
 * confirmation) appelle `POST /api/auth/password` (décision 8).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Check, Globe, Loader2, Mail, Monitor, Moon, Palette, Pencil, Sun } from "@/components/ui/icons";
import { KeyRound } from "@/components/ui/icons"; // arkyo-server: comptes locaux (carte « Mot de passe »)

import { api } from "@/lib/api-client";
import { getApiErrorMessage } from "@/lib/api-client"; // arkyo-server: comptes locaux
import { cn } from "@/lib/utils";
import { locales, type Locale } from "@/i18n/config";

import { Field, inputCls } from "@/app/supervisor/users/[id]/_editor/ui";
import type { ProfileData } from "../profile-client";

const ACCENT = "var(--accent)";

export type IdentityForm = {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  jobTitle: string;
  locale: string;
  avatarUrl: string;
};

const LANG_LABEL: Record<Locale, { native: string; flag: string }> = {
  fr: { native: "Français", flag: "🇫🇷" },
  en: { native: "English", flag: "🇬🇧" },
  es: { native: "Español", flag: "🇪🇸" },
  de: { native: "Deutsch", flag: "🇩🇪" },
  it: { native: "Italiano", flag: "🇮🇹" },
};

const THEMES: {
  id: "light" | "dark" | "system";
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}[] = [
  { id: "light", label: "Clair", icon: Sun },
  { id: "dark", label: "Sombre", icon: Moon },
  { id: "system", label: "Système", icon: Monitor },
];

// ───────────────────────────────────────────────────────────────────────────
//  IdentitySection
// ───────────────────────────────────────────────────────────────────────────

export function IdentitySection({
  data,
  form,
  set,
  usernameError,
}: {
  data: ProfileData;
  form: IdentityForm;
  set: <K extends keyof IdentityForm>(key: K, val: IdentityForm[K]) => void;
  usernameError: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {/* ── COLONNE GAUCHE — Identité ──────────────────────────────────── */}
      <div className="space-y-5">
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Prénom" required>
                <input
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  placeholder="Jean"
                  className={cn(inputCls, "h-10 text-base")}
                />
              </Field>
              <Field label="Nom" required>
                <input
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                  placeholder="Dupont"
                  className={cn(inputCls, "h-10 text-base")}
                />
              </Field>
            </div>

            <Field
              label="Nom d'utilisateur"
              hint={usernameError ? undefined : "3-30 caractères : minuscules, chiffres, . _ -"}
            >
              <input
                value={form.username}
                onChange={(e) => set("username", e.target.value.toLowerCase())}
                placeholder="jean.dupont"
                className={cn(
                  inputCls,
                  "h-10 font-mono text-base",
                  usernameError && "border-[var(--danger)]/60 focus-visible:ring-[var(--danger)]", // arkyo-server: habillage Strata
                )}
              />
              {/* arkyo-server: habillage Strata */}
              {usernameError && <p className="mt-1 text-[11px] text-[var(--danger-text)]">{usernameError}</p>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Téléphone">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+33 6 12 34 56 78"
                  className={cn(inputCls, "h-10 text-base")}
                />
              </Field>
              <Field label="Fonction">
                <input
                  value={form.jobTitle}
                  onChange={(e) => set("jobTitle", e.target.value)}
                  placeholder="Ingénieur produit"
                  className={cn(inputCls, "h-10 text-base")}
                />
              </Field>
            </div>

            <EmailEditable userId={data.id} email={data.email} />
          </div>
        </div>
        {/* arkyo-server: comptes locaux — changement du mot de passe */}
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-5">
          <PasswordCard />
        </div>
      </div>

      {/* ── COLONNE DROITE — Préférences ────────────────────────────────── */}
      <div className="space-y-5 xl:sticky xl:top-0 xl:self-start">
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-5">
          <LanguagePref initialLocale={data.locale} />
        </div>
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-5">
          <ThemePref />
        </div>
      </div>
    </div>
  );
}

// ── Préférence : Langue ────────────────────────────────────────────────────

function LanguagePref({ initialLocale }: { initialLocale: string }) {
  const router = useRouter();
  const isLocale = (v: string): v is Locale => (locales as readonly string[]).includes(v);
  const initial: Locale = isLocale(initialLocale) ? initialLocale : "fr";
  const [current, setCurrent] = useState<Locale>(initial);
  const [busy, setBusy] = useState<Locale | null>(null);

  // Sync inverse : si la langue change depuis le topbar pendant que cet
  // onglet est ouvert, mettre à jour la sélection visuelle.
  useEffect(() => {
    function onLocaleChange(e: Event) {
      const detail = (e as CustomEvent<{ locale?: Locale }>).detail;
      if (detail?.locale && isLocale(detail.locale)) {
        setCurrent(detail.locale);
      }
    }
    window.addEventListener("arkyo:locale-changed", onLocaleChange);
    return () => window.removeEventListener("arkyo:locale-changed", onLocaleChange);
  }, []);

  const change = async (loc: Locale) => {
    if (loc === current) return;
    setBusy(loc);
    try {
      await api.post("/api/platform/locale", { locale: loc });
      setCurrent(loc);
      window.dispatchEvent(new CustomEvent("arkyo:locale-changed", { detail: { locale: loc } }));
      window.dispatchEvent(new CustomEvent("arkyo:profile-saved"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: ACCENT }}
        >
          Langue
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        S&apos;applique immédiatement à toute l&apos;interface.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {locales.map((loc) => {
          const info = LANG_LABEL[loc];
          const isActive = loc === current;
          const isBusy = busy === loc;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => void change(loc)}
              disabled={!!busy}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)]/60 hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
                busy && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="text-lg leading-none">{info.flag}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{info.native}</p>
                <p className="font-mono text-[10px] tracking-wider text-[var(--muted-foreground)] uppercase">
                  {loc}
                </p>
              </div>
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
              ) : isActive ? (
                <Check className="h-3.5 w-3.5 text-[var(--accent)]" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Préférence : Thème ─────────────────────────────────────────────────────

function ThemePref() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Palette className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: ACCENT }}
        >
          Thème
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        Apparence de l&apos;interface ou réglage système.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const Icon = t.icon;
          const isActive = mounted && theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-colors",
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)]/60 hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[11px] font-medium">{t.label}</span>
              {isActive && <Check className="h-3 w-3 text-[var(--accent)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Email (modifiable via OTP envoyé sur l'ancien email) ───────────────────
// arkyo-server: comptes locaux — modification directe (décision 8) : l'étape
// « Code de vérification » et l'envoi du code sont retirés.

function EmailEditable({ userId, email: initialEmail }: { userId: string; email: string }) {
  void userId; // arkyo-server: l'API modifie l'email de la session (pas d'id envoyé)
  const [currentEmail, setCurrentEmail] = useState(initialEmail);
  const [step, setStep] = useState<"view" | "edit" | "done">("view"); // arkyo-server: étape "verify" retirée
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("view");
    setNewEmail("");
    setError(null);
  };

  // arkyo-server: `handleSendCode` / `handleVerify` (OTP) remplacés par un
  // enregistrement direct, avec les mêmes contrôles côté client.
  const handleSave = async () => {
    setError(null);
    if (!newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError("Email invalide");
      return;
    }
    if (newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
      setError("Le nouvel email est identique à l'actuel");
      return;
    }
    setLoading(true);
    try {
      await api.patch("/api/tenant/profile", { email: newEmail.trim() });
      setCurrentEmail(newEmail.trim());
      setStep("done");
      window.dispatchEvent(new CustomEvent("arkyo:profile-saved"));
      window.setTimeout(reset, 2500);
    } catch (e) {
      setError(getApiErrorMessage(e, "Erreur lors de l'enregistrement"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: ACCENT }}
        >
          Email
        </span>
      </div>

      <div className="space-y-2.5 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 font-mono text-xs break-all">{currentEmail}</p>
          {step === "view" && (
            <button
              type="button"
              onClick={() => setStep("edit")}
              // arkyo-server: habillage Strata (texte d'accent sur fond --secondary)
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent)]/10"
            >
              <Pencil className="h-3 w-3" />
              Modifier
            </button>
          )}
        </div>

        {step === "done" && (
          // arkyo-server: habillage Strata
          <div className="flex items-center gap-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-2.5 py-2">
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success-text)]" />
            <span className="text-[11px] text-[var(--success-text)]">
              Email mis à jour avec succès.
            </span>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-2 border-t border-[var(--border)]/40 pt-1">
            <Field label="Nouvel email">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="nouvelle.adresse@exemple.com"
                autoFocus
                className={cn(inputCls, "h-9 text-sm")}
              />
            </Field>
            {/* arkyo-server: mention du code de vérification retirée (pas d'OTP) */}
            {/* arkyo-server: habillage Strata */}
            {error && <p className="text-[11px] text-[var(--danger-text)]">{error}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                // arkyo-server: habillage Strata
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {/* arkyo-server: comptes locaux — icône Check (enregistrement) au lieu de Mail (envoi du code) */}
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {/* arkyo-server: comptes locaux (« Envoyer le code ») */}
                Enregistrer l&apos;email
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="h-8 rounded-md px-3 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
        {/* arkyo-server: étape « Code de vérification » retirée (pas d'OTP) */}
      </div>
    </div>
  );
}

// ── Mot de passe ───────────────────────────────────────────────────────────
// arkyo-server: comptes locaux — carte ajoutée (décision 8), même habillage
// que les préférences. `POST /api/auth/password` vérifie le mot de passe
// actuel et ferme les autres sessions.

const PASSWORD_MISMATCH = "Les mots de passe ne correspondent pas.";

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = !!current && !!next && !!confirm && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setDone(false);
    if (next !== confirm) {
      setError(PASSWORD_MISMATCH);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Erreur lors du changement de mot de passe"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: ACCENT }}
        >
          Mot de passe
        </span>
      </div>
      <div className="space-y-3">
        <PasswordField id="profile-current-password" label="Mot de passe actuel" value={current} onChange={setCurrent} autoComplete="current-password" />
        <div className="grid grid-cols-2 gap-4">
          <PasswordField id="profile-new-password" label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" />
          <PasswordField id="profile-confirm-password" label="Confirmation" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>
      </div>
      {error && <p className="text-[11px] text-[var(--danger-text)]">{error}</p>}
      {done && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-2.5 py-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success-text)]" />
          <span className="text-[11px] text-[var(--success-text)]">Mot de passe modifié.</span>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
          Changer le mot de passe
        </button>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={cn(inputCls, "h-9 text-sm")}
      />
    </div>
  );
}
