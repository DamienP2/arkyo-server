// arkyo-server: bouchon phase 4a (Task 10), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/inventaire-left-toolbar.tsx).
// Les outils (`INVENTAIRE_TOOL_DEFS`, `isInventaireToolId`) sont recopiés
// d'arkyo (:26-55) : project-editor.tsx en tire le libellé de la sous-topbar et
// les raccourcis E / A / P / X. La barre elle-même n'est pas rendue.
import {
  Boxes,
  Cable,
  LayoutPanelTop,
  Wrench,
} from "@/components/ui/icons";

export type InventaireToolId =
  | "equipment"
  | "adapter"
  | "panel"
  | "accessory";

const INVENTAIRE_TOOL_IDS: ReadonlySet<string> = new Set([
  "equipment",
  "adapter",
  "panel",
  "accessory",
]);

export function isInventaireToolId(v: unknown): v is InventaireToolId {
  return typeof v === "string" && INVENTAIRE_TOOL_IDS.has(v);
}

export type InventaireToolDef = {
  id: InventaireToolId;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
};

export const INVENTAIRE_TOOL_DEFS: InventaireToolDef[] = [
  { id: "equipment", icon: Boxes, label: "Équipements", shortcut: "E" },
  { id: "adapter", icon: Cable, label: "Adaptateurs", shortcut: "A" },
  { id: "panel", icon: LayoutPanelTop, label: "Panels", shortcut: "P" },
  { id: "accessory", icon: Wrench, label: "Accessoires", shortcut: "X" },
];

export function InventaireLeftToolbar(_props: {
  activeTool: InventaireToolId | null;
  onToolChange: (tool: InventaireToolId | null) => void;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitAll?: () => void;
  onCenter?: () => void;
  excludeTools?: InventaireToolId[];
  hideZoom?: boolean;
}) {
  return null;
}
