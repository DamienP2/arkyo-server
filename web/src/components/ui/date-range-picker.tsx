"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type DateRange = {
  from: Date | null;
  to: Date | null;
};

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  mode?: "range" | "single";
  minDate?: Date;
  maxDate?: Date;
  className?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_LABELS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const WEEKDAYS_FR = ["L", "M", "M", "J", "V", "S", "D"];

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBetween(d: Date, from: Date | null, to: Date | null): boolean {
  if (!from || !to) return false;
  const t = startOfDay(d).getTime();
  return t > startOfDay(from).getTime() && t < startOfDay(to).getTime();
}

function isBefore(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

// Génère la grille du mois affiché : 6 lignes × 7 colonnes, commençant le lundi.
function buildMonthGrid(year: number, month: number): Date[] {
  // Premier jour du mois
  const first = new Date(year, month, 1);
  // getDay() : dimanche = 0 → on veut lundi = 0
  const weekdayMon0 = (first.getDay() + 6) % 7;
  // Décale pour commencer sur lundi
  const gridStart = new Date(year, month, 1 - weekdayMon0);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function DateRangePicker({
  value,
  onChange,
  mode = "range",
  minDate,
  maxDate,
  className,
}: Props) {
  // Mois affiché : ancré sur `value.from` si présent ; sinon sur `minDate`
  // quand il est dans le futur (évite d'ouvrir sur un mois entièrement
  // désactivé), sinon le mois courant.
  const initialRef = () => {
    if (value.from) return value.from;
    const now = new Date();
    return minDate && minDate.getTime() > now.getTime() ? minDate : now;
  };
  const [viewYear, setViewYear] = React.useState<number>(() => initialRef().getFullYear());
  const [viewMonth, setViewMonth] = React.useState<number>(() => initialRef().getMonth());

  const grid = React.useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const today = React.useMemo(() => startOfDay(new Date()), []);

  // Liste d'années pour le sélecteur rapide : large fenêtre autour de l'année
  // courante, élargie au besoin pour toujours inclure l'année affichée.
  const years = React.useMemo(() => {
    const nowY = new Date().getFullYear();
    const min = Math.min(nowY - 6, viewYear);
    const max = Math.max(nowY + 10, viewYear);
    const out: number[] = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  }, [viewYear]);

  const selectCls =
    "h-7 cursor-pointer rounded-md border border-[var(--border)]/60 bg-transparent px-1.5 text-[11px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]/60 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleClick = (day: Date) => {
    if (minDate && isBefore(day, minDate)) return;
    if (maxDate && isBefore(maxDate, day)) return;

    const clicked = startOfDay(day);

    if (mode === "single") {
      onChange({ from: clicked, to: clicked });
      return;
    }

    // mode === "range"
    if (!value.from && !value.to) {
      onChange({ from: clicked, to: null });
      return;
    }
    if (value.from && !value.to) {
      // 2e clic : avant le from → recommencer ; sinon set to
      if (isBefore(clicked, value.from)) {
        onChange({ from: clicked, to: null });
      } else {
        onChange({ from: value.from, to: clicked });
      }
      return;
    }
    // 3e clic après range complet → reset
    onChange({ from: clicked, to: null });
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)]/60 bg-[var(--card)] p-2 shadow-sm",
        className,
      )}
    >
      {/* Header : nav + sélecteurs rapides mois / année */}
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={goPrev}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          aria-label="Mois précédent"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-1">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className={selectCls}
            aria-label="Mois"
          >
            {MONTH_LABELS_FR.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
            className={cn(selectCls, "tabular-nums")}
            aria-label="Année"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={goNext}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          aria-label="Mois suivant"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Weekdays */}
      <div className="mb-0.5 grid grid-cols-7 gap-0.5">
        {WEEKDAYS_FR.map((w, i) => (
          <div
            key={`${w}-${i}`}
            className="flex h-4 items-center justify-center text-[8px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {grid.map((day) => {
          const inMonth = day.getMonth() === viewMonth;
          const isToday = sameDay(day, today);
          const isFrom = sameDay(day, value.from);
          const isTo = sameDay(day, value.to);
          const isEndpoint = isFrom || isTo;
          const isInRange =
            mode === "range" ? isBetween(day, value.from, value.to) : false;
          const disabled =
            (minDate && isBefore(day, minDate)) ||
            (maxDate && isBefore(maxDate, day));

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleClick(day)}
              disabled={disabled || undefined}
              className={cn(
                "relative flex h-6 items-center justify-center rounded text-[10px] tabular-nums transition-colors",
                // Mois en dehors du current
                !inMonth && "text-[var(--muted-foreground)]/40",
                // Mois courant
                inMonth && !isEndpoint && !isInRange && "text-[var(--foreground)] hover:bg-[var(--secondary)]/60",
                // Endpoints
                // arkyo-server: habillage Strata
                isEndpoint && "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-sm",
                // Entre range
                isInRange && "bg-[var(--accent)]/15 text-[var(--foreground)]",
                // Aujourd'hui (si pas endpoint)
                isToday && !isEndpoint && "font-bold ring-1 ring-[var(--accent)]/40",
                // Disabled
                disabled && "opacity-30 cursor-not-allowed",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
