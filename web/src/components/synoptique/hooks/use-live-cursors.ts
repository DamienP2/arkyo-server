"use client";

/**
 * use-live-cursors — curseurs live + sélections distantes (Phase 3b).
 *
 * Ce hook ouvre UNE connexion WebSocket par salle (`room`) vers le service
 * temps réel dédié (process Node `ws`, port 3001 en dev, routé `/realtime`
 * en prod). Il gère : obtention d'un ticket signé court TTL, connexion,
 * `join`, réception des pairs / curseurs / sélections, et reconnexion avec
 * backoff. Tout est en try/catch silencieux — les curseurs ne doivent JAMAIS
 * casser l'éditeur : si le serveur WS est absent (pas lancé en dev), l'échec
 * est silencieux avec un retry léger.
 *
 * Contrat backend (fixé) :
 *   - POST /api/realtime/ticket → { ticket } (session tenant requise, TTL 60 s).
 *   - URL WS : NEXT_PUBLIC_REALTIME_URL sinon dérivée de location.
 *   - Envoi : { t:"join", room } · { t:"cursor", x, y } (coords MONDE, throttle
 *     ~30 Hz = 33 ms) · { t:"selection", ids }.
 *   - Réception : { t:"peers", members } · { t:"joined", userId, name, color } ·
 *     { t:"left", userId } · { t:"cursor", userId, x, y } ·
 *     { t:"selection", userId, ids }. Le serveur n'écho JAMAIS ses propres msgs.
 *
 * Modèle d'état (perf) :
 *   - `peersRef` = Map mutable des pairs (source de vérité live).
 *   - `peers` = état React reconstruit (nouvelle Map) UNIQUEMENT sur les
 *     changements structurels (join / left / sélection) — jamais par mouvement
 *     de curseur. Les positions (x/y/lastMoveAt) sont MUTÉES en place dans les
 *     objets pairs partagés entre `peersRef` et `peers` : l'overlay lit ces
 *     positions brutes dans sa boucle rAF et fait le lissage (lerp). Aucun
 *     setState n'est déclenché par un mousemove distant.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export type LiveCursorPeer = {
  userId: string;
  name: string;
  color: string;
  /** Dernière position MONDE reçue (null tant qu'aucun curseur reçu). */
  x: number | null;
  y: number | null;
  /** Timestamp (ms) du dernier message curseur — pilote la disparition. */
  lastMoveAt: number;
  /** Ids des éléments sélectionnés par ce pair (halo distant). */
  selectionIds: string[];
};

type ServerMember = { userId: string; name: string; color: string };

type ServerMessage =
  | { t: "peers"; members: ServerMember[] }
  | { t: "joined"; userId: string; name: string; color: string }
  | { t: "left"; userId: string }
  | { t: "cursor"; userId: string; x: number; y: number }
  | { t: "selection"; userId: string; ids: string[] };

export type UseLiveCursors = {
  /** Pairs présents dans la salle (hors soi-même — le serveur ne s'écho pas). */
  peers: Map<string, LiveCursorPeer>;
  /** Envoie sa position MONDE (throttle 33 ms intégré, leading + trailing). */
  sendCursor: (x: number, y: number) => void;
  /** Envoie sa sélection (uniquement si différente du dernier envoi). */
  sendSelection: (ids: string[]) => void;
};

export type UseLiveCursorsOptions = {
  /** Désactive tout le cycle (aucune connexion). Défaut : true. */
  enabled?: boolean;
};

// ── Constantes ─────────────────────────────────────────────────────────────

const CURSOR_THROTTLE_MS = 33; // ~30 Hz
const BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000];
// arkyo-server: temps réel en phase 7
const REALTIME_AVAILABLE = false as boolean;

// ── URL WS ─────────────────────────────────────────────────────────────────

