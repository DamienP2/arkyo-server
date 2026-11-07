/**
 * Contexte d'interface (Classique / Strata) : lu dans `GET /api/site` par la
 * coquille, exposé aux composants et posé en `data-interface` sur `<html>`.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";

export type UiInterface = "classique" | "strata";

const InterfaceContext = createContext<UiInterface>("classique");

export function InterfaceProvider({ value, children }: { value: UiInterface; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.interface = value;
  }, [value]);
  return <InterfaceContext.Provider value={value}>{children}</InterfaceContext.Provider>;
}

export function useInterface(): UiInterface {
  return useContext(InterfaceContext);
}
