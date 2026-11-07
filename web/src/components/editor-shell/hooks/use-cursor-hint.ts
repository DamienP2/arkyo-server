"use client";
import { create } from "zustand";

export type CursorHintVariant = "default" | "error" | "success";

export interface CursorHintState {
  label: string | null;
  tooltip: string | null;
  variant: CursorHintVariant;
  set: (label: string | null, tooltip?: string | null, variant?: CursorHintVariant) => void;
  clear: () => void;
}

export const useCursorHint = create<CursorHintState>((set) => ({
  label: null,
  tooltip: null,
  variant: "default",
  set: (label, tooltip = null, variant = "default") => set({ label, tooltip, variant }),
  clear: () => set({ label: null, tooltip: null, variant: "default" }),
}));
