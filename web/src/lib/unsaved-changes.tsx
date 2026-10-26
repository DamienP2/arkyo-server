"use client";

/**
 * UnsavedChangesProvider — protection globale contre la perte de modifications.
 *
 * Pose le contexte au top-level (déjà fait dans theme-provider.tsx). Toute page
 * d'édition appelle `useUnsavedChanges({ dirty, onSave, isSaving })` pour
 * enregistrer son état. Quand l'utilisateur tente de quitter (clic sur lien,
 * fermeture d'onglet, navigation programmatique via `useGuardedRouter`), un
 * dialog 3 boutons apparaît : Annuler / Quitter sans enregistrer / Enregistrer.
 *
 * Couverture :
 *  - `<a href="...">` / `<Link>` du même domaine → intercepté via listener
 *    capture sur `document` (gère sidebar, topbar, breadcrumbs, etc.)
 *  - Refresh / fermeture d'onglet → `beforeunload` natif (warning navigateur)
 *  - Navigation programmatique → `useGuardedRouter()` wrap `useRouter()`
 *
 * Non couvert (pour l'instant) :
 *  - Bouton retour navigateur (popstate) — patch complexe avec history.pushState
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// ── Types ────────────────────────────────────────────────────────────────────

type Guard = {
  id: string;
  dirty: boolean;
  isSaving: boolean;
  /** Sauvegarde + retourne true si succès. Si onSave non fourni, on bloque l'option "Enregistrer". */
  onSave?: () => Promise<boolean> | boolean;
};

type PendingNav = { kind: "link"; href: string } | { kind: "router"; run: () => void };

type ContextValue = {
  register: (g: Guard) => () => void;
  update: (id: string, patch: Partial<Omit<Guard, "id">>) => void;
  /**
   * Demande la permission de naviguer. Retourne true si on peut continuer
   * immédiatement (aucun guard dirty). Sinon retourne false et déclenche le
   * dialog ; la navigation sera exécutée si l'utilisateur confirme.
   */
  requestNavigation: (nav: PendingNav) => boolean;
};

