"use client";

/**
 * Toast — système de notifications transitoires.
 *
 * Pattern :
 *  - `ToastProvider` à monter haut dans l'arbre (mounté globalement dans
 *    `components/layout/theme-provider.tsx`).
 *  - `useToast()` retourne un objet `{ success, error, info, dismiss }`
 *    qui pousse une notif dans la pile.
 *  - Auto-dismiss après `duration` (défaut 4s pour error, 3s pour les autres).
 *  - Stack en bas à droite, max 4 visibles, plus anciens disparaissent.
 *
 * Usage :
 *
 *   const toast = useToast();
 *   toast.error("Échec de la création");
 *   toast.success("Équipement dupliqué");
 *   toast.info("Synchronisation en cours…");
 */

import * as React from "react";
import { CheckCircle2, Info, X, AlertCircle } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  /** Durée en ms avant auto-dismiss. Défaut : 3s (info/success), 4s (error). */
  duration?: number;
};

type ToastItem = {
  id: string;
  variant: ToastVariant;
  message: React.ReactNode;
  duration: number;
};

type ToastContextValue = {
  success: (message: React.ReactNode, options?: ToastOptions) => void;
  error: (message: React.ReactNode, options?: ToastOptions) => void;
  info: (message: React.ReactNode, options?: ToastOptions) => void;
  dismiss: (id?: string) => void;
};

// ── Context ──────────────────────────────────────────────────────────────────

const ToastContext = React.createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;

// ── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id?: string) => {
    if (!id) {
      // Dismiss all
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      setItems([]);
      return;
    }
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const push = React.useCallback(
    (variant: ToastVariant, message: React.ReactNode, options?: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = options?.duration ?? (variant === "error" ? 4000 : 3000);
      const item: ToastItem = { id, variant, message, duration };

      setItems((prev) => {
        const next = [...prev, item];
        // Truncate older items if exceeds MAX_VISIBLE.
        if (next.length > MAX_VISIBLE) {
          const dropped = next.slice(0, next.length - MAX_VISIBLE);
          dropped.forEach((d) => {
            const t = timersRef.current.get(d.id);
            if (t) {
              clearTimeout(t);
              timersRef.current.delete(d.id);
            }
          });
          return next.slice(-MAX_VISIBLE);
        }
        return next;
      });

      const timer = setTimeout(() => {
        dismiss(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
      dismiss,
    }),
    [push, dismiss],
  );

  // Cleanup all timers on unmount.
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ── Viewport ─────────────────────────────────────────────────────────────────

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      // z-[60] : au-dessus des dialogs Radix (z-50).
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[320px] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon =
    item.variant === "success" ? CheckCircle2 : item.variant === "error" ? AlertCircle : Info;
  const accent =
    item.variant === "success"
      ? "text-emerald-500"
      : item.variant === "error"
        ? "text-red-500"
        : "text-[var(--accent)]";

  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-3 shadow-lg",
        "animate-fade-in",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", accent)} strokeWidth={2} />
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--foreground)]">
        {item.message}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)]"
        aria-label="Fermer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
