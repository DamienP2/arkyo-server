"use client";

/**
 * Coquille « Concevoir » de l'interface Strata v2 (spec v2 §4.1), rendue par
 * `EditorShell` en Strata avec les mêmes emplacements (`EditorShellSlots`) :
 *   - topbar projet (46 px) : le slot `globalTopbar` (topbar projet v2) ;
 *   - canevas sur toute la surface ;
 *   - barre d'outils flottante en haut au centre : le sélecteur de mode
 *     (`Synoptique` · `Racks` · `Plan`…, onglets de l'éditeur projet), la
 *     barre contextuelle existante repliée dans le menu « Options de la vue »
 *     (toujours montée, masquée quand il est fermé), puis le `leftToolbar`
 *     existant, mis à plat. En mode Racks, l'élévation commence sous la
 *     barre (le cadrage du canevas ne passe pas dessous) ;
 *   - panneau latéral existant (`leftSidePanel`), flottant à gauche ;
 *   - bandeau de validation sous la barre d'outils (synoptique) ;
 *   - tiroir à droite (360-420 px) : `strata.drawerTop` au-dessus du
 *     `rightPanel` existant. Fermé par défaut ; un bouton l'ouvre, la croix ou
 *     Échap le ferment, `useStrataDrawer().requestOpen(clé)` l'ouvre sur une
 *     nouvelle sélection. Le contenu reste monté quand il est fermé ;
 *   - volet (`slideOver`) quand le store l'ouvre, à gauche du tiroir.
 *
 * Mode `page` (`strata.mode`, pages défilantes : Inventaire, Préparation…) :
 * outils et barre contextuelle dans une bande au-dessus du contenu, panneau
 * latéral en colonne, rien en surimpression du contenu.
 *
 * `?space=gerer` : l'espace Gérer (`ManageShell`) est rendu par l'éditeur
 * projet à la place de l'onglet ; une coquille montée malgré tout ne monte
 * pas son canevas (zone vide).
 *
 * Bascule Classique ↔ Strata en direct (Review Focus 1) : `useCanvasStage`,
 * appelé par `EditorShell` dans les deux interfaces, rend le canevas une seule
 * fois, par un portail, dans un hôte DOM qui lui appartient. Chaque
 * disposition accueille cet hôte (en Classique, il EST le conteneur
 * `relative flex-1 overflow-hidden` d'arkyo, à la même place) : le canevas
 * n'est jamais remonté, sa vue et son état serveur survivent à la bascule.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { UNSAFE_LocationContext } from "react-router";
import type { EditorShellSlots } from "@/components/editor-shell/editor-shell";
import { useWorkspace } from "@/components/editor-shell/hooks/use-workspace";
import { SHELL_LEFT_SIDE_PANEL_W, SHELL_SLIDEOVER_W, SHELL_TOPBAR_CTX_H } from "@/components/synoptique/lib/constants";
import { ChevronDown, PanelLeft, SlidersHorizontal, X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { UiInterface } from "../interface-context";
import { ModeSwitch, useConcevoirMode } from "./mode-switch";
import { spaceOf, useProjectSpace } from "./space-switch";
import { ValidationBanner } from "./validation-banner";

/** Hauteur de la topbar Strata (`--topbar-height` de `[data-interface="strata"]`). */
export const STRATA_TOPBAR_H = 46;

/** Largeur du tiroir (spec v2 §4.1 : 360 à 420 px). */
const DRAWER_W = "clamp(360px, 30vw, 420px)";

/** Haut du canevas en mode Racks : sous la barre d'outils flottante (12 + 42 px, plus une marge). */
const RACK_STAGE = "absolute inset-x-0 bottom-0 top-[60px]";

/** Conteneur du canevas d'`EditorShell` en Classique (arkyo). */
const CLASSIC_CANVAS = "relative flex-1 overflow-hidden";
const STRATA_CANVAS = "relative h-full w-full overflow-hidden";

export const SHELL_TOP = "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))";

/**
 * Barres d'outils verticales d'arkyo (`LeftToolbar`, `InventaireLeftToolbar`,
 * `RackTabLeftToolbar`) mises à plat dans la barre flottante, par leur seule
 * structure (aucune classe d'arkyo) : la racine et ses groupes passent en
 * ligne ; les filets (`div` vides `aria-hidden`) deviennent verticaux ; les
 * titres de groupe (« Vues », « Zoom » : `div` de texte seul, sans `title`,
 * contrairement au pourcentage de zoom) sont masqués.
 *
 * Quand la topbar affiche l'état d'enregistrement, le badge de
 * `ProjectContextualTopbar` est masqué : seule cette barre a pour racine un
 * `div` qui commence par son liseré (`span` `aria-hidden`) et finit par le
 * badge (`span` à pictogramme).
 */