const Ctx = React.createContext<ContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const guardsRef = React.useRef<Map<string, Guard>>(new Map());
  const [pending, setPending] = React.useState<PendingNav | null>(null);
  const [savingFromDialog, setSavingFromDialog] = React.useState(false);

  const hasDirtyGuard = React.useCallback(() => {
    for (const g of guardsRef.current.values()) {
      if (g.dirty) return true;
    }
    return false;
  }, []);

  const firstSavable = React.useCallback((): Guard | null => {
    for (const g of guardsRef.current.values()) {
      if (g.dirty && g.onSave) return g;
    }
    return null;
  }, []);

  // Enregistrement / désinscription des guards
  const register = React.useCallback<ContextValue["register"]>((g) => {
    guardsRef.current.set(g.id, g);
    return () => {
      guardsRef.current.delete(g.id);
    };
  }, []);

  const update = React.useCallback<ContextValue["update"]>((id, patch) => {
    const cur = guardsRef.current.get(id);
    if (!cur) return;
    guardsRef.current.set(id, { ...cur, ...patch });
  }, []);

  const requestNavigation = React.useCallback<ContextValue["requestNavigation"]>(
    (nav) => {
      if (!hasDirtyGuard()) return true;
      setPending(nav);
      return false;
    },
    [hasDirtyGuard],
  );

  // ── Listeners globaux ────────────────────────────────────────────────────
  // beforeunload : warning navigateur (refresh / close tab)
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasDirtyGuard()) return;
      e.preventDefault();
      // Most browsers ignore custom message but require setting it
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDirtyGuard]);

  // Capture des clics sur les <a> du même domaine
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // bouton gauche uniquement
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // ouverture nouvel onglet, etc.
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      // Liens externes ou cibles spéciales → on laisse passer
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // On ne traite que les hrefs internes (commencent par "/")
      // ou ayant le même origin.
      let internal = false;
      let path = href;
      if (href.startsWith("/") && !href.startsWith("//")) {
        internal = true;
      } else {
        try {
          const url = new URL(href, window.location.origin);
          if (url.origin === window.location.origin) {
            internal = true;
            path = url.pathname + url.search + url.hash;
          }
        } catch {
          internal = false;
        }
      }
      if (!internal) return;

      if (!hasDirtyGuard()) return;
      e.preventDefault();
      setPending({ kind: "link", href: path });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [hasDirtyGuard]);

  // ── Actions du dialog ────────────────────────────────────────────────────
  const router = useRouter();

  const performNav = React.useCallback(
    (nav: PendingNav) => {
      if (nav.kind === "link") {
        router.push(nav.href);
      } else {
        nav.run();
      }
    },
    [router],
  );

  const onCancel = React.useCallback(() => {
    setPending(null);
  }, []);

  const onDiscard = React.useCallback(() => {
    // Quitter sans enregistrer : on flush tous les guards à dirty=false
    // pour éviter le re-trigger durant la navigation.
    for (const g of guardsRef.current.values()) {
      guardsRef.current.set(g.id, { ...g, dirty: false });
    }
    const nav = pending;
    setPending(null);
    if (nav) performNav(nav);
  }, [pending, performNav]);

  const onSaveAndLeave = React.useCallback(async () => {
    const g = firstSavable();
    if (!g || !g.onSave) return;
    setSavingFromDialog(true);
    try {
      const ok = await g.onSave();
      if (!ok) return; // l'erreur est gérée par le composant qui sauvegarde
      // Marqué clean
      guardsRef.current.set(g.id, { ...g, dirty: false });
      const nav = pending;
      setPending(null);
      if (nav) performNav(nav);
    } finally {
      setSavingFromDialog(false);
    }
  }, [firstSavable, pending, performNav]);

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (!open) setPending(null);
  }, []);

  const canSave = React.useMemo(() => firstSavable() !== null, [firstSavable]);

  const value = React.useMemo<ContextValue>(
    () => ({ register, update, requestNavigation }),
    [register, update, requestNavigation],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={handleOpenChange}>
        <DialogContent showClose={false} className="max-w-md p-0">
          <div className="flex items-start gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <DialogTitle className="text-sm leading-tight font-semibold">
                Modifications non enregistrées
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[var(--muted-foreground)]">
                Vous avez des modifications en cours. Que souhaitez-vous faire&nbsp;?
              </DialogDescription>
            </div>
          </div>

          <div className="grid gap-2 px-5 pb-5">
            {canSave ? (
              <Button
                type="button"
                variant="accent"
                onClick={() => void onSaveAndLeave()}
                disabled={savingFromDialog}
                autoFocus
              >
                {savingFromDialog ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Enregistrement…
                  </>
                ) : (
                  "Enregistrer et quitter"
                )}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onDiscard} disabled={savingFromDialog}>
              Quitter sans enregistrer
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={savingFromDialog}>
              Annuler
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

// ── Hook principal ───────────────────────────────────────────────────────────

export type UseUnsavedChangesOptions = {
  /** True si la page contient des modifications non enregistrées. */
  dirty: boolean;
  /** Sauvegarde puis retourne true si succès. Optionnel — sans, le bouton "Enregistrer" est masqué. */
  onSave?: () => Promise<boolean> | boolean;
  /** True pendant une sauvegarde en cours (désactive les actions). */
  isSaving?: boolean;
};

export function useUnsavedChanges({ dirty, onSave, isSaving }: UseUnsavedChangesOptions) {
  const ctx = React.useContext(Ctx);
  const id = React.useId();
  // Garde la dernière référence à onSave pour ne pas re-register à chaque render
  const onSaveRef = React.useRef(onSave);
  React.useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Enregistre le guard une seule fois (par id stable)
  React.useEffect(() => {
    if (!ctx) return;
    const unregister = ctx.register({
      id,
      dirty: false,
      isSaving: false,
      onSave: onSaveRef.current ? () => onSaveRef.current!() : undefined,
    });
    return unregister;
  }, [ctx, id]);

  // Met à jour dirty / isSaving à chaque changement
  React.useEffect(() => {
    if (!ctx) return;
    ctx.update(id, { dirty, isSaving: !!isSaving });
  }, [ctx, id, dirty, isSaving]);
}

// ── Router gardé (pour les navigations programmatiques) ──────────────────────

export function useGuardedRouter() {
  const router = useRouter();
  const ctx = React.useContext(Ctx);

  const wrap = React.useCallback(
    <T extends (...args: never[]) => void>(fn: T): T => {
      return ((...args: Parameters<T>) => {
        const ok = ctx ? ctx.requestNavigation({ kind: "router", run: () => fn(...args) }) : true;
        if (ok) fn(...args);
      }) as T;
    },
    [ctx],
  );

  return React.useMemo(
    () => ({
      push: wrap(router.push.bind(router)),
      replace: wrap(router.replace.bind(router)),
      back: wrap(router.back.bind(router)),
      forward: wrap(router.forward.bind(router)),
      prefetch: router.prefetch.bind(router),
      refresh: router.refresh.bind(router),
    }),
    [router, wrap],
  );
}

// ── Helper bas-niveau (cas avancés) ──────────────────────────────────────────

export function useUnsavedChangesContext() {
  return React.useContext(Ctx);
}
