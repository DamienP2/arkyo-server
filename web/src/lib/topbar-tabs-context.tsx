"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type TopbarTabsCtx = {
  tabs: ReactNode | null;
  setTabs: (tabs: ReactNode | null) => void;
};

const Ctx = createContext<TopbarTabsCtx>({ tabs: null, setTabs: () => {} });

export function TopbarTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<ReactNode | null>(null);
  return <Ctx.Provider value={{ tabs, setTabs }}>{children}</Ctx.Provider>;
}

export function useTopbarTabs() {
  return useContext(Ctx);
}
