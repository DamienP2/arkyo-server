// arkyo-server: test d'imports de la phase 4c (Task 8) — chaque module copié
// d'arkyo pour le socle du synoptique s'importe sans erreur (fermeture des
// imports complète, shims résolus).
import { describe, expect, it } from "vitest";

const MODULES = [
  "@/components/editor-shell/contextual-topbar",
  "@/components/editor-shell/cursor-hint",
  "@/components/editor-shell/floating-context-menu",
  "@/components/editor-shell/hooks/use-cursor-hint",
  "@/components/editor-shell/hooks/use-keyboard-shortcuts",
  "@/components/editor-shell/hooks/use-layers",
  "@/components/editor-shell/left-toolbar",
  "@/components/editor-shell/right-panel",
  "@/components/editor-shell/slide-over-panel",
  "@/components/editor-shell/synoptic-actions-bar",
  "@/components/editor-shell/tools-synoptic",
  "@/components/synoptique/components/synoptic-adapter-node",
  "@/components/synoptique/components/synoptic-adapter-picker",
  "@/components/synoptique/hooks/use-cable-lane-offsets",
  "@/components/synoptique/hooks/use-synoptic-history",
  "@/components/synoptique/hooks/use-validation-report",
  "@/components/synoptique/lib/cable-paths",
  "@/components/synoptique/lib/cabling-api",
  "@/components/synoptique/lib/connection-devirt",
  "@/components/synoptique/lib/external-ports",
  "@/components/synoptique/lib/fit-all",
  "@/components/synoptique/lib/grid",
  "@/components/synoptique/lib/scene-descriptor",
  "@/components/synoptique/lib/snapshot-sync",
  "@/lib/services/audit-format",
];

describe("phase 4c : socle du synoptique", () => {
  it.each(MODULES)("%s s'importe", async (m) => {
    const mod = await import(/* @vite-ignore */ m);
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
