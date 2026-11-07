"use client";
import { useCallback, useRef, useState } from "react";

export interface SynopticSnapshot {
  connections: unknown[];
  connWaypoints: [string, unknown][];
  connStyles: [string, unknown][];
  zones: unknown[];
  canvasLabels: unknown[];
  adapters: unknown[];
  positions: [string, { x: number; y: number }][];
}

export function useSynopticHistory(maxSize = 50) {
  const [undoStack, setUndoStack] = useState<SynopticSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<SynopticSnapshot[]>([]);
  const suspendRef = useRef(false);

  const push = useCallback(
    (snapshot: SynopticSnapshot) => {
      if (suspendRef.current) return;
      setUndoStack((prev) => {
        const next = [...prev, snapshot];
        if (next.length > maxSize) next.shift();
        return next;
      });
      setRedoStack([]);
    },
    [maxSize],
  );

  const undo = useCallback(
    (
      applyCurrent: () => SynopticSnapshot,
      restore: (s: SynopticSnapshot, rollback: () => void) => void,
    ): boolean => {
      if (undoStack.length === 0) return false;
      const last = undoStack[undoStack.length - 1];
      const currentSnap = applyCurrent();
      suspendRef.current = true;
      setRedoStack((prev) => [...prev, currentSnap]);
      setUndoStack((prev) => prev.slice(0, -1));
      // Rollback : si la sync DB échoue, on remet les stacks comme avant.
      const rollback = () => {
        setRedoStack((prev) => prev.slice(0, -1));
        setUndoStack((prev) => [...prev, last]);
      };
      restore(last, rollback);
      queueMicrotask(() => {
        suspendRef.current = false;
      });
      return true;
    },
    [undoStack],
  );

  const redo = useCallback(
    (
      applyCurrent: () => SynopticSnapshot,
      restore: (s: SynopticSnapshot, rollback: () => void) => void,
    ): boolean => {
      if (redoStack.length === 0) return false;
      const last = redoStack[redoStack.length - 1];
      const currentSnap = applyCurrent();
      suspendRef.current = true;
      setUndoStack((prev) => [...prev, currentSnap]);
      setRedoStack((prev) => prev.slice(0, -1));
      const rollback = () => {
        setUndoStack((prev) => prev.slice(0, -1));
        setRedoStack((prev) => [...prev, last]);
      };
      restore(last, rollback);
      queueMicrotask(() => {
        suspendRef.current = false;
      });
      return true;
    },
    [redoStack],
  );

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    isSuspended: () => suspendRef.current,
  };
}
