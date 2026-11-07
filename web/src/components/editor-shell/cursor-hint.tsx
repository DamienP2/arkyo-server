"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ShieldAlert, Info, CheckCircle2 } from "@/components/ui/icons";
import { useCursorHint } from "./hooks/use-cursor-hint";
import { SHELL_CURSOR_HINT_OFFSET } from "@/components/synoptique/lib/constants";

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      // arkyo-server: habillage Strata (touche inversée selon le thème : fond --foreground, texte --background)
      className="inline-flex items-center rounded border border-[var(--foreground)]/30 bg-[var(--foreground)] px-1.5 py-0.5 align-baseline text-[9px] font-medium text-[var(--background)] shadow-[inset_0_-1px_0_rgba(255,255,255,0.15)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </kbd>
  );
}

/**
 * Parse un message d'incompatibilité de type "raison1 · raison2 — note".
 * Sépare les raisons (par " · ") et extrait une éventuelle note après " — ".
 */
function parseIncompatMsg(msg: string): { reasons: string[]; note: string | null } {
  const noteIdx = msg.indexOf(" — ");
  const head = noteIdx >= 0 ? msg.slice(0, noteIdx) : msg;
  const note = noteIdx >= 0 ? msg.slice(noteIdx + 3).trim() : null;
  const reasons = head
    .split(" · ")
    .map((r) => r.trim())
    .filter(Boolean);
  return { reasons, note };
}

export function CursorHint() {
  const label = useCursorHint((s) => s.label);
  const tooltip = useCursorHint((s) => s.tooltip);
  const variant = useCursorHint((s) => s.variant);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });

  useEffect(() => {
    if (!label && !tooltip) return;
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [label, tooltip]);

  if (!label && !tooltip) return null;

  const isError = variant === "error";
  const isSuccess = variant === "success";

  return (
    <div className="pointer-events-none fixed z-[9999]" style={{ left: pos.x, top: pos.y }}>
      {label && !tooltip && (
        <div
          className={`absolute -top-6 left-3 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
            isError
              ? "bg-[var(--danger)] text-[var(--card)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--danger)_25%,transparent)]" // arkyo-server: habillage Strata (erreur : --danger, texte --card ≥ 4,5:1 dans les deux thèmes)
              : "bg-foreground text-background"
          }`}
        >
          {label}
        </div>
      )}
      {tooltip &&
        (isSuccess ? (
          <div
            // arkyo-server: habillage Strata (succès : --success, texte en --success-text)
            className="absolute flex max-w-[440px] min-w-[280px] flex-col gap-2.5 rounded-lg border-2 border-[var(--success)]/40 px-4 py-3 text-[12px] leading-[1.6] text-[var(--success-text)] shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--success)_30%,transparent)]"
            style={{
              top: SHELL_CURSOR_HINT_OFFSET,
              left: SHELL_CURSOR_HINT_OFFSET,
              background:
                // arkyo-server: habillage Strata (teinte de succès : --success)
                "linear-gradient(135deg, color-mix(in srgb, var(--success) 7%, var(--popover)) 0%, var(--popover) 70%)",
            }}
          >
            <div className="flex items-start gap-3">
              {/* arkyo-server: habillage Strata (pastille de succès : --success, icône --card ≥ 3:1 dans les deux thèmes) */}
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--success)] text-[var(--card)] shadow-sm">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div className="flex flex-col gap-1">
                {label && (
                  // arkyo-server: habillage Strata (texte de succès : --success-text)
                  <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--success-text)] uppercase">
                    {label}
                  </span>
                )}
                <span className="text-foreground/85">{tooltip}</span>
              </div>
            </div>
            {/* arkyo-server: habillage Strata (filet de succès : --success) */}
            <div className="text-muted-foreground flex items-center gap-1.5 border-t border-[var(--success)]/20 pt-2 text-[10px]">
              <Kbd>Esc</Kbd>
              <span>pour annuler</span>
            </div>
          </div>
        ) : isError ? (
          (() => {
            const { reasons, note } = parseIncompatMsg(tooltip);
            return (
              <div
                // arkyo-server: habillage Strata (erreur : --danger, texte en --danger-text)
                className="absolute flex max-w-[460px] min-w-[280px] flex-col gap-3 rounded-lg border-2 border-[var(--danger)]/50 px-4 py-3 text-[12px] leading-[1.6] text-[var(--danger-text)] shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--danger)_35%,transparent)]"
                style={{
                  top: SHELL_CURSOR_HINT_OFFSET,
                  left: SHELL_CURSOR_HINT_OFFSET,
                  background:
                    // arkyo-server: habillage Strata (teinte d'erreur : --danger)
                    "linear-gradient(135deg, color-mix(in srgb, var(--danger) 8%, var(--popover)) 0%, var(--popover) 70%)",
                }}
              >
                <div className="flex items-start gap-3">
                  {/* arkyo-server: habillage Strata (pastille d'erreur : --danger, icône --card) */}
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--danger)] text-[var(--card)] shadow-sm">
                    <ShieldAlert className="h-4 w-4" />
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {/* arkyo-server: habillage Strata (texte d'erreur : --danger-text) */}
                    <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--danger-text)] uppercase">
                      Connexion incompatible
                    </span>
                    {reasons.length > 0 && (
                      <ul className="text-foreground/85 flex flex-col gap-0.5">
                        {reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            {/* arkyo-server: habillage Strata (puce d'erreur : --danger) */}
                            <span className="pt-0.5 text-[var(--danger)]/70">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {note && (
                  <div
                    // arkyo-server: habillage Strata (filet d'erreur : --danger)
                    className="text-foreground/70 border-t border-[var(--danger)]/20 pt-2 text-[11px] italic"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {note}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div
            className="border-border text-foreground absolute flex max-w-[440px] min-w-[280px] flex-col gap-2.5 rounded-lg border px-4 py-3 text-[12px] leading-[1.6] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.25)]"
            style={{
              top: SHELL_CURSOR_HINT_OFFSET,
              left: SHELL_CURSOR_HINT_OFFSET,
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, var(--popover)) 0%, var(--popover) 70%)",
            }}
          >
            <div className="flex items-start gap-3">
              {/* arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong) */}
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]">
                <Info className="h-4 w-4" />
              </span>
              <div className="flex flex-col gap-1">
                {label && (
                  // arkyo-server: habillage Strata (texte d'accent sur la teinte d'accent : --accent-strong)
                  <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--accent-strong)] uppercase">
                    {label}
                  </span>
                )}
                <span className="text-foreground/85">{tooltip}</span>
              </div>
            </div>
            <div className="border-border/60 text-muted-foreground flex items-center gap-1.5 border-t pt-2 text-[10px]">
              <Kbd>Esc</Kbd>
              <span>pour annuler</span>
            </div>
          </div>
        ))}
    </div>
  );
}
