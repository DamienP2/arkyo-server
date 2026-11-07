// arkyo-server: bouchon phase 4c (Task 12), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/_components/project-view-export.tsx)
// à la Task 13 (exports du synoptique). Même export `ProjectViewExport` et
// mêmes props que l'appel de `synoptique-tab-client.tsx` ; les types du
// générateur poster et de l'aperçu vivant sont ceux de la vue synoptique en
// attendant `export-live-page`. Ouvert depuis le bouton « Exporter » du pied du
// panneau droit : le panneau superposé d'arkyo, avec « Bientôt disponible ».
import { EmptyState } from "@/components/ui/empty-state";
import { X } from "@/components/ui/icons";
import type {
  SynopticExportClone,
  SynopticExportCloneOpts,
  SynopticExportResult,
  SynopticPdfExportOpts,
} from "@/components/synoptique/synoptic-view";

export type PosterExporter = (
  opts: SynopticPdfExportOpts,
) => Promise<SynopticExportResult | { blob: Blob; pageCount?: number }>;

export function ProjectViewExport({
  title,
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  fileStem?: string;
  locationLabel?: string | null;
  buildPreviewClone?: (opts: SynopticExportCloneOpts) => SynopticExportClone | null;
  filePrefix: string;
  title: string;
  description?: string;
  viewLabel: string;
  captureSelector: string;
  captureMissingMessage: string;
  hideSelectors?: string[];
  canExport: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poster?: PosterExporter;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col border-l border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-[11px] font-semibold">{title}</span>
        <button
          type="button"
          aria-label="Fermer"
          onClick={() => onOpenChange(false)}
          className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        {/* L'`EmptyState` de `ComingSoon`, sans toucher au titre de l'onglet. */}
        <EmptyState title="Bientôt disponible" />
      </div>
    </div>
  );
}
