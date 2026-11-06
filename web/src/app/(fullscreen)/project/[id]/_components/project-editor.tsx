// arkyo-server: bouchon temporaire (phase 4a, Task 8), remplacé par la copie
// d'arkyo (arkyo:app/(fullscreen)/project/[id]/_components/project-editor.tsx)
// en Task 9. Mêmes exports (`ProjectEditor`, `ProjectEditorData`) et mêmes
// props que l'éditeur d'arkyo, pour que le chargeur (`../page.tsx`) n'ait pas
// à changer : il monte la coquille (`WorkspaceProvider` + `EditorShell`, topbar
// globale de 44 px comme `project-editor.tsx:1045`) avec `ComingSoon` dans le
// canvas.
import { EditorShell } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { ComingSoon } from "@/components/coming-soon";

/**
 * `ProjectEditorData` (arkyo:…/_components/project-editor.tsx:207-231), tel
 * que `GET /api/tenant/projects/:id/editor` le renvoie. Les types précis
 * (`ProjectHeaderData`, `ProjectFicheData`, `InventaireRack`,
 * `InventaireLocation`, `CartoMap`) arrivent avec la copie d'arkyo.
 */
export type ProjectEditorData = {
  header: { id: string; name: string } & Record<string, unknown>;
  fiche: Record<string, unknown>;
  inventaire: {
    rigConfigId: string | null;
    racks: Record<string, unknown>[];
    locations: Record<string, unknown>[];
  };
  cartographie: {
    maps: unknown[];
  };
};

export function ProjectEditor({
  project,
  tenantName,
}: {
  project: ProjectEditorData;
  tenantName?: string | null;
}) {
  return (
    <WorkspaceProvider workspace="design">
      <EditorShell
        globalTopbar={
          <div className="flex h-full items-center gap-2 px-4 text-sm">
            {tenantName && <span className="text-muted-foreground">{tenantName}</span>}
            <span className="text-foreground font-medium">{project.header.name}</span>
          </div>
        }
        canvas={<ComingSoon back />}
        globalTopbarHeight={44}
      />
    </WorkspaceProvider>
  );
}
