"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface FloatingMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separatorAfter?: boolean;
  disabled?: boolean;
}

export interface FloatingContextMenuProps {
  x: number;
  y: number;
  items: FloatingMenuItem[];
  onClose: () => void;
}

export function FloatingContextMenu({ x, y, items, onClose }: FloatingContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onOutside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Phase CAPTURE + après 0ms : garantit que le listener s'exécute avant
    // tout stopPropagation/stopImmediatePropagation fait en phase bubble par
    // les children du canvas (cables, zones, adapters, etc.).
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("mousedown", onOutside, true);
      document.addEventListener("contextmenu", onOutside, true);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("contextmenu", onOutside, true);
    };
  }, [onClose]);

  // Clamp to viewport
  const [clampedX, clampedY] = (() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
    const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
    const maxX = vw - 240;
    const maxY = vh - 300;
    return [Math.min(x, maxX), Math.min(y, maxY)];
  })();

  if (!mounted) return null;

  const menu = (
    <div
      ref={ref}
      className="border-border bg-popover text-popover-foreground fixed z-[9999] min-w-[240px] overflow-hidden rounded-lg border p-1.5 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur-xl"
      style={{ left: clampedX, top: clampedY }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <div key={item.id}>
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`group flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-medium transition-colors outline-none select-none disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? "text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)]" // arkyo-server: habillage Strata (texte de danger : --danger-text)
                : "hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
            }`}
          >
            {item.icon && (
              <span className="text-muted-foreground group-hover:text-foreground flex h-4 w-4 items-center justify-center">
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
          </button>
          {item.separatorAfter && idx < items.length - 1 && <div className="bg-border my-1 h-px" />}
        </div>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}