const SHELL_CSS = `
[data-strata-tools] > div { flex-direction: row; align-items: center; height: auto; padding: 0; gap: 2px; }
[data-strata-tools] > div > div { flex-direction: row; align-items: center; margin-top: 0; gap: 2px; }
[data-strata-tools] > div > div > div[aria-hidden]:empty { width: 1px; height: 22px; margin: 0 5px; }
[data-strata-tools] > div > div > div:not([aria-hidden]):not([title]):not(:has(*)) { display: none; }
[data-strata-canvas-shell]:has([data-strata-save]) [data-zone="contextual"] div:has(> span[aria-hidden]:first-child) > span:last-child:not([aria-hidden]):has(> svg) { display: none; }
`;

// ── Tiroir ──────────────────────────────────────────────────────────────────

export type StrataDrawer = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /**
   * Sélection courante (`null` : aucune). Une clé nouvelle ouvre le tiroir ;
   * la même clé ne le rouvre pas après une fermeture manuelle.
   */
  requestOpen: (key: string | null) => void;
};

function useDrawerState(): StrataDrawer {
  const [state, setState] = useState<{ open: boolean; key: string | null }>({ open: false, key: null });
  const setOpen = useCallback((open: boolean) => setState((s) => (s.open === open ? s : { ...s, open })), []);
  const requestOpen = useCallback(
    (key: string | null) =>
      setState((s) => (key === s.key ? s : { key, open: key === null ? s.open : true })),
    [],
  );
  return useMemo(() => ({ open: state.open, setOpen, requestOpen }), [state.open, setOpen, requestOpen]);
}

type Stage = {
  drawer: StrataDrawer;
  /** Accueille l'hôte du canevas (disposition Strata). */
  attach: (el: HTMLElement | null) => void;
};

const StageContext = createContext<Stage | null>(null);

const NO_DRAWER: StrataDrawer = { open: false, setOpen: () => {}, requestOpen: () => {} };

/** Tiroir de la coquille Strata (sans effet hors de l'interface Strata). */
export function useStrataDrawer(): StrataDrawer {
  return useContext(StageContext)?.drawer ?? NO_DRAWER;
}

// ── Canevas stable (bascule Classique ↔ Strata) ─────────────────────────────

export type CanvasStage = {
  /** Disposition (Classique ou Strata) suivie du portail du canevas. */
  wrap: (layout: ReactNode) => ReactNode;
  /** Classique : rangée `flex` d'`EditorShell`, où l'hôte prend la place du conteneur du canevas. */
  classicRow: (el: HTMLDivElement | null) => void;
};

/**
 * En Classique, l'hôte du canevas est le 3ᵉ enfant de la rangée, après les
 * colonnes gauches présentes. React ne connaît pas l'hôte : une colonne gauche
 * qui apparaît est insérée après lui ; elle est remise à sa place (jamais
 * l'hôte, pour ne pas déplacer le canevas).
 */
function placeClassic(row: HTMLElement, host: HTMLElement, leftCount: number) {
  if (host.className !== CLASSIC_CANVAS) host.className = CLASSIC_CANVAS;
  const kids = Array.from(row.children).filter((k) => k !== host);
  if (host.parentNode !== row) {
    row.insertBefore(host, kids[leftCount] ?? null);
    return;
  }
  for (let i = 0; i < Math.min(leftCount, kids.length); i++) {
    if (host.compareDocumentPosition(kids[i]) & Node.DOCUMENT_POSITION_FOLLOWING) row.insertBefore(kids[i], host);
  }
  for (let i = kids.length - 1; i >= leftCount; i--) {
    if (host.compareDocumentPosition(kids[i]) & Node.DOCUMENT_POSITION_PRECEDING) row.insertBefore(kids[i], host.nextSibling);
  }
}

/**
 * Canevas d'`EditorShell` monté une fois pour toutes dans un hôte DOM stable
 * (portail), et état du tiroir : appelé par `EditorShell` dans les deux
 * interfaces, pour que la bascule ne remonte ni l'un ni l'autre.
 */
