"use client";

import { RangeInput } from "@/components/wizard/range-input";

import { FormData, SignalCapacity } from "./types";

// ── Essences SMPTE 2110 prises en charge (PAS 2110-10 PTP) ──────────────────
//
// Les noms canoniques correspondent à ceux utilisés comme label d'essence
// local dans `FormData.signalCapacities[].signalName`. Ils ne référencent
// plus de CatalogSignalType depuis la fusion en "SMPTE 2110 (Media)".

type EssenceKey = "video" | "audio" | "anc";

type EssenceDef = {
  key: EssenceKey;
  /** Label local de l'essence (clé dans signalCapacities). */
  signalName: string;
  /** Libellé court affiché dans le label du RangeInput. */
  title: string;
  /** Sous-titre (norme SMPTE). */
  subtitle: string;
};

const ESSENCES: EssenceDef[] = [
  { key: "video", signalName: "SMPTE 2110-20 (Vidéo)", title: "Vidéo", subtitle: "SMPTE 2110-20" },
  { key: "audio", signalName: "SMPTE 2110-30 (Audio)", title: "Audio", subtitle: "SMPTE 2110-30" },
  { key: "anc", signalName: "SMPTE 2110-40 (ANC)", title: "ANC", subtitle: "SMPTE 2110-40" },
];

/** Lit la capacité OUT d'un signal donné. */
function getOut(caps: SignalCapacity[], signalName: string): number {
  return caps.find((c) => c.signalName === signalName)?.out ?? 0;
}

export function CapacityIpTab({
  form,
  set,
  onCapacityChange,
  catColor,
  readOnly,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  onCapacityChange: (
    signalName: string,
    patch: { in?: number; out?: number },
  ) => void;
  catColor: string;
  /** Lecture pure : valeurs visibles, sliders masqués (cf. RangeInput). */
  readOnly?: boolean;
}) {
  // Marqueurs no-op pour signaler à TS que les props non consommées
  // restent supportées par l'API publique du composant.
  void set;
  void catColor;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {ESSENCES.map((def) => {
        const out = getOut(form.signalCapacities, def.signalName);
        return (
          <RangeInput
            key={def.key}
            min={0}
            max={64}
            step={1}
            value={out}
            onChange={(v) => onCapacityChange(def.signalName, { out: v })}
            label={`${def.title} · ${def.subtitle}`}
            unit="flux"
            editable
            showBounds
            readOnly={readOnly}
          />
        );
      })}
    </div>
  );
}
