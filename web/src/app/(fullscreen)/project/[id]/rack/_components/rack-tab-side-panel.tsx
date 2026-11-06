"use client";

/**
 * RackTabSidePanel — panel gauche dynamique de l'onglet Rack du projet.
 *
 * Routage par activeTool :
 *  - `container` : liste filtrée `racks.filter(r => r.isRackable)` ; click
 *    sur un item → `onSelectRack(rackId)`. Affiche un cocktail discret pour
 *    indiquer le rack courant.
 *  - `equipment` / `adapter` / `panel` / `accessory` : items DRAGGABLES vers
 *    le canvas, filtrés sur le BOM du rack sélectionné. Si pas de rack
 *    sélectionné → message d'invitation.
 *
 * Layout aligné sur `InventaireSidePanel` (header `border-b` + scrollable
 * content).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Server } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { useCatalogLookup } from "@/lib/hooks/use-catalog-lookup";
import { useRackBom } from "@/app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-rack-bom";
import { DraggableBomItem } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-bom-item";
import type {
  Equipment,
  PanelItem,
  Slot,
} from "@/components/synoptique/lib/types";

import type { InventaireRack } from "../../inventaire/inventaire-client";
import { LoadingState } from "@/components/ui/loading-state";
export function RackTabSidePanel({
  projectId,
  selectedRackId,
  selectedRackSlots,
  equipmentMap,
  panelMap,
}: {
  projectId: string;
  selectedRackId: string | null;
  /** Slots du rack courant — pour calculer `remaining` du BOM. */
  selectedRackSlots: Slot[];
  /** Map equipmentId → Equipment (catalogue) — pour le drag des BomItem. */
  equipmentMap: Map<string, Equipment>;
  /** Map panelId → PanelItem. */
  panelMap: Map<string, PanelItem>;
}) {
  return (
    <SidePanelLayout
      title="Éléments à placer"
      hint="Glissez un élément vers le rack."
    >
      {selectedRackId ? (
        <BomItemsList
          projectId={projectId}
          rackId={selectedRackId}
          slots={selectedRackSlots}
          equipmentMap={equipmentMap}
          panelMap={panelMap}
        />
      ) : (
        <NoRackSelectedMessage />
      )}
    </SidePanelLayout>
  );
}

/**
 * Variante « par emplacement » : les mêmes listes d'éléments à placer, mais
 * une section par contenant du lieu. Chaque draggable reste rattaché à SON
 * contenant (le BOM est rack-scopé) — l'utilisateur glisse l'élément vers la
 * colonne correspondante du canvas.
 *
 * Accordéon exclusif : un seul contenant ouvert à la fois, le premier par
 * défaut. Les sections repliées restent MONTÉES (hauteur animée à 0) — c'est
 * ce qui permet à leur en-tête d'afficher un compteur juste sans attendre
 * l'ouverture.
 */
