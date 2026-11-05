/**
 * Page pas encore portée : l'`EmptyState` d'arkyo, sans action. Les phases
 * suivantes remplacent chaque `<ComingSoon />` du routeur par la vraie page.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { usePageTitle } from "@/lib/hooks/use-page-title";

export function ComingSoon() {
  usePageTitle();
  return <EmptyState title="Bientôt disponible" />;
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
