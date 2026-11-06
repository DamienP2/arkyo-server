"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api-client";
import {
  Plus,
  Server,
  Zap,
  Weight,
  LayoutGrid,
  Trash2,
  ArrowLeft,
  GripVertical,
  Layers,
  Search,
} from "@/components/ui/icons";
import Link from "next/link";
// Type local — Equipment n'existe plus dans le schéma multi-tenant ; seuls les
// champs effectivement consommés par ce composant sont listés ici.
type Equipment = {
  id: string;
  name: string;
  reference: string | null;
  weight: number | null;
  powerW: number | null;
  heightU: number | null;
  widthFraction: string;
};

// ── Types ───────────────────────────────────────────────────────────────────

type Slot = {
  id: string;
  view: string;
  startU: number;
  heightU: number;
  label: string | null;
  notes: string | null;
  equipment: Equipment | null;
};

type Rack = {
  id: string;
  name: string;
  totalU: number;
  depthMm: number;
  maxWeightKg: number | null;
  maxPowerW: number | null;
  emptyWeightKg: number | null;
  notes: string | null;
  slots: Slot[];
};

type RigRack = { id: string; position: number; rack: Rack };

type AvailableRack = { id: string; name: string; totalU: number; depthMm: number };

type Rig = {
  id: string;
  name: string;
  type: string;
  prestationType: string | null;
  isTemplate: boolean;
  notes: string | null;
  project: { id: string; name: string } | null;
  createdBy: { name: string | null; email: string };
  rigRacks: RigRack[];
};

// ── Stats ────────────────────────────────────────────────────────────────────

function getRackStats(rack: Rack) {
  const usedU = rack.slots.filter((s) => s.view === "FRONT").reduce((a, s) => a + s.heightU, 0);
  const weightKg =
    rack.slots.reduce((a, s) => a + (s.equipment?.weight ?? 0), 0) + (rack.emptyWeightKg ?? 0);
  const powerW = rack.slots.reduce((a, s) => a + (s.equipment?.powerW ?? 0), 0);
  const freeU = rack.totalU - usedU;
  return { usedU, freeU, weightKg, powerW };
}

// ── DraggableRack (sidebar) ──────────────────────────────────────────────────

function DraggableRack({ rack, dragging }: { rack: AvailableRack; dragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `available-${rack.id}`,
    data: { type: "available-rack", rack },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex cursor-grab items-center gap-2 rounded-xl border bg-[var(--card)] p-3 transition-all select-none",
        dragging ? "opacity-50 shadow-lg" : "hover:border-[var(--accent)]/50 hover:shadow-sm",
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]/50" />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]">
        <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{rack.name}</p>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {rack.totalU} U · {rack.depthMm} mm
        </p>
      </div>
    </div>
  );
}

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ isDragging }: { isDragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "rig-drop-zone" });

  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-24 items-center justify-center rounded-xl border-2 border-dashed transition-all",
        isOver
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
          : "border-[var(--border)] text-[var(--muted-foreground)]",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="h-4 w-4" />
        {isOver ? "Relâcher pour ajouter" : "Déposer un rack ici"}
      </div>
    </div>
  );
}

// ── RigRackCard ───────────────────────────────────────────────────────────────

