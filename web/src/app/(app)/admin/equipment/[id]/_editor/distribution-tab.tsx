"use client";

// Onglet "Distribution" — supervisor uniquement.
//
// Aujourd'hui, ne contient que la visibilité minimale par plan tarifaire :
//   - FREE : tous les tenants peuvent voir l'équipement
//   - PRO  : visible à partir du plan Pro
//   - ENTERPRISE : visible uniquement aux tenants Enterprise
//
// Les anciens réglages "Propagation" (toujours AUTO maintenant), "Épinglé"
// (déprécié) et le toggle "Actif" (déplacé dans le header global de l'éditeur)
// ont été retirés de la fiche.

import { Crown, Eye, Rocket, Sparkles, Star } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

import { FormData } from "./types";

type PlanOption = {
  value: string;
  label: string;
  /** Phrase courte qui se lit naturellement après « Visible à partir de… ». */
  description: string;
  /** Couleur d'accent du plan. */
  color: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLAN_OPTIONS: PlanOption[] = [
  {
    value: "FREE",
    label: "Free",
    description: "Tous les plans (y compris Free).",
    color: "#71717a",
    icon: Sparkles,
  },
  {
    value: "STARTER",
    label: "Starter",
    description: "Starter, Pro et Enterprise.",
    color: "#10b981",
    icon: Rocket,
  },
  {
    value: "PRO",
    label: "Pro",
    description: "Pro et Enterprise.",
    color: "#6366f1",
    icon: Star,
  },
  {
    value: "ENTERPRISE",
    label: "Enterprise",
    description: "Exclusif Enterprise.",
    color: "#8b5cf6",
    icon: Crown,
  },
];

export function DistributionTab({
  form,
  set,
  catColor,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  catColor: string;
}) {
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-4 py-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          // arkyo-server: habillage Strata (catColor est var(--accent) : teinte par color-mix)
          style={{ background: `color-mix(in srgb, ${catColor} 8%, transparent)`, color: catColor }}
        >
          <Eye className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-tight">
            Visibilité minimale
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)]">
            Choisis à partir de quel plan tarifaire les tenants voient cet
            équipement dans leur catalogue partagé.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PLAN_OPTIONS.map((opt) => {
          const checked = form.visibleFromPlan === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => set("visibleFromPlan", opt.value)}
              className={cn(
                "group relative flex flex-col gap-2.5 overflow-hidden rounded-xl border px-4 py-4 text-left transition-all",
                checked
                  ? "shadow-sm"
                  : "border-[var(--border)]/60 hover:border-[var(--border)] hover:bg-[var(--secondary)]/30",
              )}
              style={
                checked
                  ? {
                      borderColor: opt.color,
                      background: `linear-gradient(180deg, ${opt.color}10 0%, ${opt.color}06 100%)`,
                    }
                  : {}
              }
              aria-pressed={checked}
            >
              {/* Liseré gauche coloré quand sélectionné. */}
              {checked && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: opt.color }}
                />
              )}

              <div className="flex items-center justify-between">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{
                    background: checked ? `${opt.color}20` : "var(--secondary)",
                    color: checked ? opt.color : "var(--muted-foreground)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {checked && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest uppercase"
                    style={{ background: `${opt.color}18`, color: opt.color }}
                  >
                    Actif
                  </span>
                )}
              </div>

              <div>
                <p
                  className="text-[13px] font-bold leading-tight"
                  style={{ color: checked ? opt.color : "var(--foreground)" }}
                >
                  {opt.label}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
