"use client";

/**
 * Onglet Inventaire — fiche de l'emplacement courant.
 *
 *  - `LocationSheet` : contenants du lieu en cartes pleine largeur repliables
 *    (rows BOM + réglettes de slots) + section « Équipements libres ».
 *  - Le lieu affiché vient du scope (`selectedLocationId`, persisté), piloté
 *    par le sélecteur de la sous-topbar et par l'outil « Emplacement ».
 *  - Le `DndContext` englobant est fourni par `InventaireScope` au-dessus de
 *    l'`EditorShell` (cf. `project-editor.tsx`) afin que side panel et fiche
 *    partagent le même contexte DnD.
 *  - Wizard `AddContainerWizard` rendu localement, contrôlé par les props
 *    `addOpen` / `onAddOpenChange`.
 *
 * État remonté au project-editor : `activeTool`, `addOpen`, `canvasRef`.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, Server } from "@/components/ui/icons";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { api, getApiErrorMessage } from "@/lib/api-client";

import { AddContainerWizard } from "./_components/add-container-wizard";
import {
  UNASSIGNED_LOCATION_ID,
  useInventaireScope,
} from "./_components/inventaire-scope";
import {
  LocationSheet,
  type LocationSheetHandle,
} from "./_components/location-sheet";

// ── Slot minimal côté server (sans id — on en synthétise un au map) ──────────

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
type RackView = "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE";

type InventaireSlot = {
  startU: number;
  heightU: number;
  widthFraction: WidthFraction;
  view: RackView;
  category?: string | null;
  categoryId?: string | null;
  /** Nom de l'équipement placé sur ce slot — pour la liste expanded de la card. */
  equipmentName?: string | null;
  /** Référence interne de l'équipement (ex. "X-LF8RT2"). */
  equipmentReference?: string | null;
  /** Marque de l'équipement. */
  brandName?: string | null;
  /** Poids de l'équipement (kg) — utilisé pour le total projet du synoptique. */
  weightKg?: number | null;
  /** Conso de l'équipement (W) — utilisée pour le total projet du synoptique. */
  powerW?: number | null;
};

// ── Types ────────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

export type InventaireBomItem = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /**
   * Identité catalogue de la row (catalogEquipmentId / panelId / catalogAdapterId).
   * Utilisée pour regrouper les exemplaires d'un même équipement hôte (badges
   * #1/#2, flux « nouvel exemplaire »). Absent pour les accessoires (pas
   * d'entité catalogue dédiée).
   */
  refId?: string;
  quantity: number;
  name: string;
  reference: string | null;
  brandName: string | null;
  category: string | null;
  /** Couleur de la catégorie/fonction primaire (hex). Source : CatalogFunction.color. */
  categoryColor: string | null;
  /** Attributs physiques (équipement uniquement, sinon null/false). */
  isRackable: boolean;
  heightU: number | null;
  depthMm: number | null;
  weightKg: number | null;
  powerW: number | null;
  /**
   * ID du snapshot ProjectCatalogueSnapshot associé (items Arkyo équipement/adaptateur).
   * Utilisé pour détecter et appliquer la dérive (drift) catalogue Arkyo.
   * null pour les items personnels, panels et accessoires.
   */
  snapshotId: string | null;
  // ── Composants modulaires (châssis type Ross openGear) ──────────────────────
  // Optionnels : fournis par l'API GET inventory (via toScopeBomItem), mais
  // omis par les producteurs SSR (project/rack page.tsx, clone-from-template)
  // qui n'enrichissent pas encore ces champs. Le refetch client les remplit.
  /** Non-null si cet item est un composant installé dans un hôte (pointe l'hôte). */
  hostItemId?: string | null;
  /** Position (0-based) occupée dans l'hôte — null si non imbriqué. */
  hostSlotIndex?: number | null;
  /** L'équipement de cet item peut-il accueillir des composants ? */
  isComponentHost?: boolean;
  /** Nombre de slots internes de l'hôte — null si non applicable. */
  hostSlotCount?: number | null;
  /** Cet équipement est-il conçu pour être installé comme composant ? */
  isComponent?: boolean;
  /** Nombre de slots occupés dans l'hôte une fois installé. */
  componentSlotSpan?: number;
};

