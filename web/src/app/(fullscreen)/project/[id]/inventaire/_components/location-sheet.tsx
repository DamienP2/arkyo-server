"use client";

/**
 * LocationSheet — fiche de l'emplacement courant (zone principale de
 * l'onglet Inventaire).
 *
 *  - Contenants du lieu en cartes PLEINE LARGEUR empilées, repliables (état
 *    persisté en localStorage par projet).
 *  - Section « Équipements libres » du lieu (items du rack virtuel) : mêmes
 *    rows, liseré vert, cible de drop catalogue (`data-location-id`).
 *  - Boutons dashed : ajouter un équipement libre, ajouter un contenant dans
 *    le lieu. Le remplissage des contenants se fait par drag depuis le
 *    catalogue.
 *  - Vue « À affecter » : contenants hérités sans lieu, avec une action
 *    « Affecter à un emplacement » par carte. Dans la vue lieu, chaque carte
 *    porte une action « Déplacer vers… » (icône) vers un autre lieu.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Boxes, MapPin, PackageOpen, Plus, Server } from "@/components/ui/icons";

import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";

import { ContainerSheetCard } from "./container-sheet-card";
import {
  BomList,
  computeRackTotals,
  formatNum,
  type RackCardData,
} from "./rack-card-canvas";
import { useInventaireScope } from "./inventaire-scope";
import type { InventaireLocation } from "../inventaire-client";

// ── API ──────────────────────────────────────────────────────────────────────

export type LocationSheetHandle = {
  /** Scrolle jusqu'à la carte du contenant (déplie si replié) + surbrillance. */
  focusOnRack: (rackId: string) => void;
  /** Remonte en tête de fiche + surbrillance de l'en-tête. */
  focusOnLocation: (locationId: string) => void;
  /** Élément DOM de la fiche complète — utilisé pour les exports image/PDF. */
  getContainerElement: () => HTMLElement | null;
};

export type LocationSheetProps = {
  /** Lieu affiché — `null` pour la vue « À affecter ». */
  location: InventaireLocation | null;
  /** Contenants du lieu (ou sans lieu dans la vue « À affecter »). */
  containers: RackCardData[];
  /** BOM complet du rack virtuel du lieu (équipements libres + composants). */
  freeBom: RackCardData["bom"];
  /** Rack virtuel du lieu — cible des équipements libres. */
  virtualRackId: string | null;
  /**
   * Lieux du projet — servent au menu « Affecter à un emplacement » (vue
   * « À affecter ») et au menu « Déplacer vers… » (vue lieu, le lieu courant
   * est retiré de la liste).
   */
  assignableLocations?: InventaireLocation[];
  onAssignRack?: (rackId: string, locationId: string) => void;
  selectedRackId?: string | null;
  hoveredRackId?: string | null;
  hoveredLocationId?: string | null;
  onRackSelect?: (rackId: string) => void;
  onRackDelete?: (rackId: string) => void;
  /** Ouvre le catalogue (outil Équipements du panneau latéral). */
  onRequestCatalog?: () => void;
  /** Ouvre le wizard d'ajout de contenant (lieu pré-sélectionné). */
  onAddContainer?: () => void;
  /** Clic hors carte — désélectionne le contenant courant. */
  onBackgroundClick?: () => void;
};

const FLASH_MS = 1400;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// ── Composant ────────────────────────────────────────────────────────────────

