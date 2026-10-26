"use client";

/**
 * RangeInput — slider partagé pour les wizards (rack, panel, équipement).
 *
 * Deux modes d'utilisation :
 *
 * 1. **Slider nu** : si aucune des props "display" (`label`, `unit`,
 *    `displayValue`, `showBounds`) n'est fournie, le composant renvoie
 *    uniquement le `<input type="range" />` stylé — rétro-compatible avec
 *    l'ancien `RangeInput` local de `new-rack-wizard.tsx`.
 *
 * 2. **Encapsulé** : si l'une des props "display" est fournie, le slider
 *    est habillé d'un cartouche (label uppercase, valeur en grand monospace,
 *    bornes min/max sous la barre) — pratique pour des étapes type
 *    `WeightStep` ou `DimensionsStep` où la valeur doit être lisible
 *    immédiatement.
 *
 *    Avec `editable: true`, la valeur en grand devient un `<input
 *    type="number">` stylé monospace — l'utilisateur peut soit déplacer le
 *    slider, soit taper la valeur dans le champ (clamping automatique aux
 *    bornes en fin de saisie).
 *
 * Extraction : `components/racks/new-rack-wizard.tsx` (RangeInput local
 * ~ligne 1583) — pattern identique côté `new-panel-wizard.tsx`.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { RequiredPill } from "@/components/ui/form-field";

type RangeInputProps = {
  /** Borne basse du slider. */
  min: number;
  /** Borne haute — clamp de la saisie éditable ET borne du slider par défaut. */
  max: number;
  /**
   * Borne haute du CURSEUR uniquement, si distincte de `max`. Permet un slider
   * plus court (ex. 100) tout en autorisant la saisie manuelle jusqu'à `max`
   * dans le champ éditable. Une valeur > `sliderMax` colle le curseur à fond.
   */
  sliderMax?: number;
  /** Incrément. */
  step: number;
  /** Valeur courante. */
  value: number;
  /** Callback de changement. */
  onChange: (v: number) => void;

  // ── Mode encapsulé (tous facultatifs) ───────────────────────────────────

  /** Libellé court affiché au-dessus de la valeur (uppercase tracking). */
  label?: string;
  /** Affiche une pastille « REQUIS » à côté du label (mode encapsulé). */
  required?: boolean;
  /** Suffixe affiché à droite de la valeur (ex. "U", "mm", "kg"). */
  unit?: string;
  /** Override custom de l'affichage de la valeur (sinon `String(value)`). */
  displayValue?: string;
  /** Affiche les bornes min/max sous la barre. */
  showBounds?: boolean;
  /**
   * Si `true` (mode encapsulé uniquement), la valeur affichée devient un
   * `<input type="number">` stylé monospace permettant la saisie directe.
   * La valeur est clampée au range [min, max] au blur (ou à la perte de focus).
   */
  editable?: boolean;
  /**
   * Mode lecture pure : en mode encapsulé, masque le slider (track/thumb)
   * ET les bornes min/max — il ne reste que le label + la valeur dans son
   * cartouche, à pleine opacité. En mode slider nu, on rend un `<input
   * type="range" readOnly>` sans hover/cursor pointer.
   */
  readOnly?: boolean;
  /** Classe additionnelle sur le wrapper (mode encapsulé uniquement). */
  className?: string;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Arrondit `v` à la précision décimale du `step` (step 10 ou 1 → entier,
 * step 0.5 → 1 décimale). On n'arrondit PAS au multiple du step : la saisie
 * manuelle autorise une granularité plus fine que le curseur (ex. 463 W avec
 * step 10). L'API valide les champs mm/W/U en entier strict — sans cet
 * arrondi, une décimale saisie part telle quelle et provoque un 400.
 */
function roundToStepPrecision(v: number, step: number) {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

export function RangeInput({
  min,
  max,
  sliderMax,
  step,
  value,
  onChange,
  label,
  required,
  unit,
  displayValue,
  showBounds,
  editable,
  readOnly,
  className,
}: RangeInputProps) {
  const trackMax = sliderMax ?? max;
  const encapsulated =
    label !== undefined ||
    unit !== undefined ||
    displayValue !== undefined ||
    showBounds === true ||
    editable === true;

  const slider = (
    <input
      type="range"
      min={min}
      max={trackMax}
      step={step}
      // Une valeur saisie > trackMax colle le curseur à fond sans la tronquer.
      value={Math.min(value, trackMax)}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--secondary)] accent-[var(--accent)]"
    />
  );

  if (!encapsulated) {
    // Slider nu en mode read-only : on n'affiche rien d'interactif. Pour rester
    // backward-compatible, on rend le slider standard.
    return slider;
  }

  const shownValue = displayValue ?? String(value);

  return (
    <div className={cn("space-y-3", className)}>
      {(label || unit || displayValue || editable) && (
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)] px-4 py-4 text-center shadow-sm">
          {label && (
            <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
              {label}
              {required && <RequiredPill />}
            </p>
          )}
          {editable && !readOnly ? (
            <EditableValue
              value={value}
              min={min}
              max={max}
              step={step}
              unit={unit}
              onChange={onChange}
            />
          ) : (
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[var(--foreground)]">
              {shownValue}
              {unit && (
                <span className="ml-1 text-base font-medium text-[var(--muted-foreground)]">
                  {unit}
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {!readOnly && (
        <div>
          {slider}
          {showBounds && (
            <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]/70">
              <span>
                {min}
                {unit ? ` ${unit}` : ""}
              </span>
              <span>
                {max}
                {unit ? ` ${unit}` : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EditableValue ──────────────────────────────────────────────────────────

/**
 * Petit input numérique inline pour la saisie manuelle de la valeur d'un
 * slider encapsulé. Le state local permet d'autoriser des valeurs
 * intermédiaires (ex. champ vide pendant la saisie) ; on clamp et propage
 * au blur ou sur "Enter".
 */
function EditableValue({
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Resync depuis l'extérieur (slider qui change la valeur)
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (draft.trim() === "" || draft === "-") {
      setDraft(String(value));
      return;
    }
    const n = Number(draft);
    if (Number.isNaN(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clamp(roundToStepPrecision(n, step), min, max);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="mt-1 flex items-center justify-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "w-24 rounded-md border-0 bg-transparent px-2 py-1 text-center font-mono text-2xl font-semibold tabular-nums text-[var(--foreground)] outline-none ring-0 transition-colors",
          "focus:bg-[var(--background)]/40 focus:outline-none focus:ring-0",
          // Hide the spin buttons (Webkit + Firefox) pour une apparence mono pure
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      {unit && (
        <span className="text-base font-medium text-[var(--muted-foreground)]">
          {unit}
        </span>
      )}
    </div>
  );
}
