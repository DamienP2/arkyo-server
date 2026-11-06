"use client";

/**
 * InventaireExport — point d'entrée UNIQUE d'export de l'onglet Inventaire,
 * via le modal partagé `ExportMenu`.
 *
 * L'inventaire est une LISTE : il n'exporte que des documents de données, pas
 * de capture visuelle du canvas.
 *
 *  - **PDF**   : cartouche technique A4 paysage « Grille allégée »
 *      (`buildBomPdf`), dessiné nativement — une seule mise en page, pas de
 *      modèle d'impression. Les modèles COVER / INTERIOR / BACK ont été
 *      débranchés de l'inventaire : une liste de matériel se lit à plat, la
 *      capture bitmap du tableau dégradait la finesse des filets.
 *  - **Excel** (CSV | XLSX) : mêmes colonnes, mêmes groupes, mêmes
 *      sous-totaux — CSV ou classeur `.xlsx` réel (SheetJS via CDN).
 *
 * Les trois sorties partent du MÊME modèle de tableau (`buildBomTable`), piloté
 * par les options de contenu : regroupement, sous-totaux, équipements libres,
 * colonnes. Toutes les générations sont PURES (elles renvoient un blob) — c'est
 * `ExportMenu` qui télécharge et prévisualise.
 *
 * Nom de fichier : `Inventaire_{Projet}_{AAAA-MM-JJ}`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "@/components/ui/icons";

import { api } from "@/lib/api-client";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn, slugifyName } from "@/lib/utils";
import { buildXlsxBlob } from "@/lib/export/table-xlsx";
import { buildCsv } from "@/lib/services/export/csv";

import {
  ExportMenu,
  type ExportCategoryKey,
  type ExportResult,
} from "../../_components/export-menu";
import type { ProjectFicheData } from "../../fiche/fiche-client";
import type { InventaireRack } from "../inventaire-client";
import { useInventaireScopeOptional } from "./inventaire-scope";
import {
  BOM_TABLE_COLUMNS,
  DEFAULT_BOM_TABLE_OPTIONS,
  bomColumnLabels,
  bomFlatRows,
  buildBomTable,
  columnsCoveredByGroups,
  isBomTotaledColumn,
  sanitizeBomTableOptions,
  type BomGroupBy,
  type BomTableColumnKey,
  type BomTableOptions,
} from "../_lib/bom-table";
import { buildBomPdf } from "../_lib/bom-pdf";

/** Nom et logo de l'espace — alimentent le cartouche du PDF. */
type EspaceInfo = { name?: string | null; logoUrl?: string | null };

/**
 * Validateur VOLONTAIREMENT tolérant sur les colonnes : on accepte n'importe
 * quelle liste de chaînes, et c'est `sanitizeBomTableOptions` qui retire
 * ensuite les clés inconnues (ex. « reference », colonne supprimée) et
 * complète l'ordre. Rejeter en bloc ferait perdre tous les autres réglages
 * mémorisés à cause d'une seule colonne disparue.
 */
function isBomTableOptions(v: unknown): v is BomTableOptions {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const isKeyList = (x: unknown) =>
    Array.isArray(x) && x.every((c) => typeof c === "string");
  return (
    isKeyList(o.columns) &&
    (o.columnOrder === undefined || isKeyList(o.columnOrder)) &&
    (o.groupBy === "none" ||
      o.groupBy === "location" ||
      o.groupBy === "container") &&
    typeof o.subtotals === "boolean" &&
    typeof o.includeFree === "boolean"
  );
}

