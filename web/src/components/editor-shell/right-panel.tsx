"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "@/components/ui/icons";
import { useWorkspace, useWorkspaceActions } from "./hooks/use-workspace";

export interface RightPanelOverlay {
  title: string;
  content: ReactNode;
  onClose: () => void;
}

export interface RightPanelProps {
  propertiesSlot: ReactNode;
  layersSlot?: ReactNode;
  footerSlot?: ReactNode;
  overlayPanel?: RightPanelOverlay | null;
  /** Label de l'onglet propriétés. Défaut : "Propriétés". */
  propertiesLabel?: string;
  /** Label de l'onglet calques. Si undefined et layersSlot absent, l'onglet est masqué. */
  layersLabel?: string;
  /** Masquer les onglets (single panel, pas de tabs). */
  hideTabs?: boolean;
}

function OverlayInternal({
  overlay,
  phase,
  containerRef,
}: {
  overlay: RightPanelOverlay;
  phase: "idle" | "opening" | "closing";
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") overlay.onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        overlay.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onClickOutside);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [overlay, containerRef]);

  const animClass = phase === "closing" ? "arkyo-slide-down" : "arkyo-slide-up";

  return (
    <div
      ref={overlayRef}
      className={`bg-card absolute inset-0 z-10 flex flex-col overflow-hidden shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.25)] ${animClass}`}
      role="dialog"
    >
      <div aria-hidden className="h-0.5 flex-none" style={{ background: "var(--accent)" }} />
      <div className="border-border flex flex-none items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">{overlay.title}</h3>
        <button
          type="button"
          onClick={overlay.onClose}
          aria-label="Fermer"
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">{overlay.content}</div>
    </div>
  );
}

export function RightPanel({
  propertiesSlot,
  layersSlot,
  footerSlot,
  overlayPanel,
  propertiesLabel,
  layersLabel,
  hideTabs,
}: RightPanelProps) {
  const tab = useWorkspace((s) => s.rightPanelTab);
  const { setRightPanelTab } = useWorkspaceActions();

  const [displayedOverlay, setDisplayedOverlay] = useState<RightPanelOverlay | null>(
    overlayPanel ?? null,
  );
  const [phase, setPhase] = useState<"idle" | "opening" | "closing">("idle");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (overlayPanel) {
      setDisplayedOverlay(overlayPanel);
      setPhase("opening");
    } else if (displayedOverlay) {
      setPhase("closing");
      const t = setTimeout(() => {
        setDisplayedOverlay(null);
        setPhase("idle");
      }, 180);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayPanel]);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <Tabs.Root
        value={tab}
        onValueChange={(v) => setRightPanelTab(v as typeof tab)}
        className="flex h-full flex-col"
      >
        {!displayedOverlay && !hideTabs && layersSlot && (
          <Tabs.List className="border-border flex flex-none border-b">
            <Tabs.Trigger
              value="properties"
              className="text-muted-foreground hover:text-foreground flex-1 px-3 py-2.5 text-xs transition-colors data-[state=active]:border-b-2 data-[state=active]:border-[var(--accent)] data-[state=active]:font-semibold data-[state=active]:text-[var(--accent)]"
            >
              {propertiesLabel ?? "Propriétés"}
            </Tabs.Trigger>
            <Tabs.Trigger
              value="layers"
              className="text-muted-foreground hover:text-foreground flex-1 px-3 py-2.5 text-xs transition-colors data-[state=active]:border-b-2 data-[state=active]:border-[var(--accent)] data-[state=active]:font-semibold data-[state=active]:text-[var(--accent)]"
            >
              {layersLabel ?? "Calques"}
            </Tabs.Trigger>
          </Tabs.List>
        )}
        <div className="bg-background relative flex-1 overflow-hidden">
          {!displayedOverlay && (
            <>
              <Tabs.Content value="properties" className="h-full overflow-auto p-3">
                {propertiesSlot}
              </Tabs.Content>
              <Tabs.Content value="layers" className="h-full overflow-auto p-1.5">
                {layersSlot}
              </Tabs.Content>
            </>
          )}
          {displayedOverlay && (
            <OverlayInternal overlay={displayedOverlay} phase={phase} containerRef={rootRef} />
          )}
        </div>
        {footerSlot && <div className="border-border flex-none border-t">{footerSlot}</div>}
      </Tabs.Root>
    </div>
  );
}
