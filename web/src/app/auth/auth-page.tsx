/**
 * `/auth` — connexion par identifiant (email ou nom d'utilisateur) et mot de
 * passe, dans le cadre de arkyo:app/platform/auth/page.tsx (une seule étape
 * au lieu des étapes `email` et `code` du flux OTP).
 *
 * Sans aucun compte (`GET /api/auth/state` → `needsSetup`), renvoie vers
 * `/auth/setup`.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { AuthField, AuthShell, ButtonSpinner, SUBMIT_CLASS } from "./auth-shell";

export type AuthState = { needsSetup: boolean; local: boolean };

/** `GET /api/auth/state`, `null` si le serveur ne répond pas. */
export async function fetchAuthState(): Promise<AuthState | null> {
  try {
    const res = await fetch("/api/auth/state", { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as AuthState) : null;
  } catch {
    return null;
  }
}

/** Corps JSON d'une réponse, `{}` s'il n'est pas lisible. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return ((await res.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export default function AuthPage() {
  usePageTitle("Connexion");
  const t = useTranslations("auth");
  const router = useRouter();
  const { update } = useSession();
  const [ready, setReady] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthState().then((state) => {
      if (cancelled) return;
      if (state?.needsSetup) router.replace("/auth/setup");
      else setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !identifier.trim() || !password) return;
    setError("");
    setLoading(true);
    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
    } catch {
      setLoading(false);
      setError(t("connectionError"));
      return;
    }
    const data = await readJson(res);
    if (!res.ok) {
      setLoading(false);
      setError(typeof data.error === "string" ? data.error : t("connectionError"));
      return;
    }
    await update();
    router.replace(data.mustChangePassword ? "/auth/password" : "/dashboard");
  }

  return (
    <AuthShell error={error}>
      {ready && (
        <form onSubmit={handleLogin}>
          <div className="space-y-4">
            <AuthField
              id="identifier"
              label="Identifiant"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              autoComplete="username"
              disabled={loading}
              placeholder={t("emailPlaceholder")}
            />
            <AuthField
              id="password"
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !identifier.trim() || !password}
            className={SUBMIT_CLASS}
          >
            {loading && <ButtonSpinner />}
            <span>{loading ? t("verifying") : "Se connecter"}</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
