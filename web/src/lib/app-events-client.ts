"use client";

/**
 * Singleton EventSource pour `/api/events` — partagé entre tous les composants
 * qui veulent écouter les events globaux.
 *
 * **Problème résolu** : avant, chaque hook qui appelait
 * `new EventSource("/api/events")` ouvrait une connexion HTTP dédiée.
 * Le navigateur (Chrome) limite à 6 connexions HTTP/1.1 par origine, donc
 * dès qu'on avait 3-4 SSE ouvertes (rack-editor + use-rack-bom + bom-panel
 * + sync-hooks etc.), le navigateur bloquait toutes les XHR suivantes
 * (chargement de pages, sauvegardes, etc.).
 *
 * Avec ce singleton : 1 seule EventSource quel que soit le nombre d'abonnés,
 * et fermeture automatique quand le dernier subscriber se désabonne.
 */

type Handler = (data: unknown) => void;

let es: EventSource | null = null;
const handlers = new Set<Handler>();

function start() {
  if (typeof window === "undefined") return;
  if (es) return;
  es = new EventSource("/api/events");
  es.onmessage = (e) => {
    let data: unknown = null;
    try {
      data = JSON.parse(e.data);
    } catch {
      // ignore
    }
    handlers.forEach((h) => {
      try {
        h(data);
      } catch {
        // un handler qui throw ne doit pas casser les autres
      }
    });
  };
  es.onerror = () => {
    // Laisse le navigateur retenter automatiquement. On ne ferme pas pour
    // garder la connexion ouverte aux abonnés actifs.
  };
}

function stopIfIdle() {
  if (handlers.size === 0 && es) {
    es.close();
    es = null;
  }
}

/**
 * Souscrit à `/api/events`. Renvoie une fonction de cleanup (à appeler dans
 * le return d'un useEffect).
 */
export function subscribeAppEvents(handler: Handler): () => void {
  handlers.add(handler);
  start();
  return () => {
    handlers.delete(handler);
    stopIfIdle();
  };
}
