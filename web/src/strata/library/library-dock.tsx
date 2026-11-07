"use client";

/**
 * Bibliothèque glissable de l'onglet Rack (interface Strata, spec §6.2) :
 * le catalogue (`allEquipment` du `canvas-data` déjà chargé), filtrable par
 * recherche, catégorie et signal, chaque élément avec sa face arrière en
 * miniature.
 *
 * - Glisser : élément `useDraggable` dans le `DndContext` de
 *   `RackTabDndProvider`, avec la charge utile de la nomenclature ; le canvas
 *   prévisualise et place (`POST /api/racks/{rackId}/slots`). Le serveur ajoute
 *   la ligne de nomenclature (test `rack_slots_catalogue_drop.rs`). Un dépôt
 *   que le canvas refusera faute de place est signalé ici, sans requête.
 * - « Placer » : les trois premiers U libres de chaque contenant affiché ; le
 *   choix envoie le même `POST`. Le canvas reçoit le slot par son flux temps
 *   réel (`useRackSync`).
 *
 * Branché par `withLibraryDock` dans `getEditorSlots` (project-editor.tsx),
 * comme onglet du dock gauche de `StrataEditorShell` ; ignoré en Classique.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import type { EditorShellSlots } from "@/components/editor-shell/editor-shell";
import type { Equipment, Slot, ViewId, WidthFraction } from "@/components/synoptique/lib/types";
import type {
  LocationCanvasData,
  RackCanvasData,
} from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Input } from "@/components/ui/input";
import { Library } from "@/components/ui/icons";
import { apiFetch } from "@/lib/client-id";
import { cn } from "@/lib/utils";
import { drawingConnectorTypes, drawingSignals, parseConnectors, useCatalogueLookup } from "../catalogue-model";
import { dropRefused, freeStartUs } from "./free-slots";
import { LIBRARY_DRAG_PREFIX, LibraryItem, type PlacerChoice } from "./library-item";

/** Contenant cible de la bibliothèque : ses slots à jour. */
export type LibraryRack = { id: string; name: string; totalU: number; slots: Slot[] };

/** Nombre de U libres proposés par « Placer », par contenant. */
const PLACER_CHOICES = 3;

const collator = new Intl.Collator("fr", { sensitivity: "base" });

/** Texte normalisé pour la recherche (casse et accents ignorés). */
function fold(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]"
    >
      {children}
    </div>
  );
}