function RigRackCard({
  rigRack,
  rigId,
  onUnlink,
}: {
  rigRack: RigRack;
  rigId: string;
  onUnlink: (rackId: string) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const { rack } = rigRack;
  const stats = getRackStats(rack);
  const frontSlots = rack.slots
    .filter((s) => s.view === "FRONT")
    .sort((a, b) => a.startU - b.startU);

  const handleUnlink = async () => {
    const ok = await confirm({
      title: `Retirer "${rack.name}" de cette régie ?`,
      description: "Le rack ne sera pas supprimé.",
      confirmLabel: "Retirer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/rigs/${rigId}/racks/${rack.id}`);
    } catch (e) {
      if (e instanceof ApiError) return;
      throw e;
    }
    onUnlink(rack.id);
    router.refresh();
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-colors hover:border-[var(--accent)]/40">
      {/* Barre gauche colorée */}
      <div className="w-1 shrink-0 bg-[var(--accent)]/60" />

      <div className="min-w-0 flex-1 p-3">
        {/* Nom + badges */}
        <div className="mb-2 flex items-center gap-2">
          <Server className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <p className="truncate text-[13px] font-semibold">{rack.name}</p>
          <span className="shrink-0 text-[10px] font-bold text-[var(--foreground)]">
            {rack.totalU}U
          </span>
        </div>

        {/* Stats inline */}
        <div className="mb-2.5 flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1">
            <LayoutGrid className="h-3 w-3" />
            {stats.usedU}/{rack.totalU}U
          </span>
          <span className="flex items-center gap-1">
            <Weight className="h-3 w-3" />
            {stats.weightKg.toFixed(1)} kg
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {stats.powerW} W
          </span>
        </div>

        {/* Équipements */}
        {frontSlots.length > 0 ? (
          <div className="space-y-1">
            {frontSlots.slice(0, 4).map((slot) => (
              <div
                key={slot.id}
                className="flex items-center gap-2 rounded-md bg-[var(--secondary)] px-2 py-1 text-[11px]"
              >
                <span className="w-7 shrink-0 text-[var(--muted-foreground)]">U{slot.startU}</span>
                <span className="truncate font-medium">{slot.label ?? slot.equipment?.name}</span>
                <span className="ml-auto shrink-0 text-[var(--muted-foreground)]">
                  {slot.heightU}U
                </span>
              </div>
            ))}
            {frontSlots.length > 4 && (
              <p className="px-1 text-[10px] text-[var(--muted-foreground)]">
                +{frontSlots.length - 4} de plus…
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--muted-foreground)]/60 italic">Aucun équipement</p>
        )}
      </div>

      {/* Actions droite */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-1 border-l border-[var(--border)] px-2">
        <Link
          href={`/rigs/${rigId}/rack/${rack.id}`}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          title="Ouvrir l'éditeur"
        >
          <Layers className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={handleUnlink}
          // arkyo-server: habillage Strata
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          title="Retirer de la régie"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function RigDetailClient({
  rig: initialRig,
  availableRacks: initialAvailable = [],
}: {
  rig: Rig;
  allEquipment: Equipment[];
  availableRacks?: AvailableRack[];
}) {
  const router = useRouter();
  const [rig, setRig] = useState(initialRig);
  // Sync SSE — mise à jour temps réel depuis une autre session
  useEffect(() => {
    setRig(initialRig);
  }, [initialRig]);
  const [available, setAvailable] = useState(initialAvailable);
  // Sync SSE — mise à jour temps réel depuis une autre session
  useEffect(() => {
    setAvailable(initialAvailable);
  }, [initialAvailable]);
  const [activeDrag, setActiveDrag] = useState<AvailableRack | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.type === "available-rack") setActiveDrag(data.rack);
  }, []);

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveDrag(null);
      if (!e.over || e.over.id !== "rig-drop-zone") return;
      const data = e.active.data.current;
      if (data?.type !== "available-rack") return;

      const rack: AvailableRack = data.rack;
      setAdding(rack.id);

      let newRigRack: RigRack;
      try {
        newRigRack = await api.post<RigRack>(`/api/rigs/${rig.id}/racks`, { rackId: rack.id });
      } catch (e) {
        setAdding(null);
        if (e instanceof ApiError) return;
        throw e;
      }

      setAdding(null);
      setRig((prev) => ({ ...prev, rigRacks: [...prev.rigRacks, newRigRack] }));
      setAvailable((prev) => prev.filter((r) => r.id !== rack.id));
      router.refresh();
    },
    [rig.id, router],
  );

  const handleUnlink = useCallback(
    (rackId: string) => {
      const unlinked = rig.rigRacks.find((rr) => rr.rack.id === rackId);
      setRig((prev) => ({
        ...prev,
        rigRacks: prev.rigRacks.filter((rr) => rr.rack.id !== rackId),
      }));
      if (unlinked) {
        setAvailable((prev) => [
          {
            id: unlinked.rack.id,
            name: unlinked.rack.name,
            totalU: unlinked.rack.totalU,
            depthMm: unlinked.rack.depthMm,
          },
          ...prev,
        ]);
      }
    },
    [rig.rigRacks],
  );

  const filtered = available.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));

  // Stats globales
  const totalU = rig.rigRacks.reduce((a, rr) => a + rr.rack.totalU, 0);
  const usedU = rig.rigRacks.reduce(
    (a, rr) =>
      a + rr.rack.slots.filter((s) => s.view === "FRONT").reduce((b, s) => b + s.heightU, 0),
    0,
  );
  const totalWeight = rig.rigRacks.reduce((a, rr) => a + getRackStats(rr.rack).weightKg, 0);
  const totalPower = rig.rigRacks.reduce((a, rr) => a + getRackStats(rr.rack).powerW, 0);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full">
        {/* ── Sidebar racks disponibles ── */}
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--background)]">
          <div className="shrink-0 border-b border-[var(--border)] px-4 pt-5 pb-3">
            <p className="mb-3 text-[13px] font-semibold">Racks disponibles</p>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] py-1.5 pr-3 pl-8 text-sm focus:ring-2 focus:ring-[var(--ring)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Server className="h-8 w-8 text-[var(--muted-foreground)]/30" />
                <p className="text-[12px] text-[var(--muted-foreground)]">
                  {available.length === 0 ? "Tous les racks sont assignés" : "Aucun résultat"}
                </p>
              </div>
            ) : (
              filtered.map((rack) => (
                <DraggableRack key={rack.id} rack={rack} dragging={activeDrag?.id === rack.id} />
              ))
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--border)] p-3">
            <Link href="/templates?tab=racks">
              <Button variant="outline" size="sm" className="w-full">
                <Plus className="h-3.5 w-3.5" />
                Gérer les racks
              </Button>
            </Link>
          </div>
        </div>

        {/* ── Zone principale ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-8">
            {/* Breadcrumb */}
            <div className="mb-6 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Link
                href="/templates?tab=rigs"
                className="flex items-center gap-1 hover:text-[var(--foreground)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Régies
              </Link>
              <span>/</span>
              <span className="text-[var(--foreground)]">{rig.name}</span>
            </div>

            {/* Header */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h1 className="text-2xl font-semibold">{rig.name}</h1>
                  <Badge variant="outline">
                    {rig.type === "FLIGHT_CASE"
                      ? "Rack flight"
                      : rig.type === "CAR"
                        ? "Car régie"
                        : "Mixte"}
                  </Badge>
                  {rig.isTemplate && <Badge variant="accent">Template</Badge>}
                  {rig.prestationType && <Badge variant="default">{rig.prestationType}</Badge>}
                </div>
                {rig.project && (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Projet :{" "}
                    <Link href={`/projects/${rig.project.id}`} className="hover:underline">
                      {rig.project.name}
                    </Link>
                  </p>
                )}
              </div>
            </div>

            {/* Stats globales */}
            {rig.rigRacks.length > 0 && (
              <div className="mb-6 grid grid-cols-4 gap-3">
                {[
                  { label: "Racks", value: String(rig.rigRacks.length), icon: Server },
                  { label: "Occupation", value: `${usedU}U / ${totalU}U`, icon: LayoutGrid },
                  { label: "Poids total", value: `${totalWeight.toFixed(1)} kg`, icon: Weight },
                  { label: "Consommation", value: `${totalPower} W`, icon: Zap },
                ].map((s) => (
                  <Card key={s.label}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-2">
                        <s.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                        <div>
                          <p className="text-sm font-semibold">{s.value}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">{s.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Zone de drop */}
            <DropZone isDragging={activeDrag !== null} />

            {/* Liste des racks */}
            {rig.rigRacks.length === 0 && activeDrag === null ? (
              <EmptyState
                icon={<Server strokeWidth={1.5} />}
                title="Aucun rack"
                description="Glissez un rack depuis le panneau gauche pour l'ajouter à cette régie."
              />
            ) : (
              <div className={cn("grid grid-cols-2 gap-3", activeDrag !== null && "mt-3")}>
                {rig.rigRacks.map((rr) => (
                  <div key={rr.id} className={cn(adding === rr.rack.id && "opacity-50")}>
                    <RigRackCard rigRack={rr} rigId={rig.id} onUnlink={handleUnlink} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDrag && (
          <div className="flex w-64 items-center gap-2 rounded-xl border bg-[var(--card)] p-3 opacity-95 shadow-xl">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]">
              <Server className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{activeDrag.name}</p>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {activeDrag.totalU} U · {activeDrag.depthMm} mm
              </p>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
