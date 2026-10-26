"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type View = "grid" | "list";

const ViewContext = createContext<{ view: View; setView: (v: View) => void }>({
  view: "grid",
  setView: () => {},
});

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>("grid");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("preferred-view") as View | null;
    if (stored === "list" || stored === "grid") setViewState(stored);
    setMounted(true);
  }, []);

  const setView = (v: View) => {
    setViewState(v);
    localStorage.setItem("preferred-view", v);
  };

  // Expose "grid" côté serveur, valeur réelle après montage
  return (
    <ViewContext.Provider value={{ view: mounted ? view : "grid", setView }}>
      {children}
    </ViewContext.Provider>
  );
}

export const useView = () => useContext(ViewContext);