export function InventaireExport({
  projectId,
  racks,
  fiche,
  open,
  onOpenChange,
}: {
  projectId: string;
  racks: InventaireRack[];
  fiche: ProjectFicheData;
  /** État du panneau — piloté par le parent (bouton du footer). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /** Base des noms de fichiers : `Inventaire_{Projet}_{AAAA-MM-JJ}`. */
  const fileBase = (stamp: string) =>
    `Inventaire_${slugifyName(fiche.name)}_${stamp}`;

  // Les emplacements servent d'en-têtes de groupe. Absents en mode template.
  const locations = useInventaireScopeOptional()?.locations ?? [];

  const [espace, setEspace] = useState<EspaceInfo>({});

  // ── Réglages mémorisés (par projet) ───────────────────────────────────────
  const storageKey = `export:inventaire:${projectId}`;

  // ── Options de contenu du tableau ─────────────────────────────────────────
  // Une seule source pour les trois sorties (PDF, CSV, XLSX) et pour l'aperçu.
  const [storedTableOptions, setTableOptions] =
    useLocalStorageState<BomTableOptions>(
      `${storageKey}:table`,
      DEFAULT_BOM_TABLE_OPTIONS,
      { isValid: isBomTableOptions },
    );
  // Migration douce des réglages mémorisés : colonnes disparues retirées,
  // ordre complété. Le stockage se met à jour à la première modification.
  const tableOptions = useMemo(
    () => sanitizeBomTableOptions(storedTableOptions),
    [storedTableOptions],
  );
  const table = useMemo(
    () => buildBomTable(racks, locations, tableOptions),
    // `locations` vient d'un contexte : sa référence change à chaque rendu du
    // scope. On dépend de sa signature utile (id + nom) plutôt que de l'objet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [racks, tableOptions, locations.map((l) => `${l.id}:${l.name}`).join("|")],
  );
  const hasBom = table.itemCount > 0;

  useEffect(() => {
    let alive = true;
    void api
      .get<EspaceInfo>("/api/tenant/espace/informations")
      .then((d) => alive && setEspace(d))
      .catch(() => {
        /* silencieux */
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Génère le PDF de la liste du matériel — SANS effet de bord (pas de
   * téléchargement, pas de persistance) : `ExportMenu` s'en charge selon
   * l'action choisie, et réutilise la même sortie pour l'aperçu.
   *
   * Une seule mise en page : le cartouche technique « Grille allégée »
   * (`buildBomPdf`), qui dessine lui-même la hiérarchie emplacement /
   * contenant / totaux à partir des lignes typées du modèle de table.
   */
  const buildPdf = async (
    stamp: string,
  ): Promise<{ blob: Blob; filename: string; pageCount: number }> => {
    const filename = `${fileBase(stamp)}.pdf`;
    const { blob, pageCount } = await buildBomPdf({
      table,
      title: "Inventaire",
      espace: { name: espace.name, logoUrl: espace.logoUrl },
      meta: { projectName: fiche.name, location: fiche.location },
    });
    return { blob, filename, pageCount };
  };

  const onExport = async (
    category: ExportCategoryKey,
    variant?: string,
  ): Promise<ExportResult> => {
    const stamp = new Date().toISOString().slice(0, 10);

    if (category === "excel") {
      // Mêmes colonnes, mêmes groupes, mêmes sous-totaux que le PDF : les
      // trois sorties partagent le modèle `table`.
      const labels = bomColumnLabels(table);
      const flat = bomFlatRows(table);
      if (variant === "xlsx") {
        const blob = await buildXlsxBlob({
          sheetName: "Matériel",
          columns: labels.map((h) => ({ key: h, label: h })),
          rows: flat.map((cells) =>
            Object.fromEntries(labels.map((h, i) => [h, cells[i] ?? null])),
          ),
        });
        return { blob, filename: `${fileBase(stamp)}.xlsx` };
      }
      const csv = buildCsv(labels, flat);
      return {
        blob: new Blob([csv], { type: "text/csv;charset=utf-8;" }),
        filename: `${fileBase(stamp)}.csv`,
      };
    }

    // ── PDF ───────────────────────────────────────────────────────────────
    // Génération PURE : c'est `ExportMenu` qui télécharge, et qui réutilise la
    // même sortie pour l'aperçu. Rien ne doit avoir d'effet de bord ici.
    return buildPdf(stamp);
  };

  return (
    <ExportMenu
      open={open}
      onOpenChange={onOpenChange}
      title="Exporter l'inventaire"
      formats={[
        {
          key: "pdf",
          label: "PDF",
          description: "Liste du matériel mise en page",
          disabled: !hasBom,
          options: (
            <BomContentOptions
              value={tableOptions}
              onChange={setTableOptions}
            />
          ),
        },
        {
          key: "excel",
          label: "Excel",
          description: "Liste du matériel",
          variants: [
            { key: "csv", label: "CSV" },
            { key: "xlsx", label: "XLSX" },
          ],
          disabled: !hasBom,
          options: (
            <BomContentOptions value={tableOptions} onChange={setTableOptions} />
          ),
        },
      ]}
      onExport={onExport}
      storageKey={storageKey}
      tablePreview={{
        columns: bomColumnLabels(table),
        rows: bomFlatRows(table),
      }}
      // Tout ce qui change la sortie : options de contenu — et l'espace,
      // chargé en asynchrone, dont le nom et le logo alimentent le cartouche.
      // Sans cette signature, l'aperçu ne se régénérerait pas (le slot
      // `options` est opaque pour le modal).
      previewKey={`${optionsKey(tableOptions)}:${table.rows.length}:${espace.name ?? ""}|${espace.logoUrl ?? ""}`}
    />
  );
}

/** Signature des options de contenu — entre dans `previewKey`. */
function optionsKey(o: BomTableOptions): string {
  return [
    o.groupBy,
    o.subtotals ? "st" : "-",
    o.includeFree ? "free" : "-",
    // L'ORDRE compte autant que la sélection : réordonner les pastilles doit
    // régénérer l'aperçu. Les colonnes neutralisées par le regroupement sont
    // hors jeu (le regroupement figure déjà dans la clé).
    o.columnOrder
      .filter(
        (k) =>
          o.columns.includes(k) && !columnsCoveredByGroups(o.groupBy).has(k),
      )
      .join(","),
  ].join("|");
}

// ── Options de contenu du tableau (communes PDF / CSV / XLSX) ────────────────

const GROUP_BY_LABEL: ReadonlyArray<{ id: BomGroupBy; label: string }> = [
  { id: "none", label: "Aucun" },
  { id: "location", label: "Emplacement" },
  { id: "container", label: "Contenant" },
];

function BomContentOptions({
  value,
  onChange,
}: {
  value: BomTableOptions;
  onChange: (next: BomTableOptions) => void;
}) {
  const covered = columnsCoveredByGroups(value.groupBy);
  const toggleColumn = (key: BomTableColumnKey) => {
    if (covered.has(key)) return;
    const active = value.columns.includes(key);
    // On ne retire jamais la dernière colonne EFFECTIVE : un tableau sans
    // colonne n'a pas de sens, et l'assainissement la rétablirait aussitôt.
    // Les colonnes neutralisées par le regroupement ne comptent pas.
    const effective = value.columns.filter((k) => !covered.has(k));
    if (active && effective.length <= 1) return;
    onChange({
      ...value,
      columns: active
        ? value.columns.filter((k) => k !== key)
        : [...value.columns, key],
    });
  };

  return (
    // Pas de filet ici : `ExportMenu` encadre déjà le slot `options`. En
    // ajouter un doublait le trait maintenant que ce bloc est seul en tête.
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Regroupement
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {GROUP_BY_LABEL.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onChange({ ...value, groupBy: g.id })}
              className={cn(
                "rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
                value.groupBy === g.id
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)]/60 text-[var(--foreground)] hover:bg-[var(--secondary)]/40",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <CheckRow
        label="Sous-totaux (quantité, poids, conso)"
        checked={value.subtotals}
        onToggle={() => onChange({ ...value, subtotals: !value.subtotals })}
      />
      <CheckRow
        label="Inclure les équipements libres"
        checked={value.includeFree}
        onToggle={() => onChange({ ...value, includeFree: !value.includeFree })}
      />

      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Colonnes
        </p>
        <ColumnChips
          order={value.columnOrder}
          selected={value.columns}
          covered={covered}
          onToggle={toggleColumn}
          onReorder={(columnOrder) => onChange({ ...value, columnOrder })}
        />
      </div>
    </div>
  );
}

/**
 * Pastilles de colonnes : clic = retenir / retirer, glisser = ordonner. La
 * liste porte TOUTES les colonnes, retenues ou non — c'est le même geste qui
 * décide de la présence et de la position dans le document.
 *
 * DndContext local : le modal est rendu en portal, hors du DndContext de
 * l'inventaire (drag catalogue → contenant), qu'il ne doit pas parasiter.
 */
function ColumnChips({
  order,
  selected,
  covered,
  onToggle,
  onReorder,
}: {
  order: BomTableColumnKey[];
  selected: BomTableColumnKey[];
  /** Colonnes neutralisées par le regroupement courant. */
  covered: Set<BomTableColumnKey>;
  onToggle: (key: BomTableColumnKey) => void;
  onReorder: (next: BomTableColumnKey[]) => void;
}) {
  const sensors = useSensors(
    // Seuil de 5 px : un clic net reste un clic (toggle), au-delà c'est un
    // déplacement.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const labels = useMemo(
    () => new Map(BOM_TABLE_COLUMNS.map((c) => [c.key, c.label])),
    [],
  );

  // Deux zones : les colonnes libres, réordonnables ; puis les colonnes
  // cumulées, épinglées en fin de tableau et donc non déplaçables.
  const free = order.filter((k) => !isBomTotaledColumn(k));
  const pinned = order.filter((k) => isBomTotaledColumn(k));

  return (
    <DndContext
      id="bom-columns-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const from = free.indexOf(active.id as BomTableColumnKey);
        const to = free.indexOf(over.id as BomTableColumnKey);
        if (from === -1 || to === -1) return;
        // On ne réordonne que la zone libre ; les colonnes cumulées restent
        // collées en fin d'ordre.
        onReorder([...arrayMove(free, from, to), ...pinned]);
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <SortableContext items={free} strategy={rectSortingStrategy}>
          {free.map((key) => (
            <ColumnChip
              key={key}
              id={key}
              label={labels.get(key) ?? key}
              active={selected.includes(key)}
              disabled={covered.has(key)}
              onToggle={() => onToggle(key)}
            />
          ))}
        </SortableContext>

        {pinned.length > 0 && (
          <>
            {/* Séparateur : à droite de ce trait, les colonnes de totaux, qui
                ne se déplacent pas. */}
            <span
              aria-hidden
              className="bg-border/70 mx-0.5 h-4 w-px shrink-0"
            />
            {pinned.map((key) => (
              <PinnedColumnChip
                key={key}
                label={labels.get(key) ?? key}
                active={selected.includes(key)}
                onToggle={() => onToggle(key)}
              />
            ))}
          </>
        )}
      </div>
    </DndContext>
  );
}

/**
 * Colonne cumulée : sélectionnable mais NON déplaçable — sa position en fin de
 * tableau est ce qui permet aux lignes de sous-total et de total d'aligner
 * leurs valeurs sous elle. Pas de poignée : rien à saisir.
 */
function PinnedColumnChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Colonne de total — toujours en fin de tableau"
      className={cn(
        "rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors select-none",
        active
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
          : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
      )}
    >
      {label}
    </button>
  );
}

function ColumnChip({
  id,
  label,
  active,
  disabled = false,
  onToggle,
}: {
  id: BomTableColumnKey;
  label: string;
  active: boolean;
  /**
   * Colonne neutralisée par le regroupement courant : les bandes de groupe
   * portent déjà l'information. L'état retenu de l'utilisateur est CONSERVÉ en
   * mémoire — on ne fait que le neutraliser tant que le regroupement couvre la
   * colonne, il reparaît dès qu'on repasse en « Aucun ».
   */
  disabled?: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  // Le navigateur émet un `click` au relâchement d'un déplacement : on compare
  // la distance parcourue depuis le `pointerdown` pour ne pas basculer la
  // colonne à la fin d'un glisser. `onPointerDownCapture` est un prop distinct
  // de `onPointerDown`, il ne recouvre pas le listener de dnd-kit.
  const pressPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      title={
        disabled
          ? "Déjà porté par les bandes de regroupement"
          : undefined
      }
      onPointerDownCapture={(e) => {
        pressPos.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const from = pressPos.current;
        pressPos.current = null;
        if (isDragging) return;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) {
          return;
        }
        onToggle();
      }}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors select-none",
        disabled
          ? "border-[var(--border)]/40 text-[var(--muted-foreground)]/50 line-through cursor-not-allowed"
          : cn(
              "cursor-grab touch-none active:cursor-grabbing",
              active
                // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                : "border-[var(--border)]/60 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40",
            ),
        isDragging && "z-10 opacity-60 shadow-sm",
      )}
    >
      {!disabled && (
        <GripVertical className="h-2.5 w-2.5 shrink-0 opacity-50" />
      )}
      {label}
    </button>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
        checked
          ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
          : "border-[var(--border)]/60 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
          checked
            // arkyo-server: habillage Strata (coche sur l'accent plein : --accent-foreground)
            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
            : "border-[var(--border)]",
        )}
      >
        {checked && (
          <svg
            viewBox="0 0 12 12"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2.5 6.5 5 9 9.5 3.5" />
          </svg>
        )}
      </span>
      <span
        className={cn(
          "text-[11px] font-medium",
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          checked ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
        )}
      >
        {label}
      </span>
    </button>
  );
}

