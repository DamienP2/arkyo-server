"use client";

/**
 * RackViewStage — rendu AUTONOME d'une vue de contenant (FRONT / REAR /
 * REAR_INTERIOR / SIDE), à sa taille naturelle, hors de tout canvas.
 *
 * C'est la brique du composeur de mise en page de l'export : la même
 * instance sert d'aperçu à l'écran (mise à l'échelle par une transformation
 * CSS du parent) ET de source de capture pour le PDF. Pas de rendu « offscreen »
 * parallèle : ce que l'utilisateur compose est littéralement ce qui est
 * capturé, donc l'aperçu ne peut pas diverger du document.
 *
 * Deux précautions rendent ce montage sûr hors de l'éditeur :
 *  - `pointer-events: none` sur tout le contenu — les slots restent des
 *    composants interactifs (menu contextuel, drag), on les neutralise à la
 *    racine plutôt que de dupliquer une variante « lecture seule » ;
 *  - le composeur fournit UN `DndContext` sans capteur (cf. rack-export-composer) :
 *    `RackVisual` / `DraggableSlot` appellent `useDraggable` inconditionnellement
 *    et ont besoin d'un provider, mais aucun drag ne doit pouvoir démarrer.
 *
 * La capture vise `[data-rack-view-capture]`, posé sur le nœud INTERNE au
 * wrapper mis à l'échelle : html-to-image clone ce nœud sans les transformations
 * ancêtres, la capture est donc toujours à taille naturelle (même principe que
 * `[data-rack-capture]` dans le canvas).
 */

import { useEffect, useMemo, useState } from "react";

import { RackVisual } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/rack-visual";
import { SideRackVisual } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual";
import { CategoryColorCtx } from "@/components/synoptique/lib/colors";
import {
  FRONT_OUTER_W,
  RACK_BODY_W,
  RACK_DEPTH_DEFAULT,
  RACK_WIDTH_MM,
} from "@/components/synoptique/lib/constants";
import type { ViewId } from "@/components/synoptique/lib/types";
import { api, getApiErrorMessage } from "@/lib/api-client";

import type { RackCanvasData } from "../rack-tab-client";
import { RACK_EXPORT_VIEWS } from "./rack-export-layout";
import type { RackRenderMode } from "./rack-tab-left-toolbar";

/** Échelle px/mm de la vue côté — identique au canvas (`RackPlacementCanvas`). */
const PX_PER_MM = FRONT_OUTER_W / RACK_WIDTH_MM;
const SIDE_VIEW_SCALE = 0.55;

/** Ré-export : le mode de rendu est celui de la barre d'outils du canvas. */
export type { RackRenderMode };

// ── Chargement des données de contenant, mutualisé ───────────────────────────

type CanvasDataCache = {
  byRack: Record<string, RackCanvasData>;
  /** Nombre de contenants encore en attente. */
  loading: number;
  error: string | null;
};

/**
 * Cache au niveau MODULE, volontairement hors du cycle de vie des composants.
 *
 * Le `canvas-data` d'un contenant est une donnée lourde et stable le temps
 * d'une session d'export. L'indexer sur un `useRef` la rendait tributaire du
 * montage : un remontage du composeur — quelle qu'en soit la cause — remettait
 * les compteurs à zéro, relançait les requêtes, perdait les réponses en vol, et
 * la vue restait vide avec un spinner éternel.
 *
 * Ici, un remontage ne coûte plus rien : la donnée est déjà là et se lit
 * SYNCHRONEMENT au premier rendu. La déduplication des requêtes en vol
 * garantit en plus qu'un contenant demandé deux fois ne part qu'une fois sur
 * le réseau.
 */
const CANVAS_DATA = new Map<string, RackCanvasData>();
const CANVAS_DATA_INFLIGHT = new Map<string, Promise<RackCanvasData>>();

const cacheKey = (projectId: string, rackId: string) => `${projectId}:${rackId}`;

function loadCanvasData(
  projectId: string,
  rackId: string,
): Promise<RackCanvasData> {
  const k = cacheKey(projectId, rackId);
  const hit = CANVAS_DATA.get(k);
  if (hit) return Promise.resolve(hit);
  const inflight = CANVAS_DATA_INFLIGHT.get(k);
  if (inflight) return inflight;
  const p = api
    .get<RackCanvasData>(
      `/api/tenant/projects/${projectId}/racks/${rackId}/canvas-data`,
    )
    .then((data) => {
      CANVAS_DATA.set(k, data);
      return data;
    })
    .finally(() => {
      // L'échec n'est PAS mémorisé : rouvrir l'export doit pouvoir réessayer.
      CANVAS_DATA_INFLIGHT.delete(k);
    });
  CANVAS_DATA_INFLIGHT.set(k, p);
  return p;
}