export const LocationSheet = forwardRef<LocationSheetHandle, LocationSheetProps>(
  function LocationSheet(
    {
      location,
      containers,
      freeBom,
      virtualRackId,
      assignableLocations,
      onAssignRack,
      selectedRackId,
      hoveredRackId,
      hoveredLocationId,
      onRackSelect,
      onRackDelete,
      onRequestCatalog,
      onAddContainer,
      onBackgroundClick,
    },
    ref,
  ) {
    const { projectId } = useInventaireScope();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);

    // Contenants repliés — persistés par projet (convention : pages =
    // localStorage). La clé contient l'id du contenant, pas celui du lieu :
    // un contenant réaffecté conserve son état.
    const [collapsed, setCollapsed] = useLocalStorageState<string[]>(
      `inventaire-collapsed-${projectId ?? "template"}`,
      [],
      { isValid: isStringArray },
    );
    const toggleCollapsed = useCallback(
      (rackId: string) =>
        setCollapsed((prev) =>
          prev.includes(rackId)
            ? prev.filter((id) => id !== rackId)
            : [...prev, rackId],
        ),
      [setCollapsed],
    );

    // Surbrillance temporaire (focus depuis le panneau latéral).
    const [flashId, setFlashId] = useState<string | null>(null);
    useEffect(() => {
      if (!flashId) return;
      const t = setTimeout(() => setFlashId(null), FLASH_MS);
      return () => clearTimeout(t);
    }, [flashId]);

    useImperativeHandle(
      ref,
      () => ({
        focusOnRack: (rackId: string) => {
          setCollapsed((prev) => prev.filter((id) => id !== rackId));
          setFlashId(rackId);
          requestAnimationFrame(() => {
            contentRef.current
              ?.querySelector(`[data-rack-id="${CSS.escape(rackId)}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        },
        focusOnLocation: (locationId: string) => {
          setFlashId(locationId);
          requestAnimationFrame(() =>
            scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }),
          );
        },
        getContainerElement: () => contentRef.current,
      }),
      [setCollapsed],
    );

    const freeItems = useMemo(
      () => (freeBom ?? []).filter((it) => it.hostItemId == null),
      [freeBom],
    );
    const freeTotals = useMemo(() => {
      let weightKg = 0;
      let powerW = 0;
      for (const it of freeBom ?? []) {
        if (typeof it.weightKg === "number") weightKg += it.weightKg * it.quantity;
        if (typeof it.powerW === "number") powerW += it.powerW * it.quantity;
      }
      return { weightKg, powerW };
    }, [freeBom]);

    const unassignedView = location === null;
    const isDropTargetFree = hoveredLocationId === location?.id;
    // Vue lieu : le menu « Déplacer vers… » propose les AUTRES lieux.
    const moveTargets = useMemo(
      () =>
        location
          ? (assignableLocations ?? []).filter((l) => l.id !== location.id)
          : (assignableLocations ?? []),
      [assignableLocations, location],
    );

    // ── Vue « À affecter » vide ─────────────────────────────────────────────
    if (unassignedView && containers.length === 0) {
      return (
        <div
          ref={scrollRef}
          className="h-full w-full overflow-y-auto bg-[var(--background)]"
        >
          <div
            ref={contentRef}
            className="flex h-full items-center justify-center p-6"
          >
            <EmptyState
              icon={<PackageOpen strokeWidth={1.5} />}
              title="Aucun contenant à affecter"
              description="Tous les contenants du projet sont rattachés à un emplacement."
            />
          </div>
        </div>
      );
    }

    return (
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-auto bg-[var(--background)]"
        onPointerDown={(e) => {
          if (
            (e.target as HTMLElement).closest("[data-rack-id],[data-location-id]")
          ) {
            return;
          }
          onBackgroundClick?.();
        }}
      >
        <div ref={contentRef} className="flex flex-col gap-3 p-5">
          {/* Lieu sans contenant : l'état vide reste au-dessus de la section
              des équipements libres, qui demeure une cible de drop. */}
          {location && containers.length === 0 && (
            <div className="py-6">
              <EmptyState
                icon={<Server strokeWidth={1.5} />}
                title="Aucun contenant"
                description={`Créez-en un ou glissez du matériel en libre dans ${location.name}.`}
                action={
                  onAddContainer ? (
                    <EmptyStateAction onClick={onAddContainer}>
                      <Plus className="h-3.5 w-3.5" />
                      Ajouter un contenant
                    </EmptyStateAction>
                  ) : undefined
                }
              />
            </div>
          )}

          {/* Ajout d'un contenant — AVANT la première carte du lieu. */}
          {location && onAddContainer && containers.length > 0 && (
            <button
              type="button"
              onClick={onAddContainer}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--secondary)]/20 px-4 py-2.5 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
            >
              <Plus className="h-4 w-4" />
              Contenant dans {location.name}
            </button>
          )}

          {containers.map((rack) => (
            <ContainerSheetCard
              key={rack.id}
              rack={rack}
              collapsed={collapsed.includes(rack.id)}
              onToggleCollapsed={() => toggleCollapsed(rack.id)}
              selected={selectedRackId === rack.id}
              isOver={hoveredRackId === rack.id}
              flash={flashId === rack.id}
              onSelect={onRackSelect ? () => onRackSelect(rack.id) : undefined}
              onDelete={onRackDelete ? () => onRackDelete(rack.id) : undefined}
              assignableLocations={moveTargets}
              onAssign={
                onAssignRack
                  ? (locationId) => onAssignRack(rack.id, locationId)
                  : undefined
              }
              assignVariant={unassignedView ? "assign" : "move"}
            />
          ))}

          {/* Équipements libres du lieu — liseré vert, cible de drop catalogue. */}
          {location && virtualRackId && (
            <div
              data-location-id={location.id}
              className={cn(
                "overflow-hidden rounded-xl border transition-colors",
                isDropTargetFree
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-[var(--border)] bg-[var(--card)]",
              )}
              style={{ borderLeftWidth: 3, borderLeftColor: "#2f9e44" }}
            >
              <div className="flex items-center gap-2.5 border-b border-[var(--border)]/50 bg-[var(--secondary)]/30 px-3 py-2">
                <Boxes className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                <span className="truncate text-[13px] font-bold uppercase">
                  Équipements libres
                </span>
                <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--secondary)]/60 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wide text-[var(--muted-foreground)] uppercase">
                  Sans contenant
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                  {formatNum(freeTotals.powerW)} W ·{" "}
                  {formatNum(freeTotals.weightKg)} kg
                </span>
              </div>
              <div className="px-2 pt-1 pb-3">
                <BomList
                  rackId={virtualRackId}
                  bom={freeBom ?? []}
                  slotVariant="ruler"
                  emptyLabel="Aucun équipement libre — glissez-en depuis le catalogue."
                />
              </div>
            </div>
          )}

          {unassignedView && containers.length > 0 && (
            <p className="flex items-center justify-center gap-2 py-1 text-[11px] text-[var(--muted-foreground)]">
              <MapPin className="h-3.5 w-3.5" />
              Ces contenants ne sont rattachés à aucun emplacement.
            </p>
          )}
        </div>
      </div>
    );
  },
);
