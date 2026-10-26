/**
 * `/auth/password` — changement de mot de passe (obligatoire après un mot de
 * passe temporaire, `mustChangePassword`), dans le cadre de la page de
 * connexion. Sans session, renvoie vers `/auth`.
 */

import { useState } from "react";
import { Navigate } from "react-router";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { readJson } from "./auth-page";
import { MISMATCH } from "./setup-page";
import {
  AuthField,
  AuthShell,
  ButtonSpinner,
  FOOT_LINK_CLASS,
  HINT_CLASS,
  SUBMIT_CLASS,
} from "./auth-shell";

export default function PasswordPage() {
  usePageTitle("Mot de passe");
  const t = useTranslations("auth");
  const router = useRouter();
  const { status } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (status === "unauthenticated") return <Navigate to="/auth" replace />;

  const canSubmit = !!current && !!next && !!confirm && !loading;

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (next !== confirm) {
      setError(MISMATCH);
      return;
    }
    setError("");
    setLoading(true);
    let res: Response;
    try {
      res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
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
    router.replace("/dashboard");
  }

  return (
    <AuthShell error={error}>
      {status === "authenticated" && (
        <form onSubmit={handleChange}>
          <p className={HINT_CLASS}>Choisissez un nouveau mot de passe.</p>
          <div className="space-y-4">
            <AuthField
              id="current-password"
              label="Mot de passe actuel"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={loading}
            />
            <AuthField
              id="new-password"
              label="Nouveau mot de passe"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
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
            <span>{loading ? t("verifying") : "Changer le mot de passe"}</span>
          </button>
          <div className="mt-6 border-t border-[var(--border)] pt-4 text-center">
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/auth" })}
              disabled={loading}
              className={FOOT_LINK_CLASS}
            >
              ← Changer d&apos;utilisateur
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