/**
 * Amène en cache le `canvas-data` des contenants donnés, et n'en sort qu'une
 * fois tout arrivé.
 *
 * Réservé aux rendus HORS ÉCRAN, où l'on n'a personne à qui montrer une
 * attente : la scène du dossier n'affiche pas d'état de chargement, elle
 * mesure ce qu'elle rend. Tant que la donnée d'un contenant manque, son objet
 * n'a pas de taille, reste masqué, et le protocole d'attente ne peut pas
 * distinguer « pas encore chargé » de « ne se peindra jamais » — c'est ce qui
 * faisait échouer la planche au premier export de la session, le temps que la
 * requête revienne.
 *
 * Un contenant illisible ne fait pas échouer l'ensemble : la scène le rendra
 * en attente, et c'est le protocole d'attente qui tranchera.
 */
export async function preloadRackCanvasData(
  projectId: string,
  rackIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(rackIds)].filter(Boolean);
  if (ids.length === 0) return;
  await Promise.all(
    ids.map((id) => loadCanvasData(projectId, id).catch(() => null)),
  );
}

/**
 * Charge le `canvas-data` des contenants demandés, une seule fois chacun.
 *
 * Le composeur peut poser plusieurs vues du MÊME contenant : la donnée est
 * indexée par contenant, pas par vue. Le cache n'est jamais invalidé pendant
 * la session d'export — une composition doit être stable pendant qu'on la
 * manipule, un refetch à chaud ferait sauter les ratios sous le curseur.
 */
export function useRackCanvasData(
  projectId: string,
  rackIds: readonly string[],
): CanvasDataCache {
  const key = [...new Set(rackIds)].sort().join(",");

  /**
   * Lecture SYNCHRONE du cache module. C'est ce qui rend un remontage
   * indolore : au premier rendu de la nouvelle instance, la donnée déjà
   * chargée est là, sans effet ni requête.
   */
  const [byRack, setByRack] = useState<Record<string, RackCanvasData>>(() =>
    readCached(projectId, key),
  );
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;
    let alive = true;

    const cached = readCached(projectId, key);
    const missing = ids.filter(
      (id) => !CANVAS_DATA.has(cacheKey(projectId, id)),
    );
    if (Object.keys(cached).length > 0) {
      setByRack((prev) => mergeCanvasData(prev, cached));
    }
    if (missing.length === 0) return;

    setLoading((n) => n + missing.length);
    void Promise.all(
      missing.map((id) =>
        loadCanvasData(projectId, id)
          .then((data) => ({ id, data }))
          .catch((e: unknown) => {
            // Un contenant illisible ne doit pas emporter les autres : on
            // retient le message et on laisse la vue en attente.
            if (alive) setError(getApiErrorMessage(e));
            return null;
          }),
      ),
    ).then((results) => {
      // Abandonner ici est SANS DANGER, contrairement à avant : la donnée est
      // dans le cache module, la prochaine instance la lira au montage.
      if (!alive) return;
      const arrived: Record<string, RackCanvasData> = {};
      for (const r of results) if (r) arrived[r.id] = r.data;
      setByRack((prev) => mergeCanvasData(prev, arrived));
      setLoading((n) => Math.max(0, n - missing.length));
    });

    return () => {
      alive = false;
    };
  }, [projectId, key]);

  return { byRack, loading, error };
}

/** Contenants déjà en cache pour cette clé, sous forme indexée. */
function readCached(
  projectId: string,
  key: string,
): Record<string, RackCanvasData> {
  const out: Record<string, RackCanvasData> = {};
  if (!key) return out;
  for (const id of key.split(",")) {
    const hit = CANVAS_DATA.get(cacheKey(projectId, id));
    if (hit) out[id] = hit;
  }
  return out;
}

/** Fusion par VALEUR : rien de neuf, même objet — donc aucun rendu inutile. */
function mergeCanvasData(
  prev: Record<string, RackCanvasData>,
  arrived: Record<string, RackCanvasData>,
): Record<string, RackCanvasData> {
  const entries = Object.entries(arrived);
  if (entries.length === 0) return prev;
  if (entries.every(([id, data]) => prev[id] === data)) return prev;
  return { ...prev, ...arrived };
}

// ── Rendu d'une vue ──────────────────────────────────────────────────────────

/** Libellé d'une vue (« Avant », « Côté »…). */
export function viewLabel(view: ViewId): string {
  return RACK_EXPORT_VIEWS.find((v) => v.id === view)?.label ?? view;
}

const noop = () => {};

