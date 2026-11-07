/**
 * Contexte d'interface (Classique / Strata) : lu dans `GET /api/site` par la
 * coquille, exposé aux composants et posé en `data-interface` sur `<html>`.
 */

import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";

export type UiInterface = "classique" | "strata";

const InterfaceContext = createContext<UiInterface>("classique");

export function InterfaceProvider({ value, children }: { value: UiInterface; children: ReactNode }) {
  // Avant la première image : la coquille Strata s'affiche d'emblée avec ses
  // largeurs (`[data-interface="strata"]`), sans passer par celles du rail.
  useLayoutEffect(() => {
    document.documentElement.dataset.interface = value;
  }, [value]);
  return <InterfaceContext.Provider value={value}>{children}</InterfaceContext.Provider>;
}

export function useInterface(): UiInterface {
  return useContext(InterfaceContext);
}
