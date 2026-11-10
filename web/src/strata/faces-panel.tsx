/**
 * Bandeau des faces de l'éditeur d'équipement pleine page (interface Strata
 * v2, spec v2 §4.3, maquette `.ed-faces`) : faces avant et arrière à
 * l'échelle, côte à côte, dessinées depuis le formulaire en cours de saisie
 * (`form.connectorEntries`), donc mises à jour à chaque modification de la
 * connectique.
 *
 * Le schéma de principe vit dans la colonne d'aperçu de la mise en page
 * (`pages/equipment-editor-layout.tsx`) ; le survol d'une entrée est partagé
 * par `hoverEntry` / `onEntryHover`. Le bandeau se replie (mémorisé dans le
 * navigateur).
 */

import { useMemo, useState } from "react";
import type { FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { ChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { EquipmentFace } from "./drawings/equipment-face";
import { FACE_WIDTH_MM, portCount, type FaceSide } from "./drawings/face-layout";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  totalPorts,
  type CatalogueLookup,
} from "./catalogue-model";

/** Référentiels de l'éditeur (`brands`, `connectorTypes`, `signals`, `functions`). */
export type FacesLookup = CatalogueLookup;

const OPEN_KEY = "strata:faces-panel:open";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* stockage indisponible : l'état reste celui de la session */
  }
}

const FACES: { side: FaceSide; label: string }[] = [
  { side: "FRONT", label: "Face avant" },
  { side: "REAR", label: "Face arrière" },
];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Nom dessiné sur les faces et le schéma : celui du formulaire, sinon « Nouvel équipement ». */
export function drawnName(form: Pick<FormData, "name">): string {
  return form.name.trim() || "Nouvel équipement";
}

export function FacesPanel({
  form,
  lookup,
  hoverEntry: hoverProp,
  onEntryHover,
}: {
  form: FormData;
  lookup: FacesLookup;
  /** Survol partagé avec le schéma de principe (sinon, état propre au bandeau). */
  hoverEntry?: number | null;
  onEntryHover?: (entry: number | null) => void;
}) {
  const [open, setOpen] = useState(readOpen);
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const hoverEntry = hoverProp !== undefined ? hoverProp : ownHover;
  const setHover = onEntryHover ?? setOwnHover;

  const connectors = form.connectorEntries;
  // L'éditeur passe un nouvel objet `lookup` à chaque rendu : mémo sur ses listes.
  const { connectorTypes: types, signals: sigs, functions: fns } = lookup;
  const connectorTypes = useMemo(() => drawingConnectorTypes({ connectorTypes: types }), [types]);
  const signals = useMemo(() => drawingSignals({ signals: sigs, functions: fns }), [sigs, fns]);
  const ports = totalPorts(connectors);
  const name = drawnName(form);
  const brand = lookup.brands?.find((b) => b.id === form.brandId)?.name ?? null;
  const dims = [form.dimLmm, form.dimWmm, form.dimHmm].filter((d): d is number => typeof d === "number" && d > 0);
  const summary = [
    plural(ports, "port"),
    form.isRackable ? `${fmtNumber(form.heightU)} U · ${fmtNumber(FACE_WIDTH_MM)} mm` : "pose libre",
  ].join(" · ");

  const toggle = () => {
    setOpen((o) => {
      writeOpen(!o);
      return !o;
    });
  };

  return (
    <section aria-label="Faces" className="rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
      <header className={cn("flex items-center gap-2.5 px-3.5 py-2.5", open && "border-b border-[var(--border)]")}>
        <h2 className="m-0 text-[13px] font-bold text-[var(--foreground)]">Faces</h2>
        <span className="flex-1 truncate text-xs text-[var(--text-tertiary)] tabular-nums">{summary}</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? "Replier" : "Déplier"} le bandeau des faces`}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </header>
      {open && (
        <div data-faces-body="" className="grid items-start gap-3 p-3.5 lg:grid-cols-2">
          {FACES.map(({ side, label }) => {
            const n = connectors.filter((c) => c.face === side).reduce((a, c) => a + portCount(c), 0);
            return (
              <div
                key={side}
                className="grid min-w-0 content-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--strata-face-well)] px-3 pt-2 pb-3"
              >
                {/* Puits sombre dans les deux thèmes : encre des dessins de face. */}
                <div className="flex justify-between gap-2 text-[11px] font-bold tracking-[0.06em] text-[var(--strata-face-ink-2)] uppercase">
                  <span>{label}</span>
                  <span className="tabular-nums">{n ? plural(n, "port") : "sans connectique"}</span>
                </div>
                <EquipmentFace
                  equipment={{
                    name,
                    brand,
                    heightU: form.heightU,
                    isRackable: form.isRackable,
                    dims: dims.length ? dims : null,
                    connectors,
                  }}
                  face={side}
                  connectorTypes={connectorTypes}
                  signals={signals}
                  hoverEntry={hoverEntry}
                  onEntryHover={setHover}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
