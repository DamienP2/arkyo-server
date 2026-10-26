/**
 * Shim de `next/navigation` sur `react-router` 7 (mode bibliothèque).
 *
 * Les fichiers copiés d'arkyo importent `next/navigation` : l'alias Vite et
 * `tsconfig` `paths` les redirigent ici, sans modifier leur code.
 *
 * - `useRouter()` : `push`, `replace`, `back`, `forward`, `refresh` (émet
 *   l'évènement `arkyo:refresh` sur `window` pour que la route recharge ses
 *   données, comme le `router.refresh()` de Next qui relance les Server
 *   Components), `prefetch` (no-op).
 * - `redirect(url)` / `notFound()` lèvent une `Response` de navigation : dans un
 *   `loader`, react-router la suit lui-même ; pendant le rendu, elle remonte à
 *   l'`errorElement` de la route, qui doit être `<NavigationErrorElement />`.
 */

import { createElement, useEffect, useMemo, useRef } from "react";
import {
  isRouteErrorResponse,
  Navigate,
  redirect as routerRedirect,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useRouteError,
  useSearchParams as useRouterSearchParams,
} from "react-router";

/** Évènement émis par `router.refresh()`. */
export const REFRESH_EVENT = "arkyo:refresh";

type NavigateOptions = { scroll?: boolean };

export type AppRouterInstance = {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
};

export function useRouter(): AppRouterInstance {
  const navigate = useNavigate();
  // `useNavigate` peut changer d'identité selon le routeur ; on garde un objet
  // stable (arkyo le met en dépendance de `useMemo` / `useCallback`).
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  return useMemo<AppRouterInstance>(
    () => ({
      push: (href, options) =>
        void navigateRef.current(href, { preventScrollReset: options?.scroll === false }),
      replace: (href, options) =>
        void navigateRef.current(href, {
          replace: true,
          preventScrollReset: options?.scroll === false,
        }),
      back: () => void navigateRef.current(-1),
      forward: () => void navigateRef.current(1),
      refresh: () => {
        window.dispatchEvent(new Event(REFRESH_EVENT));
      },
      prefetch: () => {},
    }),
    [],
  );
}

/**
 * Abonne `callback` aux `router.refresh()`. Les pages portées qui chargent leurs
 * données côté client l'utilisent pour recharger.
 */
export function useRefresh(callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, []);
}

export function usePathname(): string {
  return useLocation().pathname;
}

export type ReadonlyURLSearchParams = Omit<URLSearchParams, "append" | "delete" | "set" | "sort">;

export function useSearchParams(): ReadonlyURLSearchParams {
  return useRouterSearchParams()[0];
}

export type Params = Record<string, string | string[]>;

export function useParams<T extends Params = Params>(): T {
  return useRouterParams() as unknown as T;
}

// ── redirect / notFound ─────────────────────────────────────────────────────

export function redirect(url: string, _type?: "replace" | "push"): never {
  throw routerRedirect(url);
}

export function permanentRedirect(url: string, _type?: "replace" | "push"): never {
  throw routerRedirect(url, 308);
}

export function notFound(): never {
  throw new Response(null, { status: 404, statusText: "Not Found" });
}

/** URL cible si `error` est une redirection levée par `redirect()`. */
export function getRedirectTarget(error: unknown): string | null {
  if (error instanceof Response && error.status >= 300 && error.status < 400) {
    return error.headers.get("Location");
  }
  return null;
}

export function isNotFoundError(error: unknown): boolean {
  if (error instanceof Response) return error.status === 404;
  return isRouteErrorResponse(error) && error.status === 404;
}

/**
 * Page 404 par défaut de Next.js (arkyo n'a pas de `not-found.tsx`).
 */
export function NotFoundPage() {
  useEffect(() => {
    document.title = "404: This page could not be found.";
  }, []);
  return createElement(
    "div",
    {
      style: {
        fontFamily:
          'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
        height: "100vh",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    createElement(
      "div",
      null,
      createElement(
        "h1",
        {
          style: {
            display: "inline-block",
            margin: "0 20px 0 0",
            padding: "0 23px 0 0",
            fontSize: 24,
            fontWeight: 500,
            verticalAlign: "top",
            lineHeight: "49px",
            borderRight: "1px solid rgba(0, 0, 0, .3)",
          },
        },
        "404",
      ),
      createElement(
        "div",
        { style: { display: "inline-block" } },
        createElement(
          "h2",
          { style: { fontSize: 14, fontWeight: 400, lineHeight: "49px", margin: 0 } },
          "This page could not be found.",
        ),
      ),
    ),
  );
}

/**
 * `errorElement` des routes : intercepte `redirect()` (navigation) et
 * `notFound()` (page 404) levés pendant le rendu ; relance toute autre erreur
 * vers la route parente.
 */
export function NavigationErrorElement() {
  const error = useRouteError();
  const target = getRedirectTarget(error);
  if (target) return createElement(Navigate, { to: target, replace: true });
  if (isNotFoundError(error)) return createElement(NotFoundPage);
  throw error;
}