export function LibraryDock({
  equipment,
  racks,
  view,
}: {
  /** Catalogue (`allEquipment`) ; `null` pendant le chargement. */
  equipment: Equipment[] | null;
  /** Contenants affichés (un en portée contenant, ceux du lieu sinon). */
  racks: LibraryRack[];
  /** Face de pose de « Placer ». */
  view: ViewId;
}) {
  const lookup = useCatalogueLookup();
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [signal, setSignal] = useState<string | null>(null);
  const [placerId, setPlacerId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Slots posés par « Placer », gardés jusqu'à leur retour par le canvas :
  // le serveur ne contrôle pas les collisions, un second choix sur le même U
  // doit déjà le voir occupé.
  const [placed, setPlaced] = useState<Slot[]>([]);

  // Posables en U seulement : ni pose libre (étagère), ni composant d'hôte.
  const items = useMemo(
    () => (equipment ?? []).filter((e) => e.isRackable !== false && !e.isComponent),
    [equipment],
  );
  const connectorsById = useMemo(
    () => new Map(items.map((e) => [e.id, parseConnectors(e.connectors)])),
    [items],
  );
  const categories = useMemo(
    () =>
      [...new Set(items.map((e) => e.category?.trim()).filter((c): c is string => !!c))].sort(collator.compare),
    [items],
  );
  // Signaux présents dans la connectique, dans l'ordre du référentiel.
  const signalOptions = useMemo(() => {
    const present = new Set<string>();
    for (const cs of connectorsById.values()) for (const c of cs) if (c.signalName) present.add(c.signalName);
    const order = new Map((lookup?.signals ?? []).map((s, i) => [s.name, i]));
    const color = new Map((lookup?.signals ?? []).map((s) => [s.name, s.color]));
    return [...present]
      .sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || collator.compare(a, b))
      .map((name) => ({ name, color: color.get(name) }));
  }, [connectorsById, lookup]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return items.filter((e) => {
      if (category && e.category?.trim() !== category) return false;
      if (signal && !(connectorsById.get(e.id) ?? []).some((c) => c.signalName === signal)) return false;
      if (!q) return true;
      return [e.name, e.reference, e.brand?.name, e.category].some((s) => fold(s).includes(q));
    });
  }, [items, query, category, signal, connectorsById]);

  // Slots effectifs : ceux du canvas, plus les poses locales pas encore revenues.
  const liveRacks = useMemo(
    () =>
      racks.map((r) => {
        const known = new Set(r.slots.map((s) => s.id));
        const extra = placed.filter((s) => (s as Slot & { rackId?: string }).rackId === r.id && !known.has(s.id));
        return extra.length ? { ...r, slots: [...r.slots, ...extra] } : r;
      }),
    [racks, placed],
  );
  useEffect(() => {
    // Une pose revenue par le canvas n'a plus besoin d'être gardée.
    const known = new Set(racks.flatMap((r) => r.slots.map((s) => s.id)));
    setPlaced((prev) => (prev.some((s) => known.has(s.id)) ? prev.filter((s) => !known.has(s.id)) : prev));
  }, [racks]);

  // Dépôt d'un élément de la bibliothèque : le canvas place ou refuse ; on
  // nomme ici le refus faute de place.
  const monitor = useMemo(
    () => ({
      onDragStart: () => setMessage(null),
      onDragEnd: (event: DragEndEvent) => {
        if (!String(event.active.id).startsWith(LIBRARY_DRAG_PREFIX)) return;
        const over = event.over?.data.current as
          | { rackId?: string; view?: string; uIndex?: number; col?: number }
          | undefined;
        if (!over?.uIndex) return;
        const rack =
          liveRacks.find((r) => r.id === over.rackId) ?? (over.rackId == null && liveRacks.length === 1 ? liveRacks[0] : undefined);
        const eq = event.active.data.current?.equipment as Equipment | undefined;
        if (!rack || !eq) return;
        const cell = { uIndex: over.uIndex, col: over.col ?? 0, view: over.view ?? "FRONT" };
        if (dropRefused(cell, eq.heightU ?? 1, rack.slots, rack.totalU)) {
          setMessage({ text: `Pas assez d'U libres à partir de U${over.uIndex}`, error: true });
        }
      },
    }),
    [liveRacks],
  );
  useDndMonitor(monitor);

  const choicesFor = useCallback(
    (eq: Equipment): PlacerChoice[] =>
      liveRacks.flatMap((r) =>
        freeStartUs(r.slots, r.totalU, eq.heightU ?? 1, view)
          .slice(0, PLACER_CHOICES)
          .map((startU) => ({ rackId: r.id, rackName: r.name, startU })),
      ),
    [liveRacks, view],
  );

  const place = useCallback(
    async (eq: Equipment, choice: PlacerChoice) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await apiFetch(`/api/racks/${choice.rackId}/slots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            equipmentId: eq.id,
            view,
            startU: choice.startU,
            heightU: eq.heightU ?? 1,
            widthFraction: (eq.widthFraction as WidthFraction | null) ?? "FULL",
            column: 0,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
          setMessage({
            text: typeof body?.error === "string" ? body.error : "Erreur lors du placement.",
            error: true,
          });
          return;
        }
        const slot = (await res.json()) as Slot;
        setPlaced((prev) => [...prev, { ...slot, rackId: choice.rackId } as Slot]);
        setPlacerId(null);
        setMessage({ text: `${eq.name} placé en U${choice.startU}`, error: false });
      } catch {
        setMessage({ text: "Erreur lors du placement.", error: true });
      } finally {
        setBusy(false);
      }
    },
    [view],
  );

  if (equipment === null) return <LoadingState className="py-10" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-1.5 border-b border-[var(--border)] p-2">
        <Input
          type="search"
          aria-label="Rechercher dans la bibliothèque"
          placeholder="Rechercher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {categories.length > 0 && (
          <FilterRow label="Catégorie">
            <FilterChip label="Toutes" active={category === null} onClick={() => setCategory(null)} />
            {categories.map((c) => (
              <FilterChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
            ))}
          </FilterRow>
        )}
        {signalOptions.length > 0 && (
          <FilterRow label="Signal">
            <FilterChip label="Tous" active={signal === null} onClick={() => setSignal(null)} />
            {signalOptions.map((s) => (
              <FilterChip
                key={s.name}
                label={s.name}
                color={s.color}
                active={signal === s.name}
                onClick={() => setSignal(s.name)}
              />
            ))}
          </FilterRow>
        )}
      </div>
      <p
        role="status"
        className={cn(
          "flex-none px-2 text-[11.5px] empty:hidden",
          message && "py-1.5",
          message?.error ? "text-[var(--danger-text)]" : "text-[var(--muted-foreground)]",
        )}
      >
        {message?.text}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <EmptyState icon={<Library strokeWidth={1.5} />} title="Catalogue vide" className="py-10" />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Library strokeWidth={1.5} />} title="Aucun équipement" className="py-10" />
        ) : (
          <ul aria-label="Bibliothèque" className="flex flex-col gap-1.5">
            {shown.map((eq) => (
              <LibraryItem
                key={eq.id}
                equipment={eq}
                connectorTypes={connectorTypes}
                signals={signals}
                placerOpen={placerId === eq.id}
                onTogglePlacer={() => setPlacerId((id) => (id === eq.id ? null : eq.id))}
                choices={placerId === eq.id ? choicesFor(eq) : []}
                showRackNames={liveRacks.length > 1}
                onPlace={(c) => void place(eq, c)}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Données de l'onglet Rack lues par la bibliothèque (état de `ProjectEditor`). */
export type LibraryDockSource = {
  scope: "container" | "location";
  selectedRackId: string | null;
  canvasData: RackCanvasData | null;
  liveSlots: Slot[] | null;
  locationData: LocationCanvasData | null;
  locationLiveSlots: Record<string, Slot[]>;
  visibleViews: ReadonlySet<ViewId>;
  locationView: ViewId;
};

/** Contenants, catalogue et face de pose de la bibliothèque pour la portée affichée. */
export function libraryDockProps(src: LibraryDockSource): {
  equipment: Equipment[] | null;
  racks: LibraryRack[];
  view: ViewId;
} {
  if (src.scope === "location") {
    const data = src.locationData?.racks ?? [];
    return {
      equipment: src.locationData ? (data[0]?.allEquipment ?? []) : null,
      racks: data.map((d) => ({
        id: d.rack.id,
        name: d.rack.name,
        totalU: d.rack.totalU,
        slots: src.locationLiveSlots[d.rack.id] ?? d.rack.slots,
      })),
      view: src.locationView,
    };
  }
  const data = src.canvasData && src.canvasData.rack.id === src.selectedRackId ? src.canvasData : null;
  return {
    equipment: data?.allEquipment ?? null,
    racks: data
      ? [{ id: data.rack.id, name: data.rack.name, totalU: data.rack.totalU, slots: src.liveSlots ?? data.rack.slots }]
      : [],
    view: src.visibleViews.has("FRONT") ? "FRONT" : ([...src.visibleViews][0] ?? "FRONT"),
  };
}

/**
 * Ajoute aux slots de l'onglet Rack les onglets du dock gauche Strata :
 * « Outils » (le panneau latéral existant) et « Bibliothèque ». Sans effet en
 * Classique : `EditorShell` ignore le champ `strata`.
 */
export function withLibraryDock(slots: EditorShellSlots, src: LibraryDockSource): EditorShellSlots {
  return {
    ...slots,
    strata: {
      ...slots.strata,
      leftDockTabs: [
        { id: "outils", label: "Outils", node: slots.leftSidePanel },
        { id: "bibliotheque", label: "Bibliothèque", node: <LibraryDock {...libraryDockProps(src)} /> },
      ],
    },
  };
}
