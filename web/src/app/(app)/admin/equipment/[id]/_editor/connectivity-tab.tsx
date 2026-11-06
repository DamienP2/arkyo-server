"use client";

/**
 * ConnectivityTab — refonte 2026-05-23.
 *
 * Aligné sur les patterns de l'éditeur adaptateur (`adapter-editor.tsx`) et
 * du `connector-picker-modal` monochrome :
 *
 *  - Sous-onglets de faces inchangés (`ConnectivityFaceTabs`).
 *  - Liste de connecteurs rendue sous forme de **grille de cards** au lieu
 *    de la liste compacte précédente. Chaque card = un groupe de connecteurs
 *    (un type avec sa quantité, sa direction et son genre).
 *  - Bouton « + Ajouter un groupe de connecteurs » dashed, placé en
 *    dernière case de la grille (pattern adaptateur `OutputPortRow`).
 *  - Modal d'ajout/édition **simplifiée** :
 *      • `ConnectorPickerTrigger` + `ConnectorPickerModal` pour le connecteur
 *      • chips Direction (IN / OUT / I/O)
 *      • chips Genre (Mâle / Femelle)
 *      • `RangeInput editable` 1-1024 pour la quantité (grilles denses : 244+ SDI)
 *      • input texte pour le label (optionnel)
 *      • select pour le signal (optionnel)
 *
 * Le format JSON `ConnectorEntry` (cf. `types.ts`) est strictement préservé :
 *  - `gender: "MALE" | "FEMALE"` (pas de "NEUTRAL")
 *  - `direction: "IN" | "OUT" | "BOTH"`
 *  - autres champs `networkRole`, `disableRedundancy`, `version` conservés
 *    pour rétro-compat même si non éditables ici (édition fine = passer par
 *    la fiche détaillée du port à venir).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit2,
  FlipHorizontal,
  GripVertical,
  Monitor,
  Plug,
  Plus,
  Copy,
  Trash2,
} from "@/components/ui/icons";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SynopticNode } from "@/components/synoptique/components/synoptic-node";
import type {
  Port,
  ConnectorTypeInfo,
  RackSlotWithEquipment,
  ConnectorEntry as SynopticConnectorEntry,
} from "@/components/synoptique/types/synoptic";
import {
  NODE_W,
  PORT_H,
  NODE_HEADER_H,
  NODE_MIN_H,
} from "@/components/synoptique/types/synoptic";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ConnectorPickerModal,
  ConnectorPickerTrigger,
} from "@/components/catalogue/connector-picker-modal";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { RangeInput } from "@/components/wizard/range-input";
import { RequiredPill } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";

import {
  CatalogFunctionLite,
  ConnectorEntry,
  ConnectorType,
  DIR_OPTIONS,
  FACE_LABELS,
  FACE_ORDER,
  FormData,
  GENDER_OPTIONS,
  Signal,
  SignalCategory,
  uid,
} from "./types";

type FaceId = ConnectorEntry["face"];

const FACE_ICONS: Record<FaceId, React.ComponentType<{ className?: string }>> = {
  FRONT: Monitor,
  REAR: FlipHorizontal,
  LEFT: ChevronLeft,
  RIGHT: ChevronRight,
  TOP: ChevronUp,
  BOTTOM: ChevronDown,
};

// ─── Sous-onglets de faces ─────────────────────────────────────────────────
//
// Inchangé. Le parent (`equipment-editor.tsx`) rend ce composant directement
// sous la TabBar principale via le pattern L-leg.

export function ConnectivityFaceTabs({
  form,
  activeFace,
  setActiveFace,
  paddingLeft,
}: {
  form: FormData;
  activeFace: FaceId;
  setActiveFace: (f: FaceId) => void;
  paddingLeft?: number | null;
}) {
  return (
    <div
      className="flex items-stretch"
      style={{
        paddingLeft: paddingLeft != null ? `${paddingLeft}px` : undefined,
        visibility: paddingLeft != null ? "visible" : "hidden",
      }}
    >
      <div className="h-9 w-4 rounded-bl-lg border-b border-l border-[var(--border)]" />
      <div className="mb-[-2px] ml-1.5 inline-flex items-center gap-0.5 self-end rounded-full bg-[var(--secondary)]/60 p-0.5">
        {FACE_ORDER.map((face) => {
          const Icon = FACE_ICONS[face];
          const active = face === activeFace;
          const count = form.connectorEntries
            .filter((c) => c.face === face)
            .reduce((a, c) => a + c.quantity, 0);
          return (
            <button
              key={face}
              type="button"
              onClick={() => setActiveFace(face)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all",
                active
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {FACE_LABELS[face]}
              {count > 0 && (
                <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Composant principal ───────────────────────────────────────────────────

export function ConnectivityTab({
  form,
  connectorTypes,
  signals,
  signalCategories,
  functions = [],
  activeFace,
  addingFace,
  setAddingFace,
  editingPortId,
  setEditingPortId,
  addConnector,
  updateConnector,
  removeConnector,
  duplicateConnector,
  reorderConnectors,
  isReadOnly,
}: {
  form: FormData;
  /** Conservé pour compat de signature avec equipment-editor — non utilisé
   *  depuis que la section « Capacité essences IP » a migré dans l'onglet
   *  Capacité IP. */
  catColor?: string;
  connectorTypes: ConnectorType[];
  signals: Signal[];
  signalCategories: SignalCategory[];
  /** Fonctions broadcast (CatalogFunction) — pour grouper les signaux du
   *  dropdown par fonction (Vidéo, Audio…). */
  functions?: CatalogFunctionLite[];
  activeFace: FaceId;
  addingFace: FaceId | null;
  setAddingFace: (f: FaceId | null) => void;
  editingPortId: string | null;
  setEditingPortId: (id: string | null) => void;
  addConnector: (entry: ConnectorEntry) => void;
  updateConnector: (id: string, patch: Partial<ConnectorEntry>) => void;
  removeConnector: (id: string) => void;
  /** Remplace intégralement `form.connectorEntries` — utilisé par le drag &
   *  drop de réordonnancement. Si non fourni, le drag & drop est désactivé. */
  reorderConnectors?: (newEntries: ConnectorEntry[]) => void;
  /** Conservé pour compat de signature avec equipment-editor. */
  duplicateConnector?: (id: string) => void;
  /** Idem catColor — conservé pour compat. */
  onCapacityChange?: (
    signalName: string,
    patch: { in?: number; out?: number },
  ) => void;
  /** Lecture pure : cache les boutons "Ajouter / Modifier / Supprimer" et
   *  désactive le drag & drop. Le rendu des cards reste identique. */
  isReadOnly?: boolean;
}) {
  const entries = form.connectorEntries.filter((c) => c.face === activeFace);

  // Split par sens : entrées (IN) à gauche, sorties + bidirectionnel (OUT/BOTH)
  // à droite — colonnes miroir du synoptique.
  const inEntries = entries.filter((c) => c.direction === "IN");
  const outEntries = entries.filter(
    (c) => c.direction === "OUT" || c.direction === "BOTH",
  );

  // ── Drag & drop (réordonnancement des cards, au sein d'une colonne) ──────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Petit seuil pour ne pas confondre clic (edit) et drag.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (!reorderConnectors) return;
    // Le réordonnancement est scopé à la colonne de l'élément déplacé : on ne
    // mélange pas entrées et sorties (un drag cross-colonne est ignoré).
    const inCol = inEntries.some((e) => e.id === active.id);
    const list = inCol ? inEntries : outEntries;
    const oldIndex = list.findIndex((e) => e.id === active.id);
    const newIndex = list.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(list, oldIndex, newIndex);
    // Reconstitue la liste complète : autres faces + colonnes de la face active.
    const otherFaces = form.connectorEntries.filter(
      (c) => c.face !== activeFace,
    );
    const newIn = inCol ? reordered : inEntries;
    const newOut = inCol ? outEntries : reordered;
    reorderConnectors([...otherFaces, ...newIn, ...newOut]);
  };

  const openAdd = () => {
    setAddingFace(activeFace);
    setEditingPortId(null);
  };

  const openEdit = (id: string) => {
    setAddingFace(null);
    setEditingPortId(id);
  };

  const closeDialog = () => {
    setAddingFace(null);
    setEditingPortId(null);
  };

  const editingEntry =
    editingPortId != null
      ? form.connectorEntries.find((c) => c.id === editingPortId) ?? null
      : null;

  const dialogOpen = addingFace !== null || editingEntry !== null;

  const handleSave = (entry: ConnectorEntry) => {
    if (entry.quantity <= 0) {
      // Quantité 0 → on retire l'entrée (ou on n'ajoute rien).
      if (editingEntry) removeConnector(editingEntry.id);
      closeDialog();
      return;
    }
    if (editingEntry) {
      const { id: _id, ...patch } = entry;
      void _id;
      updateConnector(editingEntry.id, patch);
    } else {
      addConnector(entry);
    }
    closeDialog();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {entries.length === 0 ? (
        isReadOnly ? (
          <EmptyState
            icon={<Plug strokeWidth={1.5} />}
            title={`Aucun connecteur sur la face « ${FACE_LABELS[activeFace]} »`}
            description="Aucun connecteur n'est défini sur cette face."
          />
        ) : (
          <EmptyState
            icon={<Plug strokeWidth={1.5} />}
            title={`Aucun connecteur sur la face « ${FACE_LABELS[activeFace]} »`}
            description="Ajoutez un premier groupe de connecteurs pour cette face."
            action={
              <EmptyStateAction onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter un groupe
              </EmptyStateAction>
            }
          />
        )
      ) : (
        <>
          {/* Bouton "Ajouter un groupe" pleine largeur en haut — masqué en
              lecture pure. */}
          {!isReadOnly && (
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <Plus className="h-4 w-4" />
              Ajouter un groupe de connecteurs sur la face «&nbsp;{FACE_LABELS[activeFace]}&nbsp;»
            </button>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {/* 3 colonnes : entrées | preview synoptique (≤30%) | sorties + E/S */}
            <div className="flex items-start gap-4">
              <ConnectorColumn
                label="Entrées"
                count={inEntries.length}
                emptyLabel="Aucune entrée sur cette face"
              >
                <SortableContext
                  items={inEntries.map((e) => e.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {inEntries.map((entry) => (
                    <ConnectorGroupCard
                      key={entry.id}
                      entry={entry}
                      connectorTypes={connectorTypes}
                      signals={signals}
                      functions={functions}
                      sortable={!!reorderConnectors && !isReadOnly}
                      onEdit={() => openEdit(entry.id)}
                      onRemove={() => removeConnector(entry.id)}
                      onDuplicate={
                        duplicateConnector
                          ? () => duplicateConnector(entry.id)
                          : undefined
                      }
                      readOnly={isReadOnly}
                    />
                  ))}
                </SortableContext>
              </ConnectorColumn>

              <div className="w-[30%] max-w-[30%] shrink-0">
                <EquipmentSynopticPreview
                  form={form}
                  face={activeFace}
                  inEntries={inEntries}
                  outEntries={outEntries}
                  connectorTypes={connectorTypes}
                  signals={signals}
                  functions={functions}
                />
              </div>

              <ConnectorColumn
                label="Sorties & E/S"
                count={outEntries.length}
                emptyLabel="Aucune sortie sur cette face"
              >
                <SortableContext
                  items={outEntries.map((e) => e.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {outEntries.map((entry) => (
                    <ConnectorGroupCard
                      key={entry.id}
                      entry={entry}
                      connectorTypes={connectorTypes}
                      signals={signals}
                      functions={functions}
                      sortable={!!reorderConnectors && !isReadOnly}
                      onEdit={() => openEdit(entry.id)}
                      onRemove={() => removeConnector(entry.id)}
                      onDuplicate={
                        duplicateConnector
                          ? () => duplicateConnector(entry.id)
                          : undefined
                      }
                      readOnly={isReadOnly}
                    />
                  ))}
                </SortableContext>
              </ConnectorColumn>
            </div>
          </DndContext>
          </div>
        </>
      )}

      {!isReadOnly && (
        <ConnectorGroupDialog
          open={dialogOpen}
          face={editingEntry?.face ?? addingFace ?? activeFace}
          entry={editingEntry}
          faceEntries={entries}
          connectorTypes={connectorTypes}
          signals={signals}
          signalCategories={signalCategories}
          functions={functions}
          onSave={handleSave}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

// ─── ConnectorColumn ───────────────────────────────────────────────────────
//
// Colonne d'un sens (Entrées / Sorties & E/S) : header label + compteur, puis
// les cards empilées verticalement. Hint discret si la colonne est vide.
function ConnectorColumn({
  label,
  count,
  emptyLabel,
  children,
}: {
  label: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {label}
        </span>
        <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)]/60 px-3 py-6 text-center text-xs text-[var(--muted-foreground)]/70">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-col gap-3">{children}</div>
      )}
    </div>
  );
}

// ─── EquipmentSynopticPreview ──────────────────────────────────────────────
//
// Aperçu de l'équipement tel qu'il apparaîtra dans le synoptique d'un projet :
// on rend le **vrai** `SynopticNode` en mode statique (non interactif), construit
// depuis la connectique de la face active. Le rendu est identique pixel pour
// pixel à un node du synoptique projet (header, ports gauche/droite, pastilles
// colorées, dimensions NODE_W / PORT_H, indicateurs de direction).
//
// La logique de construction des `Port[]` réplique celle de `synoptic-view.tsx`
// (branche équipement, ~ligne 2986) : itération des entrées de la face, une
// entrée × `quantity` unités, `side = "left"` si IN sinon `"right"`, couleur
// signal prioritaire sur couleur connecteur.

/** ConnectorType (éditeur) → ConnectorTypeInfo (synoptique). Mapping direct. */
function toConnectorTypeInfos(cts: ConnectorType[]): ConnectorTypeInfo[] {
  return cts.map((c) => ({
    id: c.id,
    name: c.name,
    version: c.version,
    iconId: c.iconId,
    color: c.color,
    category: c.category,
  }));
}

/** ConnectorEntry (éditeur) → ConnectorEntry (synoptique). BOTH → BIDIR. */
function toSynopticEntry(e: ConnectorEntry): SynopticConnectorEntry {
  return {
    face: e.face,
    connectorTypeId: e.connectorTypeId,
    quantity: e.quantity,
    label: e.label,
    direction: e.direction === "BOTH" ? "BIDIR" : e.direction,
    signalName: e.signalName,
    gender: e.gender,
  };
}

/**
 * Construit les `Port[]` d'un équipement exactement comme le fait
 * `synoptic-view.tsx` : couleur du signal prioritaire (fallback couleur
 * connecteur), `side` déduit de la direction, une unité de port par quantité.
 */
/** Fonction broadcast (CatalogFunction) d'un signal, ou null. */
function functionOfSignal(
  signalName: string | null | undefined,
  signals: Signal[],
  functions: CatalogFunctionLite[],
): CatalogFunctionLite | null {
  if (!signalName) return null;
  const sig = signals.find((s) => s.name === signalName);
  if (!sig?.functionId) return null;
  return functions.find((f) => f.id === sig.functionId) ?? null;
}

/** Couleur d'un signal = couleur de sa fonction (fallback couleur du signal). */
function signalDisplayColor(
  signalName: string | null | undefined,
  signals: Signal[],
  functions: CatalogFunctionLite[],
): string {
  const fn = functionOfSignal(signalName, signals, functions);
  if (fn) return fn.color;
  const sig = signalName ? signals.find((s) => s.name === signalName) : null;
  return sig?.color ?? "#94a3b8";
}

function buildEquipmentPorts(
  entries: SynopticConnectorEntry[],
  ctInfos: ConnectorTypeInfo[],
  signals: Signal[],
  functions: CatalogFunctionLite[],
): Port[] {
  const ctMap = Object.fromEntries(ctInfos.map((c) => [c.id, c]));
  // Couleur du port = couleur de la FONCTION du signal (fallback signal.color).
  const sigColorMap = Object.fromEntries(
    signals.map((s) => [s.name, signalDisplayColor(s.name, signals, functions)]),
  );

  const resolveCt = (
    ct: ConnectorTypeInfo | null,
    entry: SynopticConnectorEntry,
  ): ConnectorTypeInfo | null => {
    const sigCol = entry.signalName ? sigColorMap[entry.signalName] : undefined;
    if (!ct) {
      if (sigCol) return { id: "", name: "", iconId: "", color: sigCol, category: "" };
      return null;
    }
    if (sigCol) return { ...ct, color: sigCol };
    return ct;
  };

  const ports: Port[] = [];
  let flatIndex = 0;
  for (let ei = 0; ei < entries.length; ei++) {
    const e = entries[ei];
    const ctRaw = e.connectorTypeId ? (ctMap[e.connectorTypeId] ?? null) : null;
    const ct = resolveCt(ctRaw, e);
    const dir = e.direction?.toUpperCase();
    const side: "left" | "right" = dir === "IN" ? "left" : "right";
    const qty = e.quantity ?? 1;
    for (let u = 0; u < qty; u++) {
      ports.push({
        portIndex: flatIndex,
        entryIndex: ei,
        unitIndex: u,
        totalUnits: qty,
        entry: e,
        ct,
        side,
      });
      flatIndex++;
    }
  }
  return ports;
}

const NOOP = () => {};
const EMPTY_NUM_SET: Set<number> = new Set();
const EMPTY_STR_SET: Set<string> = new Set();
const EMPTY_PANEL_DIRS: Map<string, "IN" | "OUT" | "BIDIR"> = new Map();

function EquipmentSynopticPreview({
  form,
  face,
  inEntries,
  outEntries,
  connectorTypes,
  signals,
  functions,
}: {
  form: FormData;
  face: FaceId;
  inEntries: ConnectorEntry[];
  outEntries: ConnectorEntry[];
  connectorTypes: ConnectorType[];
  signals: Signal[];
  functions: CatalogFunctionLite[];
}) {
  // Largeur disponible dans la colonne (mesurée) → facteur d'échelle pour faire
  // tenir NODE_W (300px) sous les ≤30 % alloués. Plafonné à 1 (jamais d'upscale).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setAvailW(w);
    });
    ro.observe(el);
    setAvailW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const ctInfos = useMemo(
    () => toConnectorTypeInfos(connectorTypes),
    [connectorTypes],
  );

  // Entrées de la face converties au format synoptique. On concatène IN puis
  // OUT/E/S en conservant l'ordre de chaque colonne (défini par le drag & drop)
  // — le node répartit ensuite left/right selon la direction.
  const synopticEntries = useMemo<SynopticConnectorEntry[]>(
    () => [...inEntries, ...outEntries].map(toSynopticEntry),
    [inEntries, outEntries],
  );

  const ports = useMemo(
    () => buildEquipmentPorts(synopticEntries, ctInfos, signals, functions),
    [synopticEntries, ctInfos, signals, functions],
  );

  const slot = useMemo<RackSlotWithEquipment>(() => {
    void face;
    return {
      id: "__preview__",
      equipmentId: "__preview__",
      startU: form.heightU,
      heightU: form.heightU,
      label: null,
      widthFraction: form.widthFraction,
      notes: null,
      synopticX: 0,
      synopticY: 0,
      equipment: {
        id: "__preview__",
        name: form.name || "Équipement",
        reference: form.reference?.trim() ? form.reference.trim() : null,
        category: form.category || null,
        heightU: form.heightU,
        weight: form.weight,
        powerW: form.powerW,
        depthMm: form.depthMm,
        imageUrl: form.imageUrl || null,
        connectors: synopticEntries,
        brand: null,
      },
      panel: null,
    };
  }, [
    face,
    form.heightU,
    form.widthFraction,
    form.name,
    form.reference,
    form.category,
    form.weight,
    form.powerW,
    form.depthMm,
    form.imageUrl,
    synopticEntries,
  ]);

  // Hauteur du node — réplique le calcul interne de SynopticNode (pas de groupe
  // ici, aucun `groupLabel`), pour dimensionner le conteneur relatif.
  const leftCount = ports.filter((p) => p.side === "left").length;
  const rightCount = ports.filter((p) => p.side === "right").length;
  const nodeH = Math.max(
    NODE_MIN_H,
    NODE_HEADER_H + Math.max(leftCount, rightCount) * PORT_H + 12,
  );

  const scale = availW > 0 ? Math.min(1, availW / NODE_W) : 1;
  const scaledH = nodeH * scale;

  const isEmpty = ports.length === 0;

  return (
    <div className="sticky top-0">
      <div ref={wrapRef} className="w-full">
        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-[var(--border)]/60 px-3 py-8 text-center text-xs text-[var(--muted-foreground)]/70">
            Aucun connecteur sur cette face
          </div>
        ) : (
          <div
            className="relative overflow-visible"
            style={{ height: scaledH }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                width: NODE_W,
                height: nodeH,
                transform: `translateX(-50%) scale(${scale})`,
                transformOrigin: "top center",
              }}
            >
              <SynopticNode
                slot={slot}
                x={0}
                y={0}
                connectorTypes={ctInfos}
                ports={ports}
                panelPortDirs={EMPTY_PANEL_DIRS}
                isSelected={false}
                isPreview={false}
                canDrag={false}
                cableToolActive={false}
                drawingFrom={null}
                snapTarget={null}
                drawingFromPort={null}
                connectedPortIndices={EMPTY_NUM_SET}
                selectedSrcIndices={EMPTY_NUM_SET}
                compatiblePortIndices={EMPTY_NUM_SET}
                multiSnapIndices={EMPTY_NUM_SET}
                externalPortIndices={EMPTY_NUM_SET}
                ipSignalNames={EMPTY_STR_SET}
                multiSrcConfirmed={false}
                onSelect={NOOP}
                onDragStart={NOOP}
                onPortClick={NOOP}
                onPortRef={NOOP}
                onIncompatHover={NOOP}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ConnectorGroupCard ────────────────────────────────────────────────────
//
// Row horizontal compact aligné sur le pattern `BomRow` de la page inventaire
// (`app/(fullscreen)/project/[id]/inventaire/_components/bom-panel.tsx`) :
//
//   [icône 36×36] [label · meta mono · · ·] [handle] [×N] [edit] [delete]
//
// Le libellé utilisateur (`entry.label`) est l'identifiant lisible en ligne 1.
// La ligne 2 mono 10px concatène signal · connecteur · genre · direction.

function ConnectorGroupCard({
  entry,
  connectorTypes,
  signals,
  functions,
  sortable,
  onEdit,
  onRemove,
  onDuplicate,
  readOnly,
}: {
  entry: ConnectorEntry;
  connectorTypes: ConnectorType[];
  signals: Signal[];
  functions: CatalogFunctionLite[];
  /** Active le drag & drop via `useSortable`. Faux quand le parent n'a pas
   *  fourni `reorderConnectors`. */
  sortable: boolean;
  onEdit: () => void;
  onRemove: () => void;
  /** Duplique l'entrée (copie insérée juste après). Absent = pas de bouton. */
  onDuplicate?: () => void;
  /** Lecture pure : cache les boutons Edit / Delete / Drag handle. */
  readOnly?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: !sortable });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const ct = connectorTypes.find((c) => c.id === entry.connectorTypeId) ?? null;
  const genderOpt = GENDER_OPTIONS.find((g) => g.value === entry.gender) ?? null;
  const linkedSignal = signals.find((s) => s.name === entry.signalName) ?? null;
  // Couleur & fonction du signal (la « fonction » colore toute la card).
  const fn = functionOfSignal(entry.signalName, signals, functions);
  const sigColor = signalDisplayColor(entry.signalName, signals, functions);

  const dirOpt = DIR_OPTIONS.find((d) => d.value === entry.direction) ?? null;
  const directionShort = dirOpt?.short ?? "I/O";
  const directionColor = dirOpt?.color ?? "#6366f1";

  const displayLabel =
    entry.label && entry.label.trim().length > 0 ? entry.label : "Sans libellé";
  const hasLabel = entry.label != null && entry.label.trim().length > 0;

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      className={cn(
        "group relative flex overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-all hover:border-[var(--accent)]/40 hover:shadow-md",
        isDragging && "z-50 opacity-60 shadow-lg",
      )}
    >
      {/* Liseré latéral = couleur de la FONCTION du signal (repère visuel). */}
      <div className="w-1.5 shrink-0" style={{ background: sigColor }} />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
        {/* Ligne 1 : icône connecteur + label/connecteur + quantité proéminente */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--secondary)]">
            {ct ? (
              <ConnectorIcon iconId={ct.iconId} color="currentColor" size={26} />
            ) : (
              <Plug className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm font-semibold leading-tight",
                !hasLabel && "italic text-[var(--muted-foreground)]",
              )}
              title={displayLabel}
            >
              {displayLabel}
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-[var(--muted-foreground)]">
              {ct?.name ?? "Connecteur non défini"}
              {genderOpt && ` · ${genderOpt.short}`}
            </p>
          </div>
          {/* Quantité — mise en avant (grand, tabular). */}
          <div className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-[var(--accent)]/10 px-2.5 py-1 leading-none">
            <span className="text-lg font-bold tabular-nums text-[var(--accent)]">
              {entry.quantity}
            </span>
            <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wider text-[var(--accent)]/70">
              {entry.quantity > 1 ? "ports" : "port"}
            </span>
          </div>
        </div>

        {/* Ligne 2 : signal (pastille + nom) · badge fonction · direction */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)]/60 pt-2.5">
          <span
            className="inline-flex min-w-0 flex-1 items-center gap-1.5"
            title={
              linkedSignal
                ? `${linkedSignal.name}${fn ? ` · ${fn.label}` : ""}`
                : undefined
            }
          >
            {linkedSignal ? (
              <>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2"
                  style={{ borderColor: sigColor, background: `${sigColor}33` }}
                />
                <span className="truncate text-xs font-semibold text-[var(--foreground)]">
                  {linkedSignal.name}
                </span>
                {fn && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: `${fn.color}1a`, color: fn.color }}
                  >
                    {fn.label}
                  </span>
                )}
              </>
            ) : (
              <span className="truncate text-xs italic text-[var(--muted-foreground)]">
                Sans signal
              </span>
            )}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: `${directionColor}1a`, color: directionColor }}
          >
            {directionShort}
          </span>
        </div>
      </div>

      {/* Actions — flottantes en haut à droite, révélées au survol. */}
      {!readOnly && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-[var(--card)]/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
          {sortable && (
            <button
              type="button"
              {...listeners}
              aria-label="Glisser pour réordonner"
              className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            title="Modifier"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              title="Dupliquer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="Supprimer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ConnectorGroupDialog ──────────────────────────────────────────────────
//
// Modal Radix `max-w-2xl` avec un bloc compact pour saisir les paramètres
// d'un groupe de connecteurs. Aligné sur le pattern adaptateur (cards de
// sortie compacts).
//
// Champs (dans cet ordre) :
//   1. Connecteur (obligatoire) — ConnectorPickerTrigger + ConnectorPickerModal
//   2. Signal (obligatoire) — select filtré par connecteur compatible
//   3. Direction — chips IN / OUT / I/O (3 boutons)
//   4. Genre — chips Mâle / Femelle (2 boutons)
//   5. Quantité — RangeInput editable 1-1024 (les grilles/routeurs denses dépassent 244 ports)
//   6. Label — input texte (optionnel)

const groupSchema = z.object({
  connectorTypeId: z.string().min(1, "Sélectionnez un connecteur."),
  direction: z.enum(["IN", "OUT", "BOTH"]),
  gender: z.enum(["MALE", "FEMALE"]),
  quantity: z.number().int().min(1).max(1024),
  label: z.string().trim().min(1, "Libellé requis."),
  signalName: z.string().min(1, "Sélectionnez un signal."),
});
type GroupValues = z.infer<typeof groupSchema>;

const GROUP_DEFAULTS: GroupValues = {
  connectorTypeId: "",
  direction: "BOTH",
  gender: "FEMALE",
  quantity: 1,
  label: "",
  signalName: "",
};

/**
 * Slug d'un signal pour l'auto-fill du label : majuscules, espaces et chars
 * non alphanum remplacés par un tiret, collapse des tirets consécutifs.
 *
 *   "HDMI"      → "HDMI"
 *   "AES67"     → "AES67"
 *   "SDI 12G"   → "SDI-12G"
 *   "MADI/AES"  → "MADI-AES"
 */
function signalAbbrev(signalName: string): string {
  return signalName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function directionCode(direction: ConnectorEntry["direction"]): string {
  return direction === "IN" ? "IN" : direction === "OUT" ? "OUT" : "IO";
}

/**
 * Construit le label auto-rempli `{SIGNAL}-{DIR}-{INDEX}` à partir des
 * entrées déjà présentes sur la même face partageant le même signal +
 * même direction. `excludeId` exclut l'entrée en cours d'édition pour
 * conserver son propre index.
 */
function computeAutoLabel(
  signalName: string,
  direction: ConnectorEntry["direction"],
  faceEntries: ConnectorEntry[],
  excludeId?: string,
): string {
  const abbrev = signalAbbrev(signalName);
  if (!abbrev) return "";
  const dir = directionCode(direction);
  const count = faceEntries.filter(
    (e) =>
      e.id !== excludeId &&
      e.signalName === signalName &&
      e.direction === direction,
  ).length;
  return `${abbrev}-${dir}-${count + 1}`;
}

function filterSignalsForConnector(
  signals: Signal[],
  ct: ConnectorType | null,
): Signal[] {
  if (!ct) return signals;
  return signals.filter((s) => {
    const raw = s.connectors;
    // Un signal qui ne déclare AUCUN connecteur compatible (liste vide ou
    // absente) n'est proposé pour aucun connecteur — sinon on proposait des
    // signaux incompatibles (ex. « DC 12V Caméra » sous BNC).
    if (!Array.isArray(raw) || raw.length === 0) return false;
    const ids = raw as string[];
    return ids.includes(ct.id) || ids.includes(ct.name);
  });
}

function ConnectorGroupDialog({
  open,
  face,
  entry,
  faceEntries,
  connectorTypes,
  signals,
  signalCategories,
  functions,
  onSave,
  onClose,
}: {
  open: boolean;
  face: FaceId;
  /** null/undefined = création. Défini = édition (préserve l'id). */
  entry?: ConnectorEntry | null;
  /** Toutes les entrées sur la face courante — sert au calcul de l'index
   *  auto pour le label `{SIGNAL}-{DIR}-{N}`. */
  faceEntries: ConnectorEntry[];
  connectorTypes: ConnectorType[];
  signals: Signal[];
  signalCategories: SignalCategory[];
  functions: CatalogFunctionLite[];
  onSave: (entry: ConnectorEntry) => void;
  onClose: () => void;
}) {
  const isEdit = !!entry;

  const defaultValues = useMemo<GroupValues>(() => {
    if (entry) {
      return {
        connectorTypeId: entry.connectorTypeId,
        direction: entry.direction,
        gender: entry.gender,
        quantity: entry.quantity,
        label: entry.label ?? "",
        signalName: entry.signalName ?? "",
      };
    }
    return GROUP_DEFAULTS;
    // entry?.id sert d'identité stable : tant qu'on édite le même port, le
    // form ne se reset pas en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, open]);

  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues,
  });

  // Drapeau d'auto-fill du label.
  //  - création : false au mount → tant que l'utilisateur n'a rien tapé,
  //    on recalcule {SIGNAL}-{DIR}-{N} à chaque changement signal/direction.
  //  - édition : true au mount → on respecte ce qui est en base.
  const userEditedLabelRef = useRef<boolean>(!!entry);

  // Reset quand on ouvre/change de cible.
  useEffect(() => {
    if (open) {
      form.reset(defaultValues);
      userEditedLabelRef.current = !!entry;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const connectorTypeId = form.watch("connectorTypeId");
  const direction = form.watch("direction");
  const gender = form.watch("gender");
  const quantity = form.watch("quantity");
  const signalName = form.watch("signalName");
  const labelValue = form.watch("label");

  // Auto-fill du label tant que l'utilisateur n'a pas tapé manuellement.
  //
  // Recalculé à chaque changement signal/direction. On exclut l'entrée en
  // cours d'édition du count (sinon on saute un index) — en création
  // (`entry === null`), `entry?.id` vaut `undefined` et `excludeId` n'a
  // pas d'effet, ce qui est bien le comportement voulu.
  useEffect(() => {
    if (!open) return;
    if (userEditedLabelRef.current) return;
    if (!signalName) return;
    const auto = computeAutoLabel(
      signalName,
      direction,
      faceEntries,
      entry?.id,
    );
    if (auto && auto !== form.getValues("label")) {
      form.setValue("label", auto, {
        shouldDirty: true,
        shouldValidate: false,
      });
    }
    // form/faceEntries volontairement omis : on ne réagit qu'aux dépendances
    // pertinentes (signal/direction + ouverture). faceEntries change à chaque
    // ajout côté parent, ce qui re-déclencherait l'auto-fill sans valeur ajoutée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signalName, direction, entry?.id]);

  const selectedCT =
    connectorTypes.find((c) => c.id === connectorTypeId) ?? null;
  const filteredSignals = filterSignalsForConnector(signals, selectedCT);

  const [pickerOpen, setPickerOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const submit = form.handleSubmit((values) => {
    const ct = connectorTypes.find((c) => c.id === values.connectorTypeId);
    if (!ct) return;
    onSave({
      // Préserve les champs avancés en mode édition (networkRole, version,
      // disableRedundancy) qui ne sont pas éditables ici.
      ...(entry ?? {}),
      id: entry?.id ?? uid(),
      face,
      connectorTypeId: ct.id,
      direction: values.direction,
      gender: values.gender,
      quantity: values.quantity,
      label: values.label.trim(),
      signalName: values.signalName ?? "",
    });
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col p-0"
        showClose={false}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)]/60 px-5 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold">
              {isEdit
                ? "Modifier le groupe de connecteurs"
                : "Nouveau groupe de connecteurs"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Face « {FACE_LABELS[face]} »
            </DialogDescription>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* 1. Connecteur (obligatoire) */}
          <FieldBlock label="Connecteur" required>
            <ConnectorPickerTrigger
              connector={selectedCT}
              placeholder="Sélectionner un connecteur"
              onClick={() => setPickerOpen(true)}
              error={
                form.formState.errors.connectorTypeId?.message ?? undefined
              }
            />
            <ConnectorPickerModal
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              connectors={connectorTypes}
              selectedId={connectorTypeId || null}
              onSelect={(id) =>
                form.setValue("connectorTypeId", id, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </FieldBlock>

          {/* 2. Signal (obligatoire) — cascade : dépend du connecteur choisi,
              dropdown groupé par fonction. */}
          <FieldBlock label="Signal" required>
            <SignalDropdown
              signals={filteredSignals}
              functions={functions}
              value={signalName || null}
              disabled={!connectorTypeId}
              error={form.formState.errors.signalName?.message ?? undefined}
              placeholder={
                connectorTypeId
                  ? "Sélectionner un signal"
                  : "Sélectionnez d'abord un connecteur"
              }
              onChange={(name) => {
                form.setValue("signalName", name, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            />
          </FieldBlock>

          {/* 3. Direction + 4. Genre — sur 2 colonnes */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FieldBlock label="Direction">
              <div className="grid grid-cols-3 gap-1.5">
                {DIR_OPTIONS.map((d) => {
                  const active = direction === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() =>
                        form.setValue("direction", d.value, {
                          shouldDirty: true,
                        })
                      }
                      className={cn(
                        "flex h-10 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold transition-all",
                        !active &&
                          "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                      )}
                      style={
                        active
                          ? {
                              borderColor: d.color,
                              backgroundColor: `${d.color}15`,
                              color: d.color,
                            }
                          : undefined
                      }
                    >
                      <span>{d.label}</span>
                      <span className="font-mono text-[9px] opacity-70">
                        {d.short}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FieldBlock>

            <FieldBlock label="Genre">
              <div className="grid grid-cols-2 gap-1.5">
                {GENDER_OPTIONS.map((g) => {
                  const active = gender === g.value;
                  return (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() =>
                        form.setValue("gender", g.value, { shouldDirty: true })
                      }
                      className={cn(
                        "flex h-10 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold transition-all",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                      )}
                    >
                      <span>{g.label}</span>
                      <span className="font-mono text-[9px] opacity-70">
                        {g.short}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FieldBlock>
          </div>

          {/* 5. Quantité — curseur borné à 100, saisie libre jusqu'à 1024
              (grilles/routeurs denses : 244+ ports). */}
          <FieldBlock label="Quantité">
            <RangeInput
              min={1}
              max={1024}
              sliderMax={100}
              step={1}
              value={quantity}
              onChange={(v) =>
                form.setValue("quantity", v, { shouldDirty: true })
              }
              unit=""
              editable
            />
          </FieldBlock>

          {/* 6. Libellé (obligatoire, auto-rempli) */}
          <FieldBlock label="Libellé" required>
            <input
              type="text"
              {...form.register("label", {
                onChange: () => {
                  userEditedLabelRef.current = true;
                  if (form.formState.errors.label) {
                    void form.trigger("label");
                  }
                },
              })}
              placeholder="Ex. SDI-IN-1, HDMI-IO-2, MIC1…"
              aria-invalid={
                form.formState.errors.label ? "true" : undefined
              }
              className={cn(
                "flex h-10 w-full rounded-lg border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                form.formState.errors.label
                  ? "border-[var(--destructive)]"
                  : "border-[var(--border)]",
              )}
            />
            {form.formState.errors.label && (
              // arkyo-server: habillage Strata
              <p className="text-[11px] text-[var(--danger-text)]">
                {form.formState.errors.label.message}
              </p>
            )}
          </FieldBlock>

          {signalName !== entry?.signalName && entry?.networkRole && (
            // arkyo-server: habillage Strata
            <p className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--warning-text)]">
              Les paramètres avancés du port (rôle réseau, redondance) sont
              conservés mais ne sont pas éditables ici.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)]/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!connectorTypeId || !signalName || !labelValue.trim()}
            title={
              !connectorTypeId
                ? "Sélectionnez un connecteur"
                : !signalName
                  ? "Sélectionnez un signal"
                  : !labelValue.trim()
                    ? "Saisissez un libellé"
                    : undefined
            }
            // arkyo-server: habillage Strata
            className="flex h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isEdit ? "Enregistrer" : "Ajouter"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── SignalDropdown ────────────────────────────────────────────────────────
//
// Dropdown de sélection d'un signal (pas une modal) : bouton trigger + panneau
// déroulant ancré sous le champ, fermé au click extérieur. La liste (déjà
// filtrée en cascade sur les signaux compatibles avec le connecteur) est
// **groupée par fonction** (CatalogFunction : Vidéo, Audio, Données…), ordre
// des groupes aligné sur `functions` (sortOrder implicite).

function SignalDropdown({
  signals,
  functions,
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: {
  signals: Signal[];
  functions: CatalogFunctionLite[];
  value: string | null;
  onChange: (name: string) => void;
  disabled?: boolean;
  error?: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const fnById = useMemo(
    () => new Map(functions.map((f) => [f.id, f])),
    [functions],
  );
  const funcOf = (s: Signal) =>
    s.functionId ? fnById.get(s.functionId) ?? null : null;

  const selected = signals.find((s) => s.name === value) ?? null;
  const selectedFn = selected ? funcOf(selected) : null;

  // Groupes par fonction, ordonnés selon l'ordre de `functions` ; les signaux
  // sans fonction résolue tombent dans un groupe « Autres » en fin de liste.
  const groups = useMemo(() => {
    const OTHER = "__other__";
    const byFn = new Map<string, Signal[]>();
    for (const s of signals) {
      const fid = s.functionId && fnById.has(s.functionId) ? s.functionId : OTHER;
      const arr = byFn.get(fid) ?? [];
      arr.push(s);
      byFn.set(fid, arr);
    }
    const fnRank = (id: string) => {
      if (id === OTHER) return Number.MAX_SAFE_INTEGER;
      const i = functions.findIndex((f) => f.id === id);
      return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
    };
    return [...byFn.entries()]
      .sort((a, b) => fnRank(a[0]) - fnRank(b[0]))
      .map(([fid, list]) => {
        const fn = fid === OTHER ? null : fnById.get(fid) ?? null;
        return {
          key: fid,
          label: fn?.label ?? "Autres",
          color: fn?.color ?? "#94a3b8",
          signals: [...list].sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
  }, [signals, functions, fnById]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-left transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-[var(--destructive)]" : "border-[var(--border)]",
        )}
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="h-3 w-3 shrink-0 rounded-full border-2"
              style={{
                borderColor: selectedFn?.color ?? selected.color ?? "#94a3b8",
                background: `${selectedFn?.color ?? selected.color ?? "#94a3b8"}33`,
              }}
            />
            <span className="truncate text-sm font-medium text-[var(--foreground)]">
              {selected.name}
            </span>
            {selectedFn && (
              <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                {selectedFn.label}
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">{placeholder}</span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {/* arkyo-server: habillage Strata */}
      {error && <p className="mt-1 text-[11px] text-[var(--danger-text)]">{error}</p>}

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
              Aucun signal compatible
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: g.color }}
                  />
                  {g.label}
                </p>
                {g.signals.map((s) => {
                  const active = s.name === value;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onChange(s.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "hover:bg-[var(--secondary)]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {s.name}
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── FieldBlock (label uppercase + slot) ──────────────────────────────────

function FieldBlock({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
        {label}
        {required && <RequiredPill />}
      </p>
      {children}
    </div>
  );
}
