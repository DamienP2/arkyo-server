"use client";
import { useSyncExternalStore } from "react";
import { useWorkspaceStore } from "../workspace-context";
import type { WorkspaceStore } from "../workspace-store";

export function useWorkspace<T>(selector: (s: WorkspaceStore) => T): T {
  const store = useWorkspaceStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useWorkspaceActions() {
  const store = useWorkspaceStore();
  return store.getState();
}
