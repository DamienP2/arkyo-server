"use client";

import { useCallback, useRef, useState } from "react";

export type Toast = {
  id: number;
  message: string;
  type?: "error" | "warning" | "info";
};

/**
 * Petit système de toasts interne au rack-editor : affichage non-bloquant
 * des erreurs de placement (collision, dépassement, etc.).
 * Auto-close après 4s.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const addToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
