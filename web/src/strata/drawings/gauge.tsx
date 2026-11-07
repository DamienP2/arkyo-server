/**
 * Jauge horizontale fine (interface Strata) : valeur / maximum et unité
 * (U occupés, puissance face à la capacité…). Portée de la maquette
 * (`catalogue.js`, `gauge`) : neutre jusqu'à 75 %, avertissement au-delà,
 * danger au-delà de 90 %.
 */

export function Gauge({
  value,
  max,
  unit,
  format = (n) => String(n),
  className,
}: {
  value: number;
  max: number;
  unit: string;
  format?: (n: number) => string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tone = pct > 90 ? "var(--danger)" : pct > 75 ? "var(--warning)" : "var(--muted-foreground)";
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={unit}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
      >
        <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, background: tone }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
        {format(value)} / {format(max)} {unit}
      </span>
    </div>
  );
}
