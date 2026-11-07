"use client";

import { useState } from "react";
import { Trash2, PenLine, Cable } from "@/components/ui/icons";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";

const COLORS = [
  "#6366f1",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];

export function SynopticBundlesSection() {
  const bundles = useTopbarActions((s) => s.synopticBundles);
  const onAction = useTopbarActions((s) => s.onBundleAction);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  if (bundles.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Cable className="text-muted-foreground h-3 w-3" />
        <span className="text-muted-foreground text-[10px] tracking-[0.12em] uppercase">
          Faisceaux
        </span>
        <span
          className="text-muted-foreground text-[10px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          · {bundles.length}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {bundles.map((b) => (
          <div
            key={b.id}
            className="border-border bg-card flex items-center gap-1.5 rounded-md border px-2 py-1"
          >
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-black/10"
              style={{ background: b.color }}
            />
            {editingId === b.id ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => {
                  if (editingValue.trim()) onAction?.("rename", b.id, editingValue.trim());
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (editingValue.trim()) onAction?.("rename", b.id, editingValue.trim());
                    setEditingId(null);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                className="flex-1 bg-transparent text-[11px] focus:outline-none"
              />
            ) : (
              <span className="flex-1 truncate text-[11px] font-medium" title={b.name}>
                {b.name}
              </span>
            )}
            <span
              className="text-muted-foreground text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {b.count}
            </span>
            {/* color picker mini */}
            <div className="flex items-center gap-0.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onAction?.("color", b.id, c)}
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline:
                      b.color.toLowerCase() === c.toLowerCase()
                        ? "1.5px solid var(--accent)"
                        : undefined,
                  }}
                  title={c}
                  aria-label={`Couleur ${c}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingId(b.id);
                setEditingValue(b.name);
              }}
              title="Renommer"
              aria-label="Renommer"
              className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
            >
              <PenLine className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Supprimer le faisceau "${b.name}" ?`))
                  onAction?.("delete", b.id);
              }}
              title="Supprimer le faisceau"
              aria-label="Supprimer le faisceau"
              className="hover:bg-muted text-muted-foreground hover:text-destructive rounded p-0.5 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
