// arkyo-server: bouchon phase 4b (Task 8), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-export-views-panel.tsx).
// Même export `RackExportViewsPanel` et mêmes props que l'original, pour
// `rack-export.tsx` (Task 7). Le bloc « Vues » (ajout et réglages des objets
// de la page) arrive avec le composeur : en attendant, il n'affiche rien.
import type {
  RackExportComposerActions,
  RackExportContainer,
  RackExportLocation,
} from "./rack-export-composer";
import type { RackExportLayout } from "./rack-export-layout";
import type { RackRenderMode } from "./rack-export-stage";

export function RackExportViewsPanel(_props: {
  layout: RackExportLayout;
  onLayoutChange: (next: RackExportLayout) => void;
  selectedIds: string[];
  containers: RackExportContainer[];
  locations: RackExportLocation[];
  fallbackRenderMode: RackRenderMode;
  actions: { readonly current: RackExportComposerActions | null };
}) {
  return null;
}
