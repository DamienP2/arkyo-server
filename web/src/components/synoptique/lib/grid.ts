// Helpers pour la grille + snap.
// La grille vit en canvas-space (coordonnées SVG, avant pan/zoom).

export function snapCoord(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapPoint(x: number, y: number, step: number): { x: number; y: number } {
  return { x: snapCoord(x, step), y: snapCoord(y, step) };
}

// Applique le snap si `enabled`. Permet d'écrire `snapIf(x, y, step, enabled)`
// sans condition côté appelant.
export function snapIf(
  x: number,
  y: number,
  step: number,
  enabled: boolean,
): { x: number; y: number } {
  return enabled ? snapPoint(x, y, step) : { x, y };
}
