/**
 * Page pas encore portée : l'`EmptyState` d'arkyo, sans action. Les phases
 * suivantes remplacent chaque `<ComingSoon />` du routeur par la vraie page.
 */

import { EmptyState } from "@/components/ui/empty-state";
import { usePageTitle } from "@/lib/hooks/use-page-title";

export function ComingSoon() {
  usePageTitle();
  return <EmptyState title="Bientôt disponible" />;
}
