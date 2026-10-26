"use client";

import { createContext, useContext, type ReactNode } from "react";

type GhostModeCtx = {
  isGhost: boolean;
};

const Ctx = createContext<GhostModeCtx>({ isGhost: false });

export function GhostModeProvider({
  isGhost,
  children,
}: {
  isGhost: boolean;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ isGhost }}>{children}</Ctx.Provider>;
}

export function useGhostMode() {
  return useContext(Ctx);
}