function realtimeBaseUrl(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss://" : "ws://";
  return proto + window.location.host + "/realtime";
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useLiveCursors(
  room: string | null,
  opts?: UseLiveCursorsOptions,
): UseLiveCursors {
  const enabled = opts?.enabled ?? true;

  // Source de vérité mutable + état structurel React.
  const peersRef = useRef<Map<string, LiveCursorPeer>>(new Map());
  const [peers, setPeers] = useState<Map<string, LiveCursorPeer>>(
    () => new Map(),
  );

  // Reconstruit l'état React à partir du ref (changement structurel).
  const bumpStructural = useCallback(() => {
    setPeers(new Map(peersRef.current));
  }, []);

  // Connexion courante + garde-fous.
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedRef = useRef(false); // démontage / room null → ne pas reconnecter

  // Envoi curseur throttlé (leading + trailing).
  const lastCursorSentAtRef = useRef(0);
  const trailingTimerRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);

  // Dernière sélection envoyée (dédup).
  const lastSelectionSentRef = useRef<string>("");

  // ── Envoi bas niveau ──────────────────────────────────────────────────
  const rawSend = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // silencieux — la reconnexion prendra le relais.
    }
  }, []);

  const flushCursor = useCallback(() => {
    const p = pendingCursorRef.current;
    if (!p) return;
    pendingCursorRef.current = null;
    lastCursorSentAtRef.current = Date.now();
    rawSend({ t: "cursor", x: p.x, y: p.y });
  }, [rawSend]);

  const sendCursor = useCallback(
    (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      pendingCursorRef.current = { x, y };
      const now = Date.now();
      const elapsed = now - lastCursorSentAtRef.current;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        // leading
        if (trailingTimerRef.current != null) {
          window.clearTimeout(trailingTimerRef.current);
          trailingTimerRef.current = null;
        }
        flushCursor();
      } else if (trailingTimerRef.current == null) {
        // trailing — dernière position envoyée à la fin de la fenêtre
        trailingTimerRef.current = window.setTimeout(() => {
          trailingTimerRef.current = null;
          flushCursor();
        }, CURSOR_THROTTLE_MS - elapsed);
      }
    },
    [flushCursor],
  );

  const sendSelection = useCallback(
    (ids: string[]) => {
      const key = ids.join(",");
      if (key === lastSelectionSentRef.current) return;
      lastSelectionSentRef.current = key;
      rawSend({ t: "selection", ids });
    },
    [rawSend],
  );

  // ── Réception ──────────────────────────────────────────────────────────
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;
      const map = peersRef.current;

      switch (msg.t) {
        case "peers": {
          if (!Array.isArray(msg.members)) return;
          const next = new Map<string, LiveCursorPeer>();
          for (const m of msg.members) {
            if (!m || typeof m.userId !== "string") continue;
            // Préserve l'objet existant (position live) si le pair est déjà là.
            const prev = map.get(m.userId);
            next.set(
              m.userId,
              prev ?? {
                userId: m.userId,
                name: m.name ?? "",
                color: m.color ?? "#64748b",
                x: null,
                y: null,
                lastMoveAt: 0,
                selectionIds: [],
              },
            );
          }
          peersRef.current = next;
          bumpStructural();
          return;
        }
        case "joined": {
          if (typeof msg.userId !== "string") return;
          if (!map.has(msg.userId)) {
            map.set(msg.userId, {
              userId: msg.userId,
              name: msg.name ?? "",
              color: msg.color ?? "#64748b",
              x: null,
              y: null,
              lastMoveAt: 0,
              selectionIds: [],
            });
            bumpStructural();
          }
          return;
        }
        case "left": {
          if (typeof msg.userId !== "string") return;
          if (map.delete(msg.userId)) bumpStructural();
          return;
        }
        case "cursor": {
          const peer = map.get(msg.userId);
          if (!peer) return; // pair inconnu (avant join) — ignoré
          if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
          // MUTATION en place — pas de setState (lu par l'overlay en rAF).
          peer.x = msg.x;
          peer.y = msg.y;
          peer.lastMoveAt = Date.now();
          return;
        }
        case "selection": {
          const peer = map.get(msg.userId);
          if (!peer) return;
          peer.selectionIds = Array.isArray(msg.ids) ? msg.ids : [];
          bumpStructural();
          return;
        }
      }
    },
    [bumpStructural],
  );

  // ── Cycle connexion / reconnexion ──────────────────────────────────────
  useEffect(() => {
    if (!enabled || !room || typeof window === "undefined") {
      return;
    }
    // arkyo-server: temps réel en phase 7 (pas de service WebSocket
    // `/realtime` ni de `POST /api/realtime/ticket`) : aucune connexion,
    // `peers` reste vide et les envois sont sans effet (`rawSend`).
    if (!REALTIME_AVAILABLE) return;

    closedRef.current = false;
    let disposed = false;

    const clearReconnect = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (closedRef.current || disposed) return;
      const step =
        BACKOFF_STEPS_MS[
          Math.min(reconnectAttemptRef.current, BACKOFF_STEPS_MS.length - 1)
        ];
      reconnectAttemptRef.current += 1;
      clearReconnect();
      reconnectTimerRef.current = window.setTimeout(() => {
        void connect();
      }, step);
    };

    const connect = async () => {
      if (closedRef.current || disposed) return;
      let ticket: string | null = null;
      try {
        // Nouveau ticket à CHAQUE (re)connexion (TTL 60 s côté serveur).
        const res = await fetch("/api/realtime/ticket", { method: "POST" });
        if (!res.ok) throw new Error("ticket");
        const json = (await res.json()) as { ticket?: string };
        ticket = typeof json?.ticket === "string" ? json.ticket : null;
      } catch {
        // échec ticket (session/route absente) → retry léger.
        scheduleReconnect();
        return;
      }
      if (!ticket || closedRef.current || disposed) {
        scheduleReconnect();
        return;
      }

      const base = realtimeBaseUrl();
      if (!base) {
        scheduleReconnect();
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(base + "?ticket=" + encodeURIComponent(ticket));
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (closedRef.current || disposed) {
          try {
            ws.close();
          } catch {
            /* silencieux */
          }
          return;
        }
        reconnectAttemptRef.current = 0;
        // (Re)join + resync de la sélection courante.
        try {
          ws.send(JSON.stringify({ t: "join", room }));
          if (lastSelectionSentRef.current.length > 0) {
            ws.send(
              JSON.stringify({
                t: "selection",
                ids: lastSelectionSentRef.current.split(","),
              }),
            );
          }
        } catch {
          /* silencieux */
        }
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") handleMessage(ev.data);
      };

      ws.onerror = () => {
        // onclose suit — la reconnexion y est gérée.
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (closedRef.current || disposed) return;
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      disposed = true;
      closedRef.current = true;
      clearReconnect();
      if (trailingTimerRef.current != null) {
        window.clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* silencieux */
        }
      }
      // Nouvelle salle → repartir d'un état propre.
      peersRef.current = new Map();
      lastSelectionSentRef.current = "";
      lastCursorSentAtRef.current = 0;
      pendingCursorRef.current = null;
      reconnectAttemptRef.current = 0;
      setPeers(new Map());
    };
  }, [room, enabled, handleMessage]);

  return { peers, sendCursor, sendSelection };
}
