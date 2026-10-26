"use client";

/**
 * PresenceProvider — présence collaborative « ambient » (Phase 3a).
 *
 * Une « salle » = la page consultée, identifiée par le pathname normalisé
 * (trailing slash retiré). Deux personnes sur la même URL sont dans la même
 * salle. Le cloisonnement tenant est assuré côté serveur par le tag automatique
 * des events (Phase 1) — on ne s'en occupe pas ici.
 *
 * Cycle de vie :
 *   - au montage / changement de salle → GET l'état initial + POST heartbeat
 *     immédiat ;
 *   - heartbeat POST toutes les 20 s ;
 *   - `pagehide` (et changement de salle) → sendBeacon `{ leave: true }` ;
 *   - onglet caché : on continue le heartbeat (c'est le TTL serveur qui tranche).
 *
 * Réception : on RÉUTILISE le singleton EventSource `subscribeAppEvents`
 * (jamais de nouvel EventSource) et on ne réagit qu'aux events
 * `entity === "presence" && id === roomKey`.
 *
 * Robustesse : tout est en try/catch silencieux — la présence ne doit JAMAIS
 * casser une page. Un fetch qui échoue est simplement réessayé au heartbeat
 * suivant.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { subscribeAppEvents } from "@/lib/app-events-client";

// ── Contrat backend (fixé) ────────────────────────────────────────────────

export type PresenceMember = {
  userId: string;
  name: string;
  color: string;
  editingField: string | null;
};

type PresenceEvent = {
  entity?: string;
  action?: string;
  id?: string;
  data?: { members?: PresenceMember[] };
};

// ── Contexte ───────────────────────────────────────────────────────────────

type PresenceContextValue = {
  /** Membres de la salle, EXCLUANT l'utilisateur courant. */
  members: PresenceMember[];
  /** Déclare le champ en cours d'édition (ou `null` au blur). Débounce 300 ms. */
  reportEditingField: (field: string | null) => void;
};

const PresenceContext = createContext<PresenceContextValue>({
  members: [],
  reportEditingField: () => {},
});

const HEARTBEAT_MS = 20_000;
const REPORT_DEBOUNCE_MS = 300;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Pathname normalisé : trailing slash retiré, « / » préservé. */
function normalizeRoomKey(pathname: string | null): string {
  if (!pathname) return "/";
  const stripped = pathname.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

/** Initiales (2 lettres max) d'un nom, pour les avatars. */
export function presenceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase();
}

// ── Provider ─────────────────────────────────────────────────────────────

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;
  const roomKey = normalizeRoomKey(pathname);

  const [members, setMembers] = useState<PresenceMember[]>([]);

  // Refs stables pour éviter de re-souscrire / recréer les callbacks.
  const roomKeyRef = useRef(roomKey);
  roomKeyRef.current = roomKey;
  const editingFieldRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Heartbeat POST — envoie roomKey + champ courant. `keepalive` pour survivre
  // à une navigation en cours.
  const sendHeartbeat = useCallback(async () => {
    try {
      await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomKey: roomKeyRef.current,
          editingField: editingFieldRef.current,
        }),
        keepalive: true,
      });
    } catch {
      // silencieux — réessai au prochain heartbeat.
    }
  }, []);

  // ── Cycle de salle : GET initial + heartbeat immédiat + interval ─────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    // Changement de salle → l'édition de champ précédente est caduque.
    editingFieldRef.current = null;
    // Vide la liste pour ne pas afficher les membres de l'ancienne salle.
    setMembers([]);

    // État initial.
    (async () => {
      try {
        const res = await fetch(
          `/api/presence?roomKey=${encodeURIComponent(roomKey)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { members?: PresenceMember[] };
        if (!cancelled && Array.isArray(json?.members)) {
          setMembers(json.members);
        }
      } catch {
        // silencieux — la première mise à jour SSE ou le prochain heartbeat
        // rétablira l'état.
      }
    })();

    // Heartbeat immédiat (join).
    void sendHeartbeat();

    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      // Quitte l'ANCIENNE salle (roomKey capturé par la closure).
      try {
        const blob = new Blob(
          [JSON.stringify({ roomKey, leave: true })],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/presence", blob);
      } catch {
        // silencieux.
      }
    };
  }, [roomKey, sendHeartbeat]);

  // ── pagehide → leave (sendBeacon) ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageHide = () => {
      try {
        const blob = new Blob(
          [JSON.stringify({ roomKey: roomKeyRef.current, leave: true })],
          { type: "application/json" },
        );
        navigator.sendBeacon("/api/presence", blob);
      } catch {
        // silencieux.
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // ── SSE : réutilise le singleton, filtre sur la salle courante ───────────
  useEffect(() => {
    return subscribeAppEvents((data) => {
      const payload = data as PresenceEvent | null;
      if (!payload || payload.entity !== "presence") return;
      if (payload.action !== "updated") return;
      if (payload.id !== roomKeyRef.current) return;
      const list = payload.data?.members;
      if (Array.isArray(list)) setMembers(list);
    });
  }, []);

  // ── reportEditingField : POST immédiat, débounce léger 300 ms ────────────
  const reportEditingField = useCallback(
    (field: string | null) => {
      editingFieldRef.current = field;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void sendHeartbeat();
      }, REPORT_DEBOUNCE_MS);
    },
    [sendHeartbeat],
  );

  // Cleanup du timer de débounce au démontage.
  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  // Membres EXCLUANT l'utilisateur courant.
  const otherMembers = useMemo(
    () => members.filter((m) => m.userId !== currentUserId),
    [members, currentUserId],
  );

  const value = useMemo<PresenceContextValue>(
    () => ({ members: otherMembers, reportEditingField }),
    [otherMembers, reportEditingField],
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────

/** Tous les AUTRES membres présents dans la salle courante. */
export function useRoomPresence(): PresenceMember[] {
  return useContext(PresenceContext).members;
}

/** Les AUTRES membres qui éditent le champ `field`. */
export function useFieldPresence(field: string): PresenceMember[] {
  const { members } = useContext(PresenceContext);
  return useMemo(
    () => members.filter((m) => m.editingField === field),
    [members, field],
  );
}

/** Déclare (ou efface avec `null`) le champ en cours d'édition. */
export function useReportEditingField(): (field: string | null) => void {
  return useContext(PresenceContext).reportEditingField;
}
