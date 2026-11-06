"use client";

/**
 * RemoteCursorsOverlay — curseurs des autres collaborateurs (Phase 3b).
 *
 * Rendu DANS le conteneur transformé (repère MONDE) du canvas : les curseurs
 * sont positionnés en coordonnées monde et suivent donc naturellement le
 * zoom/pan LOCAL de chaque client. Pour rester d'une taille ÉCRAN constante,
 * chaque curseur applique une contre-échelle `scale(1/zoom)` (le zoom courant
 * est passé en prop).
 *
 * Perf : le hook `useLiveCursors` mute les positions des pairs EN PLACE (pas
 * de re-render par mouvement). Cet overlay lit ces positions brutes dans une
 * boucle rAF et lisse l'affichage (lerp) en mutant directement le DOM — aucun
 * setState par frame. Le rAF ne tourne que s'il y a des pairs.
 *
 * DA sobre : petite flèche pleine à la couleur du pair + AVATAR (initiales
 * sur fond couleur, tooltip nom complet) — pas de nom entier, trop bavard sur
 * un canvas. Disparition douce (opacity) après 5 s sans mouvement.
 * `pointer-events: none` sur tout l'overlay.
 */

import { useEffect, useRef } from "react";
import { presenceInitials } from "@/components/presence/presence-provider";
import type { LiveCursorPeer } from "../hooks/use-live-cursors";

const LERP = 0.25;
const IDLE_HIDE_MS = 5000;
const FADE_MS = 600;

export function RemoteCursorsOverlay({
  peers,
  zoom,
}: {
  peers: Map<string, LiveCursorPeer>;
  zoom: number;
}) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const peersRef = useRef(peers);
  peersRef.current = peers;

  // Noeuds DOM par userId (refs de callback) + positions affichées lissées.
  const nodesRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const displayRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const rafRef = useRef<number | null>(null);

  // Le lerp ne tourne que s'il y a des pairs (perf).
  const hasPeers = peers.size > 0;

  useEffect(() => {
    if (!hasPeers) return;
    const tick = () => {
      const map = peersRef.current;
      const invScale = 1 / (zoomRef.current || 1);
      const now = Date.now();

      map.forEach((peer, id) => {
        const node = nodesRef.current.get(id);
        if (!node) return;

        if (peer.x == null || peer.y == null) {
          node.style.opacity = "0";
          return;
        }

        // Position affichée lissée (lerp vers la cible brute).
        let disp = displayRef.current.get(id);
        if (!disp) {
          disp = { x: peer.x, y: peer.y };
          displayRef.current.set(id, disp);
        } else {
          disp.x += (peer.x - disp.x) * LERP;
          disp.y += (peer.y - disp.y) * LERP;
        }

        node.style.transform = `translate(${disp.x}px, ${disp.y}px) scale(${invScale})`;

        // Disparition douce après inactivité.
        const idle = now - peer.lastMoveAt;
        const opacity =
          idle <= IDLE_HIDE_MS
            ? 1
            : Math.max(0, 1 - (idle - IDLE_HIDE_MS) / FADE_MS);
        node.style.opacity = String(opacity);
      });

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [hasPeers]);

  // Nettoyage des positions mémorisées des pairs disparus.
  useEffect(() => {
    const alive = new Set(peers.keys());
    displayRef.current.forEach((_, id) => {
      if (!alive.has(id)) displayRef.current.delete(id);
    });
    nodesRef.current.forEach((_, id) => {
      if (!alive.has(id)) nodesRef.current.delete(id);
    });
  }, [peers]);

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-40"
      style={{ width: 0, height: 0 }}
      aria-hidden
    >
      {Array.from(peers.values()).map((peer) => (
        <div
          key={peer.userId}
          ref={(el) => {
            nodesRef.current.set(peer.userId, el);
          }}
          className="absolute top-0 left-0"
          style={{
            transformOrigin: "0 0",
            opacity: 0,
            willChange: "transform, opacity",
            transition: "opacity 120ms linear",
          }}
        >
          {/* Flèche curseur — pleine à la couleur du pair, contour blanc. */}
          <svg
            width={16}
            height={16}
            viewBox="0 0 16 16"
            style={{ display: "block" }}
          >
            <path
              d="M1 1 L1 12 L4 9 L6.2 13.6 L8.2 12.7 L6 8.2 L10.5 8 Z"
              fill={peer.color}
              stroke="#ffffff"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
          {/* Avatar initiales (couleur du pair), décalé bas-droite — le nom
              complet reste accessible au survol (title). */}
          {peer.name && (
            <span
              title={peer.name}
              className="absolute flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] leading-none font-bold text-white ring-1 ring-white/80"
              style={{
                left: 11,
                top: 11,
                backgroundColor: peer.color,
              }}
            >
              {presenceInitials(peer.name)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
