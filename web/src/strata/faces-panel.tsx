/**
 * Panneau « Faces et schéma » de la fiche équipement (onglet Connectique,
 * interface Strata ; spec §6.3, maquette `viewFiche`, onglet connectique) :
 * faces avant et arrière à l'échelle et schéma de principe, dessinés depuis le
 * formulaire en cours de saisie (`form.connectorEntries`), donc mis à jour à
 * chaque modification de la connectique.
 *
 * Le survol d'une entrée sur une face la surligne dans le schéma, et
 * inversement. La liste des ports reste celle de l'onglet Connectique
 * existant, juste en dessous. Le panneau se replie (mémorisé dans le
 * navigateur) et son contenu est plafonné à 32 % de la hauteur de la fenêtre
 * (défilement propre ; à partir de `xl`, faces à gauche et schéma à droite) :
 * `StrataConnectivityLayout` le pose au-dessus de
 * l'onglet Connectique, dont la liste des ports garde le reste de la hauteur.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { ChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { BlockDiagram } from "./drawings/block-diagram";
import { EquipmentFace } from "./drawings/equipment-face";
import { FACE_WIDTH_MM, type FaceSide } from "./drawings/face-layout";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  portFamilies,
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
  { side: "FRONT", label: "Avant" },
  { side: "REAR", label: "Arrière" },
];

export function FacesPanel({ form, lookup }: { form: FormData; lookup: FacesLookup }) {
  const [open, setOpen] = useState(readOpen);
  const [hoverEntry, setHoverEntry] = useState<number | null>(null);

  const connectors = form.connectorEntries;
  // L'éditeur passe un nouvel objet `lookup` à chaque rendu : mémo sur ses listes.
  const { connectorTypes: types, signals: sigs, functions: fns } = lookup;
  const connectorTypes = useMemo(() => drawingConnectorTypes({ connectorTypes: types }), [types]);
  const signals = useMemo(() => drawingSignals({ signals: sigs, functions: fns }), [sigs, fns]);
  const families = portFamilies(connectors, lookup);
  const ports = totalPorts(connectors);
  const name = form.name.trim() || "Sans nom";
  const brand = lookup.brands?.find((b) => b.id === form.brandId)?.name ?? null;
  const dims = [form.dimLmm, form.dimWmm, form.dimHmm].filter((d): d is number => typeof d === "number" && d > 0);
  const summary = [
    `${ports} port${ports > 1 ? "s" : ""}`,
    form.isRackable ? `${fmtNumber(form.heightU)} U · ${fmtNumber(FACE_WIDTH_MM)} mm` : "pose libre",
  ].join(" · ");

  const toggle = () => {
    setOpen((o) => {
      writeOpen(!o);
      return !o;
    });
  };

  return (
    <section
      aria-label="Faces et schéma"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className={cn("flex items-center gap-2.5 px-3.5 py-2.5", open && "border-b border-[var(--border)]")}>
        <h3 className="text-[12.5px] font-semibold text-[var(--foreground)]">Faces et schéma</h3>
        <span className="flex-1 truncate text-xs text-[var(--text-tertiary)] tabular-nums">{summary}</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? "Replier" : "Déplier"} le panneau Faces et schéma`}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </header>
      {open && (
        <div
          data-faces-body=""
          className="grid max-h-[32vh] items-start gap-4 overflow-y-auto p-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <div className="grid min-w-0 gap-3">
            {FACES.map(({ side, label }) => {
              const empty = !connectors.some((c) => c.face === side);
              return (
                <div key={side} className="grid min-w-0 content-start gap-1.5">
                  <span className="text-[11px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                    {empty ? `${label} · sans connectique` : label}
                  </span>
                  <div className="rounded border border-[var(--border)] bg-[var(--strata-face-well)] p-2.5">
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
                      onEntryHover={setHoverEntry}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex-1 text-[11px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                Schéma de principe
              </span>
              {families.length > 0 && (
                <ul
                  aria-label="Familles de signal"
                  className="flex flex-wrap gap-3 text-[11.5px] text-[var(--muted-foreground)] tabular-nums"
                >
                  {families.map((f) => (
                    <li key={f.key} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0" style={{ background: f.color }} />
                      {`${f.label} ${f.count}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <BlockDiagram
                connectors={connectors}
                connectorTypes={connectorTypes}
                signals={signals}
                name={name}
                brand={brand}
                is2110={form.is2110}
                hoverEntry={hoverEntry}
                onEntryHover={setHoverEntry}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Disposition de l'onglet Connectique en Strata : le panneau (hauteur propre,
 * plafonnée) puis l'onglet existant, qui prend le reste de la hauteur et garde
 * son unique zone de défilement (liste des ports, glisser-déposer). Hors
 * Strata, rend l'onglet tel quel (aucun élément ajouté au DOM).
 */
export function StrataConnectivityLayout({
  enabled,
  panel,
  children,
}: {
  enabled: boolean;
  panel: ReactNode;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <div data-strata-connectivity="" className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">{panel}</div>
      <div data-strata-connectivity-tab="" className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
