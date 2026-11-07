/**
 * `useSynopticHistory` (arkyo:components/synoptique/hooks/use-synoptic-history.ts)
 * est l'undo/redo du synoptique (décision 7 de la 4c : pas du SaaS). Piles
 * bornées à `maxSize`, redo vidé par un nouveau `push`, `push` ignoré pendant
 * une restauration, et rollback des piles si la synchro serveur échoue.
 */

import { expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSynopticHistory, type SynopticSnapshot } from "./use-synoptic-history";

const snap = (n: number): SynopticSnapshot => ({
  connections: [{ id: `c${n}` }],
  connWaypoints: [],
  connStyles: [],
  zones: [],
  canvasLabels: [],
  adapters: [],
  positions: [[`s${n}`, { x: n, y: n }]],
});

const flush = () => new Promise<void>((r) => queueMicrotask(r));

test("history_undo_redo : undo restaure le dernier état, redo le rejoue", () => {
  const { result } = renderHook(() => useSynopticHistory());
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);

  act(() => result.current.push(snap(1)));
  act(() => result.current.push(snap(2)));
  expect(result.current.canUndo).toBe(true);

  const restored: SynopticSnapshot[] = [];
  let ok = false;
  act(() => {
    ok = result.current.undo(
      () => snap(3),
      (s) => restored.push(s),
    );
  });
  expect(ok).toBe(true);
  expect(restored).toEqual([snap(2)]);
  expect(result.current.canRedo).toBe(true);

  act(() => {
    ok = result.current.redo(
      () => snap(2),
      (s) => restored.push(s),
    );
  });
  expect(ok).toBe(true);
  // Le redo rejoue l'état courant capturé au moment de l'undo.
  expect(restored).toEqual([snap(2), snap(3)]);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.canUndo).toBe(true);
});

test("history_undo_redo : piles vides → undo/redo renvoient false sans restaurer", () => {
  const { result } = renderHook(() => useSynopticHistory());
  let called = false;
  expect(result.current.undo(() => snap(0), () => (called = true))).toBe(false);
  expect(result.current.redo(() => snap(0), () => (called = true))).toBe(false);
  expect(called).toBe(false);
});

test("history_undo_redo : un nouveau push vide la pile redo", () => {
  const { result } = renderHook(() => useSynopticHistory());
  act(() => result.current.push(snap(1)));
  act(() => {
    result.current.undo(() => snap(2), () => {});
  });
  expect(result.current.canRedo).toBe(true);
  return flush().then(() => {
    act(() => result.current.push(snap(4)));
    expect(result.current.canRedo).toBe(false);
  });
});

test("history_undo_redo : push suspendu pendant la restauration, repris au microtask suivant", async () => {
  const { result } = renderHook(() => useSynopticHistory());
  act(() => result.current.push(snap(1)));
  act(() => result.current.push(snap(2)));
  act(() => {
    result.current.undo(
      () => snap(3),
      // Une restauration qui re-déclenche un push (setState → effet) ne doit
      // pas polluer la pile.
      (s) => result.current.push(s),
    );
  });
  expect(result.current.isSuspended()).toBe(true);
  await flush();
  expect(result.current.isSuspended()).toBe(false);
  // Pile undo : seulement snap(1) ; un seul undo possible.
  const seen: SynopticSnapshot[] = [];
  act(() => {
    result.current.undo(() => snap(2), (s) => seen.push(s));
  });
  await flush();
  expect(seen).toEqual([snap(1)]);
  expect(result.current.canUndo).toBe(false);
});

test("history_undo_redo : le rollback remet les piles comme avant l'undo", async () => {
  const { result } = renderHook(() => useSynopticHistory());
  act(() => result.current.push(snap(1)));
  let rollback: () => void = () => {};
  act(() => {
    result.current.undo(() => snap(2), (_s, rb) => (rollback = rb));
  });
  await flush();
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(true);
  act(() => rollback());
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
});

test("history_undo_redo : pile bornée à maxSize, clear vide tout", async () => {
  const { result } = renderHook(() => useSynopticHistory(2));
  act(() => result.current.push(snap(1)));
  act(() => result.current.push(snap(2)));
  act(() => result.current.push(snap(3)));
  const seen: SynopticSnapshot[] = [];
  for (let i = 0; i < 3; i++) {
    act(() => {
      result.current.undo(() => snap(9), (s) => seen.push(s));
    });
    await flush();
  }
  // snap(1) a été évincé.
  expect(seen).toEqual([snap(3), snap(2)]);
  act(() => result.current.clear());
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
});
