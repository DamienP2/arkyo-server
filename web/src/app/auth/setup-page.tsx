/**
 * `/auth/setup` — premier lancement : création du compte propriétaire, dans le
 * cadre de la page de connexion. Le serveur n'accepte cette création que
 * depuis la machine elle-même (`local`) ; à distance, la page affiche la
 * consigne au lieu du formulaire. Une fois un compte créé, renvoie vers `/auth`.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { fetchAuthState, readJson, type AuthState } from "./auth-page";
import {
  AuthField,
  AuthShell,
  ButtonSpinner,
  HINT_CLASS,
  SUBMIT_CLASS,
  USERNAME_RE,
  UsernameField,
  isValidEmail,
} from "./auth-shell";

export const MISMATCH = "Les mots de passe ne correspondent pas";

export default function SetupPage() {
  usePageTitle("Premier lancement");
  const t = useTranslations("auth");
  const router = useRouter();
  const { update } = useSession();
  const [state, setState] = useState<AuthState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthState().then((s) => {
      if (cancelled || !s) return;
      if (!s.needsSetup) router.replace("/auth");
      else setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const u = username.trim();
  const usernameStatus = !u ? "idle" : USERNAME_RE.test(u) ? "ok" : "invalid";
  const canSubmit =
    !!name.trim() &&
    isValidEmail(email) &&
    !!password &&
    !!confirm &&
    usernameStatus !== "invalid" &&
    !loading;

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (password !== confirm) {
      setError(MISMATCH);
      return;
    }
    setError("");
    setLoading(true);
    let res: Response;
    try {
      res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          username: u || undefined,
          password,
        }),
      });
    } catch {
      setLoading(false);
      setError(t("connectionError"));
      return;
    }
    const data = await readJson(res);
    if (!res.ok) {
      setLoading(false);
      setError(typeof data.error === "string" ? data.error : t("serverError"));
      return;
    }
    await update();
    router.replace("/dashboard");
  }

  return (
    <AuthShell error={error}>
      {state && !state.local && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          Créez le premier compte depuis le serveur : ouvrez{" "}
          <span className="text-[var(--foreground)]" style={{ fontFamily: "var(--font-mono)" }}>
            http://localhost:8090
          </span>{" "}
          sur la machine, ou lancez{" "}
          <span className="text-[var(--foreground)]" style={{ fontFamily: "var(--font-mono)" }}>
            arkyo-server user add
          </span>
          .
        </p>
      )}

      {state?.local && (
        <form onSubmit={handleSetup}>
          <p className={HINT_CLASS}>Créez le compte propriétaire de ce serveur.</p>
          <div className="space-y-4">
            <AuthField
              id="name"
              label="Nom"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              autoComplete="name"
              disabled={loading}
            />
            <AuthField
              id="email"
              label={t("emailLabel")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
              placeholder={t("emailPlaceholder")}
            />
            <UsernameField
              username={username}
              setUsername={(v) => setUsername(v.toLowerCase().replace(/\s+/g, ""))}
              status={usernameStatus}
              placeholder="prenom.nom"
              idleHint="Optionnel : pour se connecter sans l'email."
            />
            <AuthField
              id="password"
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
            <AuthField
              id="confirm"
              label="Confirmation"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
          </div>
          <button type="submit" disabled={!canSubmit} className={SUBMIT_CLASS}>
            {loading && <ButtonSpinner />}
            <span>{loading ? t("creating") : "Créer le compte"}</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
