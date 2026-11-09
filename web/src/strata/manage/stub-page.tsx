"use client";

/**
 * Pages de Gérer pas encore portées (spec v2 §4.2) : Réseau (phase 5),
 * Livraison et Dossier (phase 6) : `ComingSoon`, la même phrase qu'en
 * Classique (« Bientôt disponible »).
 */

import { ComingSoon } from "@/components/coming-soon";
import { PageHead } from "./manage-ui";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHead title={title} />
      <div className="flex flex-1 items-center justify-center px-8">
        <ComingSoon />
      </div>
    </div>
  );
}