/**
 * Vue effective d'un contenant. Un contenant sans face arrière intérieure
 * affiche sa face ARRIÈRE quand « Arr. int. » est demandé — même règle que le
 * canvas par lieu (`viewForRack`) : la colonne reste présente dans le groupe.
 */
export function effectiveView(view: ViewId, rearInteriorGapMm: number | null | undefined): ViewId {
  return view === "REAR_INTERIOR" && rearInteriorGapMm == null ? "REAR" : view;
}

/**
 * Entête d'une vue — même grammaire que celle du canvas. Sur une planche qui
 * porte plusieurs contenants, une élévation sans nom n'est pas exploitable.
 *
 * Dans un groupe de lieu, la vue est portée une fois par le groupe : les
 * colonnes ne répètent que le nom du contenant, exactement comme le canvas par
 * lieu.
 */
function StageHeader({
  rackName,
  view,
}: {
  rackName: string;
  view: ViewId | null;
}) {
  return (
    <p className="mb-3 truncate text-xs font-semibold tracking-wider text-[var(--foreground)] uppercase">
      {rackName}
      {view && (
        <span className="text-[var(--muted-foreground)]">
          {" · "}
          {viewLabel(view)}
        </span>
      )}
    </p>
  );
}

export function RackViewStage({
  data,
  view,
  renderMode = "standard",
  showInfo = false,
  captureId,
  showViewInHeader = true,
  headerOverride = null,
}: {
  data: RackCanvasData;
  view: ViewId;
  renderMode?: RackRenderMode;
  /** Mode « schéma » du canvas (viewMode === "schema"). */
  showInfo?: boolean;
  /**
   * Marqueur de capture posé sur le nœud à taille naturelle. `null` pour une
   * colonne interne à un groupe : c'est le GROUPE qui est capturé d'un bloc.
   */
  captureId: string | null;
  /** `false` dans un groupe de lieu — la vue est portée par le groupe. */
  showViewInHeader?: boolean;
  /**
   * Remplace l'entête. Utilisé par les colonnes d'un groupe de VUES, où c'est
   * la vue qui distingue les colonnes, le contenant étant porté par le groupe.
   */
  headerOverride?: string | null;
}) {
  const { rack } = data;
  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const parent of data.categories ?? []) {
      for (const child of parent.children ?? []) m[child.name] = parent.color;
      m[parent.name] = parent.color;
    }
    return m;
  }, [data.categories]);

  const sideInnerW = Math.max(
    60,
    Math.round((rack.depthMm ?? RACK_DEPTH_DEFAULT) * PX_PER_MM * SIDE_VIEW_SCALE),
  );

  // Vue réellement rendue : « Arr. int. » retombe sur l'arrière si ce
  // contenant n'a pas de dégagement (même règle que le canvas par lieu).
  const shown = effectiveView(view, rack.rearInteriorGapMm);
  const headerName = headerOverride ?? rack.name;
  const headerView = headerOverride ? null : showViewInHeader ? shown : null;

  return (
    <div
      {...(captureId ? { "data-rack-view-capture": captureId } : {})}
      // Fond transparent : les objets se chevauchent parfois, et le cartouche
      // est composité par-dessus. Une boîte blanche masquerait les deux.
      className="inline-block bg-transparent"
      style={{ pointerEvents: "none" }}
    >
      <CategoryColorCtx.Provider value={catColorMap}>
        {shown === "SIDE" ? (
          <div style={{ width: "max-content" }}>
            {/* `width: 0` + `min-width: 100%` : l'entête occupe la largeur
                imposée par la vue sans jamais l'élargir. Sans ça, un nom de
                contenant long dilaterait la boîte — et donc le ratio de la
                vue, qui est mesuré sur ce nœud. */}
            <div style={{ width: 0, minWidth: "100%" }}>
              <StageHeader rackName={headerName} view={headerView} />
            </div>
            <SideRackVisual
              rack={rack}
              slots={rack.slots}
              innerW={sideInnerW}
              patchPanelDepthMm={data.patchPanelDepthMm}
              cableSafetyDepthMm={data.cableSafetyDepthMm}
            />
          </div>
        ) : (
          <div style={{ width: RACK_BODY_W }}>
            <StageHeader rackName={headerName} view={headerView} />
            <RackVisual
              rack={rack}
              slots={rack.slots}
              view={shown}
              showInfo={showInfo}
              renderMode={renderMode}
              // Aucune interaction : la scène est un rendu, pas un éditeur.
              onRemoveSlot={noop}
              selectedEquipment={null}
              onTapPlace={noop}
              isDragging={false}
            />
          </div>
        )}
      </CategoryColorCtx.Provider>
    </div>
  );
}

/** Espace entre deux colonnes d'un groupe — identique au canvas par lieu. */
const LOCATION_COLUMN_GAP = 40;

