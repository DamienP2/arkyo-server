"use client";
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace-store";
import type { WorkspaceId } from "./tool-registry";

type Ctx = StoreApi<WorkspaceStore>;

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceId;
  children: ReactNode;
}) {
  const storeRef = useRef<Ctx | null>(null);
  if (!storeRef.current) {
    storeRef.current = createWorkspaceStore({ workspace });
  }
  const value = useMemo(() => storeRef.current!, []);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceStore(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceStore must be used within WorkspaceProvider");
  return ctx;
}
