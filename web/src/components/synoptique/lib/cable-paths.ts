/**
 * Génération de chemins SVG pour les câbles du synoptique.
 *
 * Fonctions pures : reçoivent toutes les dépendances (style, snap, obstacles)
 * en paramètre. Le composant synoptic-view les wrape en useCallback avec les
 * valeurs courantes des refs/stores.
 */

import { snapCoord } from "./grid";

export type CableStyle = "ortho" | "rounded" | "arrow";
export type SnapState = { snapEnabled: boolean; gridStep: number };
export type AvoidFn = (
  mx: number,
  y1: number,
  y2: number,
  srcSlotId: string,
  dstSlotId: string,
) => number;

// ── Helpers internes ────────────────────────────────────────────────────────

const R = 14;

function corner(
  px: number,
  py: number,
  cx: number,
  cy: number,
  nx: number,
  ny: number,
  r = R,
): string {
  const dx1 = cx - px,
    dy1 = cy - py,
    dx2 = nx - cx,
    dy2 = ny - cy;
  const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1),
    l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  if (l1 < 0.5 || l2 < 0.5) return `L ${nx} ${ny}`;
  const cr = Math.max(4, Math.min(r, l1 / 2 - 1, l2 / 2 - 1));
  return `L ${cx - (dx1 / l1) * cr} ${cy - (dy1 / l1) * cr} Q ${cx} ${cy} ${cx + (dx2 / l2) * cr} ${cy + (dy2 / l2) * cr}`;
}

function polyline(pts: [number, number][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1],
      [cx, cy] = pts[i],
      [nx, ny] = pts[i + 1];
    d += " " + corner(px, py, cx, cy, nx, ny);
  }
  d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
  return d;
}

// ── makePath (sans waypoints) ───────────────────────────────────────────────