export type InventaireRack = {
  id: string;
  rigConfigId: string;
  name: string;
  rackType: RackType;
  totalU: number;
  depthMm: number;
  /** Largeur extérieure mm — pertinent pour non-rackable (flight, pelicase…). */
  widthMm: number | null;
  /** Hauteur extérieure mm — pertinent pour non-rackable. */
  heightMm: number | null;
  hasWheels: boolean;
  emptyWeightKg: number | null;
  slotsCount: number;
  constructionChecks: number;
  /**
   * true → contenant rackable (baie 19", flight case…) → mode placement disponible.
   * false → pelicase, casquette, etc. → pas de placement physique.
   */
  isRackable: boolean;
  /**
   * true → au moins un équipement placé dans ce contenant possède des
   * connecteurs (Equipment.connectors non vide). Utilisé par le sélecteur
   * de contenant du synoptique pour masquer les contenants sans connectique
   * (vue focus inutile).
   */
  hasConnectors: boolean;
  /** Position canvas X (px logiques). null → auto-layout grille. */
  canvasX: number | null;
  /** Position canvas Y (px logiques). null → auto-layout grille. */
  canvasY: number | null;
  /**
   * Emplacement (lieu) auquel le contenant est affecté. `null` = contenant
   * hérité de la migration, affiché dans la bande « À affecter ».
   */
  locationId?: string | null;
  /**
   * Contenant virtuel d'un lieu — porte les équipements libres. Jamais listé
   * comme contenant (inventaire, dropdown Rack, documents…), mais ses items
   * comptent dans le BOM / les exports.
   */
  isVirtual?: boolean;
  /** Slots minimaux pour la mini SVG (vue front uniquement). */
  slots: InventaireSlot[];
  /** BOM agrégé (items ajoutés via drag&drop, avant placement physique). */
  bom: InventaireBomItem[];
};

/**
 * Emplacement (lieu) d'un projet — régie, nodal, plateau, car…
 * Regroupe des contenants et des équipements libres (portés par son rack
 * virtuel `virtualRackId`).
 */
export type InventaireLocation = {
  id: string;
  name: string;
  /** Code court pour la numérotation câbles (uppercase, ≤5). */
  cableCode: string | null;
  sortOrder: number;
  /** Rack virtuel du lieu — porte les équipements libres. */
  virtualRackId: string | null;
};

// ── Component ────────────────────────────────────────────────────────────────

export type InventaireClientHandle = {
  /** Renvoie le handle de la fiche de lieu (focus + capture export). */
  getCanvas: () => LocationSheetHandle | null;
};

export const InventaireClient = forwardRef<
  InventaireClientHandle,
  {
    rigConfigId: string | null;
    /** Modal "Ajouter un contenant" — contrôlé par le parent. */
    addOpen: boolean;
    onAddOpenChange: (open: boolean) => void;
    /** Ouvre le panneau catalogue (outil Équipements) — boutons « Ajouter ». */
    onRequestCatalog?: () => void;
  }