/**
 * Emplacement vide — un objet posé mais pas encore configuré. Il a une taille
 * NATURELLE arbitraire mais fixe : sans elle, la mécanique de mesure du
 * composeur (qui déduit le ratio du rendu) n'aurait rien à mesurer et l'objet
 * resterait invisible. Proportion d'une élévation courante, pour que la place
 * réservée ressemble à ce qui viendra.
 */
export function PlaceholderStage() {
  return (
    <div
      className="inline-block bg-transparent"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="flex items-center justify-center rounded-lg border-2 border-dashed"
        style={{
          width: 320,
          height: 640,
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--foreground) 3%, transparent)",
        }}
      >
        <span className="text-xs font-medium text-[var(--muted-foreground)]">
          À configurer
        </span>
      </div>
    </div>
  );
}

/**
 * RackViewsStage — un CONTENANT sous plusieurs vues, côte à côte.
 *
 * Même grammaire de groupe que le lieu, axes intervertis : le lieu déploie
 * N contenants sous UNE vue, le contenant déploie UNE cible sous N vues.
 * L'entête du groupe porte donc le nom du contenant, chaque colonne sa vue.
 *
 * Une seule vue → rendu simple, sans entête de groupe : c'est le cas courant,
 * il ne doit pas payer une ligne de titre supplémentaire.
 */
export function RackViewsStage({
  data,
  views,
  renderMode = "standard",
  showInfo = false,
  captureId,
  label,
}: {
  data: RackCanvasData;
  views: ViewId[];
  renderMode?: RackRenderMode;
  showInfo?: boolean;
  captureId: string;
  /** Libellé saisi — remplace l'entête automatique quand il est présent. */
  label?: string;
}) {
  if (views.length <= 1) {
    return (
      <RackViewStage
        data={data}
        view={views[0] ?? "FRONT"}
        renderMode={renderMode}
        showInfo={showInfo}
        captureId={captureId}
        headerOverride={label ?? null}
      />
    );
  }
  return (
    <div
      data-rack-view-capture={captureId}
      className="inline-block bg-transparent"
      style={{ pointerEvents: "none" }}
    >
      <div style={{ width: "max-content" }}>
        <div style={{ width: 0, minWidth: "100%" }}>
          <StageHeader rackName={label ?? data.rack.name} view={null} />
        </div>
        <div className="flex items-start" style={{ gap: LOCATION_COLUMN_GAP }}>
          {views.map((view) => (
            <div key={view} className="shrink-0">
              <RackViewStage
                data={data}
                view={view}
                renderMode={renderMode}
                showInfo={showInfo}
                captureId={null}
                headerOverride={viewLabel(effectiveView(view, data.rack.rearInteriorGapMm))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * LocationViewStage — un LIEU rendu comme UN objet : ses contenants rackables
 * côte à côte, dans l'ordre de l'inventaire, alignés en haut. Même grammaire
 * que l'affichage par lieu de l'onglet Rack (`LocationPlacementCanvas`) :
 * colonnes espacées de `LOCATION_COLUMN_GAP`, entête = nom du contenant.
 *
 * La capture vise le CONTENEUR : le groupe est une seule image sur la page,
 * donc un seul objet à déplacer et à redimensionner. Un contenant ajouté au
 * lieu apparaît au prochain montage de l'éditeur — la composition ne stocke
 * que l'identifiant du lieu, jamais la liste de ses racks.
 */
export function LocationViewStage({
  racks,
  view,
  locationName,
  renderMode = "standard",
  showInfo = false,
  captureId,
  label,
}: {
  /** Contenants du lieu, dans l'ordre d'affichage. */
  racks: RackCanvasData[];
  view: ViewId;
  locationName: string;
  renderMode?: RackRenderMode;
  showInfo?: boolean;
  captureId: string;
  /** Libellé saisi — remplace l'entête automatique quand il est présent. */
  label?: string;
}) {
  return (
    <div
      data-rack-view-capture={captureId}
      className="inline-block bg-transparent"
      style={{ pointerEvents: "none" }}
    >
      <div style={{ width: "max-content" }}>
        <div style={{ width: 0, minWidth: "100%" }}>
          {label ? (
            <StageHeader rackName={label} view={null} />
          ) : (
            <StageHeader rackName={locationName} view={view} />
          )}
        </div>
        <div
          className="flex items-start"
          style={{ gap: LOCATION_COLUMN_GAP }}
        >
          {racks.map((data) => (
            <div key={data.rack.id} className="shrink-0">
              <RackViewStage
                data={data}
                view={view}
                renderMode={renderMode}
                showInfo={showInfo}
                captureId={null}
                showViewInHeader={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
