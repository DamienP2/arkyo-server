/**
 * Page pas encore portée : l'`EmptyState` d'arkyo, sans action. Les phases
 * suivantes remplacent chaque `<ComingSoon />` du routeur par la vraie page.
 */

import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { usePageTitle } from "@/lib/hooks/use-page-title";

/**
 * `back` : page plein écran (sans coquille, donc sans barre latérale), avec un
 * lien « Retour » discret : page précédente de l'historique, ou tableau de
 * bord quand l'onglet s'ouvre directement sur cette URL.
 */
export function ComingSoon({ back = false }: { back?: boolean }) {
  usePageTitle();
  if (!back) return <EmptyState title="Bientôt disponible" />;
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="p-4">
        <BackLink />
      </div>
      <EmptyState title="Bientôt disponible" />
    </div>
  );
}

function BackLink() {
  const navigate = useNavigate();
  // Le routeur navigateur numérote ses entrées (`history.state.idx`) : 0 = rien
  // derrière, même après une redirection `replace` depuis un favori. Le routeur
  // mémoire (tests) n'a pas d'`idx` : on retombe sur `key` ("default" = première entrée).
  const key = useLocation().key;
  return (
    <Link
      to="/dashboard"
      onClick={(e) => {
        const idx = (window.history.state as { idx?: number } | null)?.idx;
        const hasHistory = typeof idx === "number" ? idx > 0 : key !== "default";
        if (!hasHistory) return;
        e.preventDefault();
        void navigate(-1);
      }}
      className="inline-flex items-center gap-1.5 rounded-md text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Retour
    </Link>
  );
}

/**
 * Éditeur plein écran pas encore porté (éditeur visuel des gabarits
 * d'impression, phase 6), ouvert depuis une page reprise : `<ComingSoon />`
 * à la place de l'éditeur, avec « Fermer » (Échap) qui rappelle le `onClose`
 * que l'éditeur d'arkyo recevait.
 */
export function ComingSoonEditor({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
      <div className="flex justify-end p-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          <X />
          Fermer
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <ComingSoon />
      </div>
    </div>
  );
}