export function buildCablePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side1: "left" | "right",
  side2: "left" | "right",
  style: CableStyle,
  snap: SnapState,
  opts?: {
    safeBypassY?: number;
    laneOffset?: number;
    srcSlotId?: string;
    dstSlotId?: string;
    avoidObstacles?: AvoidFn;
  },
): string {
  const laneOffset = opts?.laneOffset ?? 0;
  const snapGrid = (v: number) => (snap.snapEnabled ? snapCoord(v, snap.gridStep) : v);

  const isInToOut = side1 === "left" && side2 === "right";
  const isFoldBack = side1 === "right" && side2 === "left" && x2 <= x1;
  const isSameSide = side1 === side2;
  const needsBypass = isInToOut || isFoldBack || isSameSide;

  if (needsBypass) {
    const STUB = 48;
    const MARGIN = 56;
    const LANE = laneOffset;

    if (isSameSide) {
      const colX = snapGrid(
        (side1 === "right" ? Math.max(x1, x2) + STUB + MARGIN : Math.min(x1, x2) - STUB - MARGIN) +
          LANE,
      );
      return polyline([
        [x1, y1],
        [colX, y1],
        [colX, y2],
        [x2, y2],
      ]);
    } else if (isInToOut) {
      const colLeft = x1 - STUB;
      const colRight = x2 + STUB;
      const midY = snapGrid((y1 + y2) / 2 + LANE);
      return polyline([
        [x1, y1],
        [colLeft, y1],
        [colLeft, midY],
        [colRight, midY],
        [colRight, y2],
        [x2, y2],
      ]);
    } else {
      const colNear = x1 + STUB + MARGIN;
      const colFar = x2 - STUB - MARGIN;
      const bypassY = snapGrid((opts?.safeBypassY ?? Math.max(y1, y2) + MARGIN * 2) + LANE);
      return polyline([
        [x1, y1],
        [colNear, y1],
        [colNear, bypassY],
        [colFar, bypassY],
        [colFar, y2],
        [x2, y2],
      ]);
    }
  }

  const laneRoom = Math.abs(laneOffset) + 20;
  const gap = Math.max(Math.abs(x2 - x1) * 0.4, 50, laneRoom);
  const ex1 = x1 + (side1 === "right" ? gap : -gap);
  const ex2 = x2 + (side2 === "left" ? -gap : gap);
  let mx = (ex1 + ex2) / 2 + laneOffset;
  if (opts?.srcSlotId && opts?.dstSlotId && opts.avoidObstacles) {
    mx = opts.avoidObstacles(mx, y1, y2, opts.srcSlotId, opts.dstSlotId);
  }
  if (snap.snapEnabled) mx = snapCoord(mx, snap.gridStep);

  if (style === "ortho") {
    return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
  }

  const dy = y2 - y1;
  if (Math.abs(dy) < 2) {
    return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
  }
  const sy = dy > 0 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `H ${mx - R}`,
    `Q ${mx} ${y1} ${mx} ${y1 + sy * R}`,
    `V ${y2 - sy * R}`,
    `Q ${mx} ${y2} ${mx + R} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}

// ── orthoSegment ────────────────────────────────────────────────────────────

export function orthoSegment(x1: number, y1: number, x2: number, y2: number, r = 12): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 0.5) return `V ${y2}`;
  if (Math.abs(dy) < 0.5) return `H ${x2}`;
  const cr = Math.min(r, Math.abs(dx) / 2, Math.abs(dy) / 2);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  return `H ${x2 - sx * cr} Q ${x2} ${y1} ${x2} ${y1 + sy * cr} V ${y2}`;
}

// ── makePathWithWaypoints ───────────────────────────────────────────────────

export function buildCablePathWithWaypoints(
  x1: number,
  y1: number,
  side1: "left" | "right",
  x2: number,
  y2: number,
  side2: "left" | "right",
  waypoints: { x: number; y: number }[],
  style: CableStyle,
  snap: SnapState,
  opts?: {
    safeBypassY?: number;
    laneOffset?: number;
    srcSlotId?: string;
    dstSlotId?: string;
    avoidObstacles?: AvoidFn;
  },
): string {
  const laneOffset = opts?.laneOffset ?? 0;
  if (waypoints.length === 0) {
    return buildCablePath(x1, y1, x2, y2, side1, side2, style, snap, opts);
  }

  const EXIT = 40;
  const normalizedWps = waypoints.map((p, i) => {
    if (i === 0) return { x: p.x + laneOffset, y: y1 };
    if (i === waypoints.length - 1) return { x: p.x + laneOffset, y: y2 };
    return { x: p.x + laneOffset, y: p.y };
  });

  const firstWp = normalizedWps[0];
  const lastWp = normalizedWps[normalizedWps.length - 1];
  const rawEx1 = x1 + (side1 === "right" ? EXIT : -EXIT);
  const ex1 = side1 === "right" ? Math.min(rawEx1, firstWp.x) : Math.max(rawEx1, firstWp.x);
  const rawEx2 = x2 + (side2 === "left" ? -EXIT : EXIT);
  const ex2 = side2 === "left" ? Math.max(rawEx2, lastWp.x) : Math.min(rawEx2, lastWp.x);

  const pts = [
    { x: x1, y: y1 },
    { x: ex1, y: y1 },
    ...normalizedWps,
    { x: ex2, y: y2 },
    { x: x2, y: y2 },
  ];

  if (style === "ortho") {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      if (Math.abs(cur.y - prev.y) < 0.5) d += ` H ${cur.x}`;
      else if (Math.abs(cur.x - prev.x) < 0.5) d += ` V ${cur.y}`;
      else d += ` H ${cur.x} V ${cur.y}`;
    }
    return d;
  }

  // Rounded: split diagonal segments into ortho pairs
  const orthoPts: { x: number; y: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = orthoPts[orthoPts.length - 1];
    const cur = pts[i];
    if (Math.abs(cur.x - prev.x) > 0.5 && Math.abs(cur.y - prev.y) > 0.5) {
      orthoPts.push({ x: cur.x, y: prev.y });
    }
    orthoPts.push(cur);
  }

  let d = `M ${orthoPts[0].x} ${orthoPts[0].y}`;
  for (let i = 1; i < orthoPts.length; i++) {
    const prev = orthoPts[i - 1];
    const cur = orthoPts[i];
    const next = orthoPts[i + 1];
    if (next) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const nx = next.x - cur.x;
      const ny = next.y - cur.y;
      const segLen = Math.abs(dx !== 0 ? dx : dy);
      const nextLen = Math.abs(nx !== 0 ? nx : ny);
      const cr = Math.min(R, segLen / 2, nextLen / 2);
      if (cr < 1) {
        d += ` L ${cur.x} ${cur.y}`;
        continue;
      }
      const ex = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
      const ey = dy !== 0 ? (dy > 0 ? 1 : -1) : 0;
      const fx = nx !== 0 ? (nx > 0 ? 1 : -1) : 0;
      const fy = ny !== 0 ? (ny > 0 ? 1 : -1) : 0;
      d += ` L ${cur.x - ex * cr} ${cur.y - ey * cr} Q ${cur.x} ${cur.y} ${cur.x + fx * cr} ${cur.y + fy * cr}`;
    } else {
      d += ` L ${cur.x} ${cur.y}`;
    }
  }
  return d;
}