export function useCanvasStage(slots: EditorShellSlots, ui: UiInterface): CanvasStage {
  const [host] = useState(() => document.createElement("div"));
  const row = useRef<HTMLDivElement | null>(null);
  const leftCount = (slots.leftToolbar ? 1 : 0) + (slots.leftSidePanel ? 1 : 0);
  const left = useRef(leftCount);
  left.current = leftCount;
  const drawer = useDrawerState();

  // La rangée est attachée avant les effets du canevas (portail rendu après
  // elle) : le canevas mesure un hôte déjà en place.
  const classicRow = useCallback(
    (el: HTMLDivElement | null) => {
      row.current = el;
      if (el) placeClassic(el, host, left.current);
    },
    [host],
  );
  const attach = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      host.className = STRATA_CANVAS;
      if (host.parentNode !== el) el.appendChild(host);
    },
    [host],
  );

  useLayoutEffect(() => {
    if (ui === "classique" && row.current) placeClassic(row.current, host, leftCount);
  });

  // Espace Gérer (Strata, `?space=gerer`) : le canevas n'est pas monté (ni ses
  // raccourcis clavier ni ses mesures) ; il l'est de nouveau au retour dans
  // Concevoir. Contexte de l'URL lu sans exiger de routeur (EditorShell seul).
  const location = useContext(UNSAFE_LocationContext)?.location;
  const gerer = ui === "strata" && spaceOf(new URLSearchParams(location?.search ?? "")) === "gerer";

  const stage = useMemo<Stage>(() => ({ drawer, attach }), [drawer, attach]);
  const portal = gerer ? null : createPortal(slots.canvas, host);
  const wrap = (layout: ReactNode) => (
    <StageContext.Provider value={stage}>
      {layout}
      {portal}
    </StageContext.Provider>
  );
  return { wrap, classicRow };
}