>(function InventaireClient(
  { rigConfigId: _rigConfigId, addOpen, onAddOpenChange, onRequestCatalog },
  ref,
) {
  const confirm = useConfirm();
  const canvasRef = useRef<LocationSheetHandle | null>(null);
  const {
    projectId,
    racks,
    setRacks,
    locations,
    selectedLocationId,
    setSelectedLocationId,
    assignRackToLocation,
    expandedRackId,
    setExpandedRackId,
    selectedItem,
    selectItem,
    selectRack,
    hoveredRackId,
    hoveredLocationId,
  } = useInventaireScope();

  // Contenants réels : les racks virtuels des lieux ne sont jamais listés
  // comme contenants (leurs items sont rendus en équipements libres).
  const containers = useMemo(() => racks.filter((r) => !r.isVirtual), [racks]);

  // ── Lieu affiché ────────────────────────────────────────────────────────
  const isUnassignedView = selectedLocationId === UNASSIGNED_LOCATION_ID;
  // Fallback sur le premier lieu tant que le scope n'a pas résolu la valeur
  // persistée (évite un flash de la vue « À affecter » au mount).
  const currentLocation = useMemo(
    () =>
      isUnassignedView
        ? null
        : (locations.find((l) => l.id === selectedLocationId) ??
          locations[0] ??
          null),
    [locations, selectedLocationId, isUnassignedView],
  );
  /** Contenants de la fiche courante (ou contenants sans lieu). */
  const sheetContainers = useMemo(
    () =>
      isUnassignedView
        ? containers.filter((r) => !r.locationId)
        : currentLocation
          ? containers.filter((r) => r.locationId === currentLocation.id)
          : [],
    [containers, currentLocation, isUnassignedView],
  );
  /** BOM du rack virtuel du lieu — les équipements libres. */
  const freeBom = useMemo(
    () =>
      currentLocation?.virtualRackId
        ? (racks.find((r) => r.id === currentLocation.virtualRackId)?.bom ?? [])
        : [],
    [racks, currentLocation],
  );

  // ESC → désélectionne l'item puis la card courante (parallèle au click hors
  // canvas). L'item d'abord : c'est la sélection la plus fine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expandedRackId === null && selectedItem === null) return;
      // Ignore si l'utilisateur est en train de saisir dans un input.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (selectedItem) selectItem(null);
      else setExpandedRackId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedRackId, selectedItem, selectItem, setExpandedRackId]);

  // Expose le handle canvas au parent (project-editor).
  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
    }),
    [],
  );

  // ── Scroll vers un contenant fraîchement créé ────────────────────────────
  // Le wizard pose l'id ici ; dès que la carte est montée dans sa section, on
  // scrolle dessus (+ surbrillance). Remplace l'ancien auto-fit du canvas.
  const [pendingFocusRackId, setPendingFocusRackId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!pendingFocusRackId) return;
    // La carte doit être montée dans la fiche courante pour être scrollée.
    if (!sheetContainers.some((r) => r.id === pendingFocusRackId)) return;
    const id = requestAnimationFrame(() => {
      canvasRef.current?.focusOnRack(pendingFocusRackId);
      setPendingFocusRackId(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocusRackId, sheetContainers]);

  // ── Suppression d'un rack (via bouton trash sur card) ────────────────────

  const [deletingRackId, setDeletingRackId] = useState<string | null>(null);

  const handleDeleteRack = async (rackId: string) => {
    const rack = racks.find((r) => r.id === rackId);
    if (!rack) return;
    const ok = await confirm({
      title: `Supprimer « ${rack.name} » ?`,
      description:
        "Le contenant et toutes ses données associées (BOM, équipements placés, câblage, etc.) seront supprimés définitivement.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingRackId(rackId);
    try {
      await api.delete(`/api/tenant/projects/${projectId}/racks/${rackId}`);
      setRacks((prev) => prev.filter((r) => r.id !== rackId));
    } catch (e) {
      window.alert(getApiErrorMessage(e));
    } finally {
      setDeletingRackId(null);
    }
  };

  // ── Empty state global : ni emplacement ni contenant ────────────────────

  if (containers.length === 0 && locations.length === 0) {
    return (
      <>
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Server strokeWidth={1.5} />}
            title="Aucun contenant"
            description="Ajoutez un contenant pour commencer à organiser votre régie."
            action={
              <EmptyStateAction onClick={() => onAddOpenChange(true)}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter un contenant
              </EmptyStateAction>
            }
          />
        </div>
        {/* Wizard ajout contenant — uniquement en mode projet (projectId requis) */}
        {projectId && (
          <AddContainerWizard
            open={addOpen}
            onOpenChange={onAddOpenChange}
            projectId={projectId}
            defaultLocationId={currentLocation?.id ?? null}
            existingNames={containers.map((r) => r.name)}
            onCreated={(rack) => {
              // Désélectionne le contenant courant pour que le panel droit
              // n'affiche pas un rack obsolète après création.
              setExpandedRackId(null);
              setRacks((prev) => [...prev, rack]);
              // Le wizard permet de choisir un autre lieu que celui affiché :
              // on bascule la fiche dessus.
              if (rack.locationId) setSelectedLocationId(rack.locationId);
              setPendingFocusRackId(rack.id);
              onAddOpenChange(false);
            }}
          />
        )}
      </>
    );
  }

  // ── Fiche du lieu (le DndContext est fourni par InventaireScope en amont) ──

  const toSheetRack = (r: InventaireRack) => ({
    id: r.id,
    name: r.name,
    rackType: r.rackType,
    totalU: r.totalU,
    depthMm: r.depthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
    emptyWeightKg: r.emptyWeightKg,
    slotsCount: r.slotsCount,
    isRackable: r.isRackable,
    bom: r.bom ?? [],
  });

  return (
    <>
      <LocationSheet
        ref={canvasRef}
        location={isUnassignedView ? null : currentLocation}
        containers={sheetContainers.map(toSheetRack)}
        freeBom={freeBom}
        virtualRackId={currentLocation?.virtualRackId ?? null}
        assignableLocations={locations}
        onAssignRack={(rackId, locationId) =>
          void assignRackToLocation(rackId, locationId)
        }
        selectedRackId={expandedRackId}
        hoveredRackId={hoveredRackId}
        hoveredLocationId={hoveredLocationId}
        onRackSelect={(rackId) => selectRack(rackId)}
        onRackDelete={(rackId) => {
          if (deletingRackId === rackId) return;
          void handleDeleteRack(rackId);
        }}
        onRequestCatalog={onRequestCatalog}
        onAddContainer={() => onAddOpenChange(true)}
        onBackgroundClick={() => {
          setExpandedRackId(null);
          selectItem(null);
        }}
      />

      {/* Wizard ajout contenant — uniquement en mode projet (projectId requis) */}
      {projectId && (
        <AddContainerWizard
          open={addOpen}
          onOpenChange={onAddOpenChange}
          projectId={projectId}
          defaultLocationId={currentLocation?.id ?? null}
          existingNames={containers.map((r) => r.name)}
          onCreated={(rack) => {
            // Désélectionne le contenant courant pour que le panel droit
            // n'affiche pas un rack obsolète après création.
            setExpandedRackId(null);
            setRacks((prev) => [...prev, rack]);
            // Le wizard permet de choisir un autre lieu que celui affiché :
            // on bascule la fiche dessus.
            if (rack.locationId) setSelectedLocationId(rack.locationId);
            setPendingFocusRackId(rack.id);
            onAddOpenChange(false);
          }}
        />
      )}
    </>
  );
});
