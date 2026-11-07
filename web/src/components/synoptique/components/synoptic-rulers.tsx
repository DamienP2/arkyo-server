"use client";

// Règles horizontale + verticale en overlay, alignées sur le pan/zoom courant.
// Ticks :
//   - majeurs    : tous les step×4 canvas-space (avec label)
//   - normaux    : tous les step
//   - sous-ticks : step/2 et step/4 quand le zoom est élevé (meilleure précision)
// Indicateur curseur : petite flèche qui suit la position du curseur sur chaque règle.

type Props = {
  pan: { x: number; y: number };
  zoom: number;
  step: number; // canvas-space
  majorEvery?: number; // nb de sous-pas par groupe majeur (défaut 4)
  color?: string; // couleur des graduations / labels
  width: number; // px
  height: number;
  cursor: { x: number; y: number } | null; // canvas-space
  onGuideStart?: (orientation: "h" | "v", e: React.PointerEvent) => void;
};

export const RULER_SIZE = 18;

export function SynopticRulers({
  pan,
  zoom,
  step,
  majorEvery = 4,
  color,
  width,
  height,
  cursor,
  onGuideStart,
}: Props) {
  const stepPx = step * zoom;
  if (stepPx < 4) return null;

  // Sous-division visuelle : 4 sous-ticks à zoom élevé, 2 à zoom moyen
  const subDivs = stepPx >= 80 ? 4 : stepPx >= 40 ? 2 : 1;

  const startCanvasX = -pan.x / zoom;
  const startCanvasY = -pan.y / zoom;
  const endCanvasX = (width - pan.x) / zoom;
  const endCanvasY = (height - pan.y) / zoom;
  const firstMajorX = Math.floor(startCanvasX / (step * majorEvery)) * step * majorEvery;
  const firstMajorY = Math.floor(startCanvasY / (step * majorEvery)) * step * majorEvery;

  type HTick = { x: number; label: string; kind: "major" | "mid" | "minor" | "sub" };
  type VTick = { y: number; label: string; kind: "major" | "mid" | "minor" | "sub" };

  const horizTicks: HTick[] = [];
  const subStep = step / subDivs;
  for (let cx = firstMajorX; cx <= endCanvasX; cx += subStep) {
    const sx = cx * zoom + pan.x;
    if (sx < RULER_SIZE || sx > width) continue;
    const stepRatio = Math.round(cx / subStep);
    const onMajor = stepRatio % (subDivs * majorEvery) === 0;
    const onStep = stepRatio % subDivs === 0;
    const onMid = stepRatio % (subDivs / 2 || 1) === 0;
    const kind: HTick["kind"] = onMajor ? "major" : onStep ? "mid" : onMid ? "minor" : "sub";
    horizTicks.push({ x: sx, label: onMajor ? String(Math.round(cx)) : "", kind });
  }

  const vertTicks: VTick[] = [];
  for (let cy = firstMajorY; cy <= endCanvasY; cy += subStep) {
    const sy = cy * zoom + pan.y;
    if (sy < RULER_SIZE || sy > height) continue;
    const stepRatio = Math.round(cy / subStep);
    const onMajor = stepRatio % (subDivs * majorEvery) === 0;
    const onStep = stepRatio % subDivs === 0;
    const onMid = stepRatio % (subDivs / 2 || 1) === 0;
    const kind: HTick["kind"] = onMajor ? "major" : onStep ? "mid" : onMid ? "minor" : "sub";
    vertTicks.push({ y: sy, label: onMajor ? String(Math.round(cy)) : "", kind });
  }

  const rulerBg = "var(--surface)";
  const rulerBorder = "var(--border)";
  const baseTickColor = color ?? "color-mix(in srgb, var(--foreground) 50%, transparent)";
  const tickColor = baseTickColor;
  const subTickColor = color
    ? `${color}80`
    : "color-mix(in srgb, var(--foreground) 25%, transparent)";
  const labelColor = color ?? "color-mix(in srgb, var(--foreground) 75%, transparent)";
  const cursorColor = "var(--accent)";

  const tickLen = (k: HTick["kind"]) =>
    k === "major"
      ? RULER_SIZE - 4
      : k === "mid"
        ? RULER_SIZE - 7
        : k === "minor"
          ? RULER_SIZE - 10
          : RULER_SIZE - 13;

  const tickStroke = (k: HTick["kind"]) => (k === "sub" ? subTickColor : tickColor);
  const tickWidth = (k: HTick["kind"]) => (k === "major" ? 0.8 : k === "mid" ? 0.6 : 0.4);

  // Position du curseur en screen-space (dans le container complet)
  const cursorSX = cursor ? cursor.x * zoom + pan.x : null;
  const cursorSY = cursor ? cursor.y * zoom + pan.y : null;

  return (
    <>
      {/* Coin d'angle */}
      <div
        data-synoptic-rulers
        className="pointer-events-none absolute"
        style={{
          top: 0,
          left: 0,
          width: RULER_SIZE,
          height: RULER_SIZE,
          background: rulerBg,
          borderRight: `1px solid ${rulerBorder}`,
          borderBottom: `1px solid ${rulerBorder}`,
          zIndex: 6,
        }}
      />
      {/* Règle horizontale */}
      <svg
        data-synoptic-rulers
        className="absolute"
        style={{
          top: 0,
          left: RULER_SIZE,
          height: RULER_SIZE,
          width: width - RULER_SIZE,
          background: rulerBg,
          borderBottom: `1px solid ${rulerBorder}`,
          zIndex: 5,
          cursor: onGuideStart ? "ns-resize" : "default",
        }}
        width={width - RULER_SIZE}
        height={RULER_SIZE}
        onPointerDown={(e) => onGuideStart?.("h", e)}
      >
        {horizTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.x - RULER_SIZE}
              x2={t.x - RULER_SIZE}
              y1={tickLen(t.kind)}
              y2={RULER_SIZE}
              stroke={tickStroke(t.kind)}
              strokeWidth={tickWidth(t.kind)}
            />
            {t.kind === "major" && t.label && (
              <text
                x={t.x - RULER_SIZE + 2}
                y={9}
                fontSize={8}
                fill={labelColor}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        {/* Indicateur curseur */}
        {cursorSX != null && cursorSX > RULER_SIZE && cursorSX < width && (
          <g>
            <line
              x1={cursorSX - RULER_SIZE}
              x2={cursorSX - RULER_SIZE}
              y1={0}
              y2={RULER_SIZE}
              stroke={cursorColor}
              strokeWidth={1}
              opacity={0.9}
            />
            <polygon
              points={`${cursorSX - RULER_SIZE - 3},0 ${cursorSX - RULER_SIZE + 3},0 ${cursorSX - RULER_SIZE},4`}
              fill={cursorColor}
            />
          </g>
        )}
      </svg>
      {/* Règle verticale */}
      <svg
        data-synoptic-rulers
        className="absolute"
        style={{
          top: RULER_SIZE,
          left: 0,
          width: RULER_SIZE,
          height: height - RULER_SIZE,
          background: rulerBg,
          borderRight: `1px solid ${rulerBorder}`,
          zIndex: 5,
          cursor: onGuideStart ? "ew-resize" : "default",
        }}
        width={RULER_SIZE}
        height={height - RULER_SIZE}
        onPointerDown={(e) => onGuideStart?.("v", e)}
      >
        {vertTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={tickLen(t.kind)}
              x2={RULER_SIZE}
              y1={t.y - RULER_SIZE}
              y2={t.y - RULER_SIZE}
              stroke={tickStroke(t.kind)}
              strokeWidth={tickWidth(t.kind)}
            />
            {t.kind === "major" && t.label && (
              <text
                x={3}
                y={t.y - RULER_SIZE + 9}
                fontSize={8}
                fill={labelColor}
                style={{ fontFamily: "var(--font-mono)", writingMode: "vertical-rl" }}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        {/* Indicateur curseur */}
        {cursorSY != null && cursorSY > RULER_SIZE && cursorSY < height && (
          <g>
            <line
              x1={0}
              x2={RULER_SIZE}
              y1={cursorSY - RULER_SIZE}
              y2={cursorSY - RULER_SIZE}
              stroke={cursorColor}
              strokeWidth={1}
              opacity={0.9}
            />
            <polygon
              points={`0,${cursorSY - RULER_SIZE - 3} 0,${cursorSY - RULER_SIZE + 3} 4,${cursorSY - RULER_SIZE}`}
              fill={cursorColor}
            />
          </g>
        )}
      </svg>
    </>
  );
}