// ── Disposition ─────────────────────────────────────────────────────────────

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el?.tagName && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
const inLayer = (t: EventTarget | null) =>
  !!(t as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');

const FLOAT = "rounded-[10px] border border-[var(--border)] bg-[var(--card)] shadow-lg";
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors outline-none hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Barre contextuelle existante, repliée dans un menu (toujours montée). */
function ViewOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest?.("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };
    // Échap ferme le menu, et lui seul (le tiroir reste ouvert) : écouté avant
    // le tiroir (capture), il consomme la touche.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || inLayer(e.target)) return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium whitespace-nowrap text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          open && "bg-[var(--muted)]",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        Options de la vue
        <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </button>
      <div
        id={id}
        role="group"
        aria-label="Options de la vue"
        data-zone="contextual"
        hidden={!open}
        style={{ height: SHELL_TOPBAR_CTX_H }}
        className={cn(
          "absolute top-full -left-1 mt-2.5 w-[min(760px,calc(100vw-48px))] overflow-x-auto",
          FLOAT,
        )}
      >
        {children}
      </div>
    </div>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-[22px] w-px shrink-0 bg-[var(--border)]" />;

/** Le `leftToolbar` existant, mis à plat (`SHELL_CSS`). */
function Tools({ children }: { children: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Outils" data-strata-tools="" className="flex items-center">
      {children}
    </div>
  );
}

function Drawer({ slots, drawer }: { slots: EditorShellSlots; drawer: StrataDrawer }) {
  return (
    <aside
      aria-label="Inspecteur"
      data-zone="drawer"
      hidden={!drawer.open}
      style={{ width: DRAWER_W }}
      className="absolute top-0 right-0 bottom-0 z-30 flex flex-col border-l border-[var(--border-strong)] bg-[var(--card)] shadow-xl"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-[var(--border)] pr-1.5 pl-3.5">
        <span className="flex-1 text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          Inspecteur
        </span>
        <button
          type="button"
          onClick={() => drawer.setOpen(false)}
          aria-label="Fermer l'inspecteur"
          title="Fermer (Échap)"
          className={ICON_BTN}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {slots.strata?.drawerTop && (
        <div className="max-h-[60%] flex-none overflow-y-auto border-b border-[var(--border)] empty:hidden">
          {slots.strata.drawerTop}
        </div>
      )}
      {slots.rightPanel && <div className="min-h-0 flex-1 overflow-hidden">{slots.rightPanel}</div>}
    </aside>
  );
}

/** Gérer est rendu par l'éditeur projet (`ManageShell`) : ici, ni canevas ni outils. */
function ManageZone() {
  return <main data-zone="manage" className="min-h-0 flex-1" />;
}

export function StrataCanvasShell(slots: EditorShellSlots) {
  const stage = useContext(StageContext);
  const localDrawer = useDrawerState();
  const drawer = stage?.drawer ?? localDrawer;
  const space = useProjectSpace();
  const concevoirMode = useConcevoirMode();
  const slideOverOpen = useWorkspace((s) => s.slideOver);
  const mode = slots.strata?.mode ?? "canvas";
  const hasDrawer = !!slots.rightPanel || !!slots.strata?.drawerTop;
  const drawerOpen = hasDrawer && drawer.open;

  // Échap ferme le tiroir (hors saisie, dialogues et menus, qui la gardent).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTyping(e.target) || inLayer(e.target)) return;
      drawer.setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, drawer]);

  // Hors `EditorShell` (pas d'hôte stable) : le canevas est rendu sur place.
  const canvasZone = (className: string) => (
    <div data-zone="canvas" ref={stage?.attach} className={className}>
      {!stage && slots.canvas}
    </div>
  );

  const hasTools = !!slots.leftToolbar || !!slots.contextualTopbar;
  // Page : le bouton du tiroir est dans la bande d'outils, pas sur le contenu.
  const toggleInStrip = mode === "page" && hasTools;

  const toggle = (className: string) => (
    <button
      type="button"
      onClick={() => drawer.setOpen(true)}
      aria-label="Ouvrir l'inspecteur"
      aria-expanded={false}
      title="Inspecteur"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-3 text-[12.5px] font-medium text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        className,
      )}
    >
      <PanelLeft className="h-4 w-4 -scale-x-100 text-[var(--muted-foreground)]" />
      Inspecteur
    </button>
  );

  const drawerParts = (
    <>
      {hasDrawer && !drawerOpen && !toggleInStrip && toggle(cn("absolute top-3 right-3 z-20 h-10", FLOAT))}
      {hasDrawer && <Drawer slots={slots} drawer={drawer} />}
      {slideOverOpen && slots.slideOver && (
        <div
          data-zone="slideover"
          style={{ width: SHELL_SLIDEOVER_W, right: "var(--dwo)" }}
          className="absolute top-0 bottom-0 z-30 border-l border-[var(--border)] bg-[var(--card)] shadow-xl"
        >
          {slots.slideOver}
        </div>
      )}
    </>
  );

  const stageStyle = { "--dwo": drawerOpen ? DRAWER_W : "0px" } as CSSProperties;

  let body: ReactNode;
  if (space === "gerer") {
    body = <ManageZone />;
  } else if (mode === "page") {
    body = (
      <>
        {hasTools && (
          <div
            data-zone="tools"
            style={{ height: SHELL_TOPBAR_CTX_H }}
            className="flex flex-none items-center gap-1 border-b border-[var(--border)] bg-[var(--card)] px-2"
          >
            {slots.leftToolbar && <Tools>{slots.leftToolbar}</Tools>}
            {slots.leftToolbar && slots.contextualTopbar && <Sep />}
            {slots.contextualTopbar && (
              <div data-zone="contextual" className="h-full min-w-0 flex-1">
                {slots.contextualTopbar}
              </div>
            )}
            {!slots.contextualTopbar && <div className="flex-1" />}
            {hasDrawer && !drawerOpen && toggleInStrip && (
              <>
                <Sep />
                {toggle("h-8 rounded-[7px]")}
              </>
            )}
          </div>
        )}
        <div data-zone="stage" style={stageStyle} className="relative flex min-h-0 flex-1 overflow-hidden">
          {slots.leftSidePanel && (
            <aside
              aria-label="Panneau latéral"
              style={{ width: SHELL_LEFT_SIDE_PANEL_W }}
              className="flex-none overflow-hidden border-r border-[var(--border)] bg-[var(--card)]"
            >
              {slots.leftSidePanel}
            </aside>
          )}
          {canvasZone("relative min-w-0 flex-1 overflow-hidden")}
          {drawerParts}
        </div>
      </>
    );
  } else {
    body = (
      <div data-zone="stage" style={stageStyle} className="relative min-h-0 flex-1 overflow-hidden">
        {canvasZone(concevoirMode === "rack" ? RACK_STAGE : "absolute inset-0")}
        {(hasTools || concevoirMode) && (
          <div
            data-zone="tools"
            style={{ left: "calc((100% - var(--dwo)) / 2)" }}
            className={cn("absolute top-3 z-[25] flex -translate-x-1/2 items-center gap-0.5 p-1", FLOAT)}
          >
            {concevoirMode && <ModeSwitch mode={concevoirMode} />}
            {concevoirMode && hasTools && <Sep />}
            {slots.contextualTopbar && <ViewOptions>{slots.contextualTopbar}</ViewOptions>}
            {slots.leftToolbar && slots.contextualTopbar && <Sep />}
            {slots.leftToolbar && <Tools>{slots.leftToolbar}</Tools>}
          </div>
        )}
        {slots.leftSidePanel && (
          <aside
            aria-label="Panneau latéral"
            style={{ width: SHELL_LEFT_SIDE_PANEL_W }}
            className={cn("absolute top-[60px] bottom-3 left-3 z-20 overflow-hidden", FLOAT)}
          >
            {slots.leftSidePanel}
          </aside>
        )}
        <ValidationBanner />
        {drawerParts}
      </div>
    );
  }

  return (
    <div
      data-strata-canvas-shell=""
      className="fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      style={{ top: SHELL_TOP }}
    >
      <style>{SHELL_CSS}</style>
      <div data-zone="topbar" style={{ height: STRATA_TOPBAR_H }} className="flex-none border-b border-[var(--border)]">
        {slots.globalTopbar}
      </div>
      {body}
    </div>
  );
}
