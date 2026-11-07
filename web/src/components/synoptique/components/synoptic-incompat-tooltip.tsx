"use client";

import { cn } from "@/lib/utils";

type SynopticIncompatTooltipProps = {
  incompatTooltip: { msg: string; x: number; y: number } | null;
  multiHoverTooltip: { screenX: number; screenY: number; lines: string[] } | null;
};

export function SynopticIncompatTooltip({
  incompatTooltip,
  multiHoverTooltip,
}: SynopticIncompatTooltipProps) {
  if (!incompatTooltip && !multiHoverTooltip) return null;

  const x = incompatTooltip ? incompatTooltip.x + 16 : multiHoverTooltip!.screenX;
  const y = incompatTooltip ? incompatTooltip.y - 16 : multiHoverTooltip!.screenY;
  const parts = incompatTooltip
    ? incompatTooltip.msg.split(" — connexion possible quand même")
    : null;
  const reasons = parts ? parts[0].split(" · ").filter(Boolean) : [];
  const iconFor = (r: string) => {
    const rl = r.toLowerCase();
    if (rl.includes("entrée")) return "↘↘";
    if (rl.includes("sortie")) return "↗↗";
    if (rl.includes("connecteur")) return "🔌";
    if (rl.includes("signal")) return "📡";
    return "⚠";
  };

  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9999,
        pointerEvents: "none",
        minWidth: 200,
      }}
      className="overflow-hidden rounded-xl shadow-2xl"
    >
      {/* Header incompatibilité */}
      {incompatTooltip && (
        <>
          {/* arkyo-server: habillage Strata (en-tête d'erreur : --danger ; texte --card, le blanc sur --danger sombre < 4,5:1) */}
          <div className="flex items-center gap-2 bg-[var(--danger)] px-3 py-2">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--card)]/20">
              <span style={{ fontSize: 10, color: "var(--card)", fontWeight: 700 }}>!</span>
            </div>
            <span className="text-[11px] font-bold text-[var(--card)]">Connexion non recommandée</span>
          </div>
          <div className="space-y-1.5 px-3 py-2" style={{ background: "var(--surface)" }}>
            {reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="shrink-0 text-[12px]">{iconFor(r)}</span>
                <span className="text-[10px] text-[var(--foreground)]">{r}</span>
              </div>
            ))}
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 border-t border-[var(--border)] px-3 py-1.5",
              multiHoverTooltip ? "" : "",
            )}
            style={{ background: "var(--secondary)" }}
          >
            <span className="text-[10px]">✅</span>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Connexion possible quand même
            </span>
          </div>
        </>
      )}
      {/* Section ports compatibles (multi mode) */}
      {multiHoverTooltip && (
        <div
          className={cn(
            "space-y-0.5 px-3 py-2",
            incompatTooltip ? "border-t border-[var(--border)]" : "",
          )}
          style={{ background: incompatTooltip ? "var(--secondary)" : "var(--surface)" }}
        >
          {!incompatTooltip && (
            <div className="mb-1.5 flex items-center gap-2">
              {/* arkyo-server: habillage Strata (alerte : --warning / --warning-text) */}
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--warning)]/20">
                <span style={{ fontSize: 9, color: "var(--warning-text)", fontWeight: 700 }}>i</span>
              </div>
              <span className="text-[11px] font-bold text-[var(--warning-text)]">Câblage partiel</span>
            </div>
          )}
          {multiHoverTooltip.lines.map((l, i) => (
            <span
              key={i}
              className={cn(
                "block text-[10px]",
                i === 0 ? "font-semibold text-[var(--warning-text)]" : "text-[var(--muted-foreground)]", // arkyo-server: habillage Strata
              )}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