export function RackTabLocationSidePanel({
  projectId,
  racks,
  equipmentMap,
  panelMap,
}: {
  projectId: string;
  /** Contenants du lieu, dans l'ordre d'affichage du canvas. */
  racks: { id: string; name: string; slots: Slot[] }[];
  equipmentMap: Map<string, Equipment>;
  panelMap: Map<string, PanelItem>;
}) {
  const firstRackId = racks[0]?.id ?? null;
  const [openRackId, setOpenRackId] = useState<string | null>(firstRackId);
  // Le lieu (ou son ordre) a changé : on retombe sur le premier contenant.
  const knownFirstRef = useRef(firstRackId);
  if (knownFirstRef.current !== firstRackId) {
    knownFirstRef.current = firstRackId;
    if (openRackId == null || !racks.some((r) => r.id === openRackId)) {
      setOpenRackId(firstRackId);
    }
  }

  const [remainingByRack, setRemainingByRack] = useState<
    Record<string, number>
  >({});
  // Callbacks stables par contenant — sinon chaque rendu remonterait un
  // `onRemainingChange` neuf et relancerait l'effet de publication.
  const remainingCbRef = useRef(new Map<string, (n: number) => void>());
  const makeRemainingCb = useCallback((rackId: string) => {
    const cache = remainingCbRef.current;
    let cb = cache.get(rackId);
    if (!cb) {
      cb = (n: number) =>
        setRemainingByRack((prev) =>
          prev[rackId] === n ? prev : { ...prev, [rackId]: n },
        );
      cache.set(rackId, cb);
    }
    return cb;
  }, []);

  return (
    <SidePanelLayout
      title="Éléments à placer"
      hint="Glissez un élément vers la colonne de son contenant."
    >
      {racks.length === 0 ? (
        <NoRackSelectedMessage />
      ) : (
        <div className="flex flex-col">
          {racks.map((r) => {
            const open = openRackId === r.id;
            const remaining = remainingByRack[r.id];
            return (
              <div key={r.id} className="border-border/60 border-b">
                <button
                  type="button"
                  onClick={() => setOpenRackId(open ? null : r.id)}
                  aria-expanded={open}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2 text-left transition-colors",
                    open ? "bg-secondary/40" : "hover:bg-secondary/20",
                  )}
                >
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200"
                    style={{ transform: open ? undefined : "rotate(-90deg)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.12em] uppercase">
                    {r.name}
                  </span>
                  {remaining != null && remaining > 0 && (
                    <span
                      className="shrink-0 tabular-nums text-[11px] font-semibold text-[var(--muted-foreground)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                      title={`${remaining} élément(s) à placer`}
                    >
                      {remaining}
                    </span>
                  )}
                </button>
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <BomItemsList
                      projectId={projectId}
                      rackId={r.id}
                      rackName={r.name}
                      slots={r.slots}
                      equipmentMap={equipmentMap}
                      panelMap={panelMap}
                      onRemainingChange={makeRemainingCb(r.id)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SidePanelLayout>
  );
}

// ── Layout commun ────────────────────────────────────────────────────────────

function SidePanelLayout({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex-none border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold leading-none">{title}</h3>
        {hint && (
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
            {hint}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

// ── ContainerList — liste filtrée racks.isRackable ──────────────────────────
//
// Design aligné sur `ContainerPanel` de l'onglet Inventaire : badge numéro
// (mono, sobre), dot couleur par type, nom uppercase, sous-titre type/U.
// Pas de drag handle ici : pour l'onglet Rack, le réorder se fait dans
// l'onglet Inventaire — on garde juste la sélection.

type RackTypeId = InventaireRack["rackType"];

const RACK_TYPE_LABEL: Record<RackTypeId, string> = {
  STANDARD: 'Baie 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

const RACK_TYPE_DOT: Record<RackTypeId, string> = {
  STANDARD: "#3b82f6",
  FLIGHT_CASE_CLASSIC: "#f59e0b",
  FLIGHT_CASE_SKB: "#f59e0b",
  PELICAN: "#06b6d4",
  CAP: "#a855f7",
};

function ContainerList({
  racks,
  selectedRackId,
  onSelectRack,
}: {
  racks: InventaireRack[];
  selectedRackId: string | null;
  onSelectRack: (rackId: string) => void;
}) {
  const rackable = racks.filter((r) => r.isRackable);

  if (rackable.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Server className="text-muted-foreground h-8 w-8" strokeWidth={1.5} />
        <p className="text-muted-foreground text-xs">
          Aucun contenant rackable
        </p>
        <p className="text-muted-foreground/70 max-w-[200px] text-[11px] leading-snug">
          Créez un contenant rackable (baie 19&quot;, flight case…) depuis
          l&apos;onglet Inventaire pour pouvoir y placer des équipements.
        </p>
      </div>
    );
  }

  return (
    <ul className="relative flex flex-col gap-1 p-3">
      {rackable.map((r, idx) => {
        const active = selectedRackId === r.id;
        const orderNum = idx + 1;
        return (
          <li key={r.id} className="relative">
            <div
              className={cn(
                "group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors cursor-pointer",
                active
                  ? "border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                  : "border-transparent hover:border-[var(--border)] hover:bg-[var(--secondary)]/40",
              )}
              onClick={() => onSelectRack(r.id)}
            >
              <span className="bg-secondary/50 border-border text-foreground inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold tabular-nums">
                {orderNum}
              </span>

              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: RACK_TYPE_DOT[r.rackType] }}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <p
                  className={
                    active
                      ? "truncate text-[11px] font-semibold uppercase text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                      : "truncate text-[11px] font-medium uppercase text-[var(--foreground)]"
                  }
                >
                  {r.name}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
                  {RACK_TYPE_LABEL[r.rackType]}
                  {r.isRackable ? ` · ${r.totalU}U` : ""}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── BomItemsList — items BOM filtrés par kind, draggables vers le canvas ───

function BomItemsList({
  projectId,
  rackId,
  rackName,
  slots,
  equipmentMap,
  panelMap,
  onRemainingChange,
}: {
  projectId: string;
  rackId: string;
  /** Nom du contenant — message de refus en affichage multi-contenants. */
  rackName?: string;
  slots: Slot[];
  equipmentMap: Map<string, Equipment>;
  panelMap: Map<string, PanelItem>;
  /**
   * Publie le total d'exemplaires restant à placer — l'accordéon par
   * emplacement s'en sert pour son compteur d'en-tête, y compris section
   * repliée (la liste reste montée, seule sa hauteur est animée).
   */
  onRemainingChange?: (remaining: number) => void;
}) {
  const rackBom = useRackBom(projectId, rackId, slots);

  // ── Résolution main-first → fallback tenant ────────────────────────────────
  // `equipmentMap` vient du payload canvas-data : catalogue Arkyo (main DB) +
  // les fiches déjà résolues par les slots DÉJÀ POSÉS. Un équipement PERSO
  // (soft-FK vers TenantEquipment, snapshotId null) jamais placé n'y figure
  // donc pas, et l'item disparaissait silencieusement de la liste. On complète
  // par le lookup catalogue tenant, qui applique lui-même la règle maison
  // (main DB d'abord, fallback TenantEquipment sur les ids introuvables).
  const unresolvedEquipmentIds = useMemo(() => {
    const out = new Set<string>();
    for (const it of rackBom.items) {
      if (it.kind !== "equipment" || !it.refId) continue;
      if (!equipmentMap.has(it.refId)) out.add(it.refId);
    }
    return [...out];
  }, [rackBom.items, equipmentMap]);
  const { items: personalEquipment } = useCatalogLookup(
    "equipment",
    unresolvedEquipmentIds,
  );
  // Identité conservée tant qu'il n'y a rien à compléter (cas nominal).
  const resolvedEquipment =
    personalEquipment.size === 0
      ? equipmentMap
      : new Map<string, Equipment>([...personalEquipment, ...equipmentMap]);

  // Affiche TOUT le BOM plaçable dans le contenant, regroupé par kind ci-dessous.
  // Les adaptateurs sont volontairement EXCLUS — ce ne sont pas des éléments
  // rackables (ils se posent sur les ports d'équipements, pas dans des U).
  //
  // Les équipements NON rackables sont bien listés : ils n'occupent pas de U
  // mais se posent sur une étagère (cf. badge « Étagère » et chemin de drop
  // `shelf-equipment` du canvas).
  const items = rackBom.items.filter((it) => {
    // Composants installés dans un hôte (châssis modulaire) : pas d'empreinte
    // U, ils ne se placent pas dans le rack.
    if (it.hostItemId) return false;
    if (it.kind === "adapter") return false;
    if (it.kind === "equipment") {
      const eq = it.refId ? resolvedEquipment.get(it.refId) : null;
      if (!eq) return false;
      // Test sur `false` explicite : un payload incomplet (champ absent) reste
      // traité comme rackable, comportement historique.
      const shelfOnly = eq.isRackable === false;
      // Rackable mais sans hauteur connue : impossible à poser dans des U.
      if (!shelfOnly && (eq.heightU == null || eq.heightU <= 0)) return false;
    }
    return (
      it.kind === "equipment" ||
      it.kind === "panel" ||
      it.kind === "accessory"
    );
  });

  const remainingTotal = items.reduce(
    (n, it) => n + Math.max(0, it.remaining),
    0,
  );
  const onRemainingChangeRef = useRef(onRemainingChange);
  onRemainingChangeRef.current = onRemainingChange;
  useEffect(() => {
    onRemainingChangeRef.current?.(remainingTotal);
  }, [remainingTotal]);

  if (rackBom.status === "loading") {
    return <LoadingState label="Chargement du BOM…" className="py-12" />;
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-muted-foreground text-xs">
          {rackBom.status === "success"
            ? "Aucun élément à placer dans ce contenant"
            : "BOM indisponible"}
        </p>
        {rackBom.status === "not-found" && (
          <p className="text-muted-foreground/70 mt-1 text-[10px] leading-snug">
            Ce rack ne semble pas appartenir au projet.
          </p>
        )}
      </div>
    );
  }

  // UNE carte par référence, pas par exemplaire : le compteur « ×N » porte le
  // reste à placer et décrémente à chaque pose (`remaining` vient de
  // `use-rack-bom`). À 0, la carte reste visible mais grisée et non draggable.
  //
  // Regroupement par catégorie / fonction (Vidéo, Audio, …) — pattern aligné
  // sur le catalog-panel inventaire. Le user pense "métier" avant "type de
  // modèle" → on évite le regroupement par kind (Équipement/Panel/Accessoire)
  // sauf pour les panels et accessoires qui n'ont pas de fonction associée
  // et restent dans des groupes nommés en dur en fin de liste.
  type Group = { key: string; label: string; items: typeof items };
  const groupMap = new Map<string, Group>();
  const PANEL_LABEL = "Panels";
  const ACCESSORY_LABEL = "Accessoires";
  const UNCAT_LABEL = "Autres";

  for (const item of items) {
    let label: string;
    if (item.kind === "panel") label = PANEL_LABEL;
    else if (item.kind === "accessory") label = ACCESSORY_LABEL;
    else label = item.category ?? UNCAT_LABEL;

    const existing = groupMap.get(label);
    if (existing) {
      existing.items.push(item);
    } else {
      groupMap.set(label, { key: label, label, items: [item] });
    }
  }

  // Ordre des groupes : fonctions du seed dans l'ordre métier, puis Panels,
  // Accessoires, Autres, puis toute fonction custom restante triée alpha.
  const SEEDED_FUNCTION_ORDER = [
    "Vidéo",
    "Audio",
    "Lumières",
    "Contrôle",
    "Énergie",
    "Data (IT)",
    "Synchronisation",
    "RF / Sans-fil",
    "Intercom",
  ];
  const grouped: Group[] = [];
  for (const label of SEEDED_FUNCTION_ORDER) {
    const g = groupMap.get(label);
    if (g) {
      grouped.push(g);
      groupMap.delete(label);
    }
  }
  const tail: Group[] = [];
  if (groupMap.has(PANEL_LABEL)) {
    tail.push(groupMap.get(PANEL_LABEL)!);
    groupMap.delete(PANEL_LABEL);
  }
  if (groupMap.has(ACCESSORY_LABEL)) {
    tail.push(groupMap.get(ACCESSORY_LABEL)!);
    groupMap.delete(ACCESSORY_LABEL);
  }
  if (groupMap.has(UNCAT_LABEL)) {
    tail.push(groupMap.get(UNCAT_LABEL)!);
    groupMap.delete(UNCAT_LABEL);
  }
  // Fonctions custom restantes — tri alphabétique stable.
  const customs = Array.from(groupMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "fr"),
  );
  grouped.push(...customs, ...tail);

  return (
    <div className="space-y-3 p-2">
      {grouped.map((group) => (
        <div key={group.key} className="space-y-1.5">
          {group.label && (
            <p className="text-muted-foreground/70 px-1 pt-1 text-[9px] font-bold uppercase tracking-widest">
              {group.label}
            </p>
          )}
          {/* Ce qui reste à placer d'abord, les références épuisées ensuite :
              sans ça les cartes grisées se glissent entre les actives. */}
          {[...group.items]
            .sort((a, b) => Number(a.remaining <= 0) - Number(b.remaining <= 0))
            .map((item) => (
              <DraggableBomItem
                key={item.id}
                item={item}
                equipmentMap={resolvedEquipment}
                panelMap={panelMap}
                remainingCount={item.remaining}
                placed={item.remaining <= 0}
                sourceRackId={rackId}
                sourceRackName={rackName}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function NoRackSelectedMessage() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Server className="text-muted-foreground h-8 w-8" />
      <p className="text-muted-foreground text-xs">Aucun contenant sélectionné</p>
      <p className="text-muted-foreground/70 max-w-[200px] text-[11px] leading-snug">
        Sélectionnez un contenant via l&apos;outil <strong>Contenants</strong>{" "}
        pour afficher les éléments à placer.
      </p>
    </div>
  );
}
