// arkyo-server: bouchon phase 4a (Task 12), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_components/container-properties-panel.tsx).
// Mêmes props ; rien n'est rendu. `NameInput`, que le panneau de lieu importe,
// est recopié d'arkyo (:550-625).
import { useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft } from "@/components/ui/icons";

import type { SaveStatus } from "../../_editor/project-contextual-topbar";
import type { InventaireRack } from "../inventaire-client";

export function ContainerPropertiesPanel(_props: {
  rackId: string;
  onClose: () => void;
  onDeleted?: (rackId: string) => void;
  rack?: InventaireRack;
  projectId?: string;
  onPatch?: (data: Record<string, unknown>) => Promise<void> | void;
  notifySave?: (status: SaveStatus) => void;
}) {
  return null;
}

// ── NameInput style synoptique (uppercase, inline, hint Entrée/Enregistré) ──

export function NameInput({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== value) {
      el.value = value;
      setDirty(false);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        onChange={(e) => {
          e.target.value = e.target.value.toUpperCase();
          setDirty(e.target.value.trim() !== value);
          if (saved) setSaved(false);
        }}
        onBlur={(e) => {
          const v = e.target.value.trim().toUpperCase();
          if (v && v !== value) {
            onSave(v);
            setSaved(true);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
          }
          setDirty(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = value;
            setDirty(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="text-foreground hover:border-border w-full truncate border-b border-transparent bg-transparent px-0 py-0.5 pr-20 text-sm font-semibold uppercase transition-colors focus:border-[var(--accent)] focus:outline-none"
      />
      {dirty && (
        <span className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1 text-[9px] font-medium text-[var(--accent)]">
          <CornerDownLeft className="h-3 w-3" />
          Entrée
        </span>
      )}
      {!dirty && saved && (
        // arkyo-server: habillage Strata (succès : --success-text)
        <span className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1 text-[9px] font-medium text-[var(--success-text)]">
          <Check className="h-3 w-3" />
          Enregistré
        </span>
      )}
    </div>
  );
}
