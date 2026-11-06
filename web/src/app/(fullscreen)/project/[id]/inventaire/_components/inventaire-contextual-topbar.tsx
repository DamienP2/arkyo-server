"use client";

/**
 * InventaireContextualTopbar — contenu de la sous-topbar contextuelle pour
 * l'onglet Inventaire. Pattern aligné sur `tools-design.tsx` du rack-editor.
 *
 *  - `equipment` : recherche · catégorie · marque · tri
 *  - `panel` / `adapter` : recherche
 *  - `accessory` / `container` : pas de filtres (les accessoires se règlent
 *    dans le configurateur du panneau latéral, il n'y a aucune liste)
 *
 * Lit / écrit l'état dans `InventaireScope` (`catalogFilters`,
 * `catalogOptions`).
 */

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Search,
  SlidersHorizontal,
  X,
} from "@/components/ui/icons";

import {
  Group,
  GroupDivider,
  segBtn,
  segmentedContainerCls,
  standaloneBtnCls,
} from "@/components/editor-shell/tool-topbar-ui";

import { useInventaireScope, type TechOption } from "./inventaire-scope";
import { LocationSelectorDropdown } from "./location-selector-dropdown";
import type { InventaireToolId } from "./inventaire-left-toolbar";

const inputCls =
  "h-7 rounded-md border border-border bg-background px-2 text-[11px] outline-none transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]";

export function InventaireContextualTopbar({
  activeTool,
}: {
  activeTool: InventaireToolId | null;
}) {
  // Mode template (projectId null) : pas de lieux, donc pas de sélecteur —
  // seuls les filtres du catalogue restent.
  const { projectId } = useInventaireScope();
  // Le sélecteur d'emplacement est sinon TOUJOURS présent (même geste que le
  // sélecteur de contenant de l'onglet Rack) ; les filtres du catalogue le
  // suivent selon l'outil actif.
  // L'outil « Accessoires » n'a plus de filtres de topbar : son panneau est un
  // configurateur autonome (type / hauteur / style ou profondeur) et il n'y a
  // aucune liste à rechercher.
  const filters =
    activeTool === null || activeTool === "accessory" ? null : (
      <CatalogToolTopbar tool={activeTool} />
    );

  if (!projectId) return filters;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Group label="Emplacement">
        <LocationSelectorDropdown />
      </Group>
      {filters && (
        <>
          <GroupDivider />
          <div className="min-w-0 flex-1">{filters}</div>
        </>
      )}
    </div>
  );
}

// ── Catalog (equipment / panel / adapter) ────────────────────────────────────

const RACKABLE_OPTIONS: { id: "all" | "rackable" | "non"; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "rackable", label: "Rackable" },
  { id: "non", label: "Non rack." },
];

// Options techniques filtrables (multi, union) — onglet Équipements.
const TECH_OPTIONS: { id: TechOption; label: string }[] = [
  { id: "host", label: "Modulaire" },
  { id: "component", label: "Composant" },
  { id: "2110", label: "2110" },
  { id: "lighting", label: "Lumière" },
];

function CatalogToolTopbar({ tool }: { tool: InventaireToolId }) {
  const {
    catalogFilters: filters,
    setCatalogFilters,
    catalogOptions,
  } = useInventaireScope();

  const isEquipment = tool === "equipment";
  const isAdapter = tool === "adapter";
  const hasFilters = isEquipment || isAdapter;

  // Source de catégories selon l'onglet (équipement / adaptateur).
  const categorySource = isAdapter
    ? {
        options: catalogOptions.adapterCategoryNames,
        optionsWithColor: catalogOptions.adapterCategories,
        selected: filters.adapterCategoryNames,
        key: "adapterCategoryNames" as const,
      }
    : {
        options: catalogOptions.categoryNames,
        optionsWithColor: catalogOptions.categories,
        selected: filters.categoryNames,
        key: "categoryNames" as const,
      };

  const setFilters = (patch: Partial<typeof filters>) =>
    setCatalogFilters((prev) => ({ ...prev, ...patch }));

  const toggleCategory = (cat: string) => {
    setCatalogFilters((prev) => {
      const list = prev[categorySource.key];
      return {
        ...prev,
        [categorySource.key]: list.includes(cat)
          ? list.filter((c) => c !== cat)
          : [...list, cat],
      };
    });
  };

  const toggleTechOption = (opt: TechOption) => {
    setCatalogFilters((prev) => ({
      ...prev,
      techOptions: prev.techOptions.includes(opt)
        ? prev.techOptions.filter((o) => o !== opt)
        : [...prev.techOptions, opt],
    }));
  };

  const reset = () =>
    setCatalogFilters((prev) => ({
      ...prev,
      categoryNames: [],
      techOptions: [],
      adapterCategoryNames: [],
      brandName: null,
      rackable: null,
    }));

  const activeFilterCount =
    categorySource.selected.length +
    (isEquipment ? filters.techOptions.length : 0) +
    (isEquipment && filters.brandName ? 1 : 0) +
    (isEquipment && filters.rackable !== null ? 1 : 0);

  // Recherche + Filtres (popover regroupant Type/Catégorie/Marque/Options) +
  // Tri : tout tient dans la ligne — plus jamais de scroll horizontal.
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* Recherche */}
      <div className="relative shrink-0">
        <Search className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Rechercher…"
          className={`${inputCls} w-44 pl-7`}
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => setFilters({ search: "" })}
            className="hover:bg-border absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 transition-colors"
            title="Effacer"
          >
            <X className="text-muted-foreground h-3 w-3" />
          </button>
        )}
      </div>

      {hasFilters && (
        <>
          <GroupDivider />
          <FiltersPopover
            isEquipment={isEquipment}
            filters={filters}
            setFilters={setFilters}
            catalogOptions={catalogOptions}
            categorySource={categorySource}
            toggleCategory={toggleCategory}
            toggleTechOption={toggleTechOption}
            activeFilterCount={activeFilterCount}
            onReset={reset}
          />
        </>
      )}

      <GroupDivider />

      {/* Tri */}
      <Group label="Tri">
        <button
          type="button"
          onClick={() =>
            setFilters({
              sortBy: filters.sortBy === "name-asc" ? "name-desc" : "name-asc",
            })
          }
          className={`${standaloneBtnCls} border-border shrink-0 border`}
          title={filters.sortBy === "name-asc" ? "A → Z" : "Z → A"}
        >
          {filters.sortBy === "name-asc" ? "A→Z" : "Z→A"}
        </button>
      </Group>
    </div>
  );
}

// ── Popover Filtres — regroupe Type / Catégorie / Marque / Options ──────────

type CatalogFiltersState = ReturnType<
  typeof useInventaireScope
>["catalogFilters"];
type CatalogOptionsState = ReturnType<
  typeof useInventaireScope
>["catalogOptions"];

function FiltersPopover({
  isEquipment,
  filters,
  setFilters,
  catalogOptions,
  categorySource,
  toggleCategory,
  toggleTechOption,
  activeFilterCount,
  onReset,
}: {
  isEquipment: boolean;
  filters: CatalogFiltersState;
  setFilters: (patch: Partial<CatalogFiltersState>) => void;
  catalogOptions: CatalogOptionsState;
  categorySource: {
    optionsWithColor: { name: string; color: string | null }[];
    selected: string[];
  };
  toggleCategory: (name: string) => void;
  toggleTechOption: (opt: TechOption) => void;
  activeFilterCount: number;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  // `position: fixed` (coords calculées à l'ouverture) : la topbar parente
  // clippe ses enfants absolus.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openMenu = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  };

  const rackableSelected: "all" | "rackable" | "non" =
    filters.rackable === null ? "all" : filters.rackable ? "rackable" : "non";

  const sectionLabelCls =
    "text-muted-foreground text-[9px] font-medium tracking-[0.15em] uppercase";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cnFilters(
          "border-border inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
          activeFilterCount > 0
            ? "border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
            : "bg-background hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
        )}
      >
        <SlidersHorizontal className="h-3 w-3" />
        Filtres
        {activeFilterCount > 0 && (
          // arkyo-server: habillage Strata (texte sur accent plein : --accent-foreground)
          <span className="rounded-full bg-[var(--accent)] px-1.5 font-mono text-[9px] font-bold text-[var(--accent-foreground)] tabular-nums">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && menuPos && (
        <div
          ref={menuRef}
          className="border-border bg-card fixed z-[100] max-h-[70vh] w-[300px] overflow-auto rounded-lg border p-3 shadow-lg"
          style={{ left: menuPos.left, top: menuPos.top }}
        >
          <div className="flex flex-col gap-3">
            {/* Type rackable — équipements uniquement */}
            {isEquipment && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabelCls}>Type</span>
                <div className={segmentedContainerCls}>
                  {RACKABLE_OPTIONS.map((o) => {
                    const active = rackableSelected === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          setFilters({
                            rackable:
                              o.id === "all"
                                ? null
                                : o.id === "rackable"
                                  ? true
                                  : false,
                          })
                        }
                        data-active={active}
                        className={segBtn(active)}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Catégories (multi) — liste inline avec point coloré */}
            <div className="flex flex-col gap-1.5">
              <span className={sectionLabelCls}>Catégorie</span>
              {categorySource.optionsWithColor.length === 0 ? (
                <p className="text-muted-foreground text-[11px]">
                  Aucune catégorie
                </p>
              ) : (
                <ul className="border-border/60 max-h-44 overflow-auto rounded-md border py-1">
                  {categorySource.optionsWithColor.map((opt) => {
                    const active = categorySource.selected.includes(opt.name);
                    return (
                      <li key={opt.name}>
                        <button
                          type="button"
                          onClick={() => toggleCategory(opt.name)}
                          className="hover:bg-muted/60 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors"
                        >
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/5"
                            style={{
                              backgroundColor:
                                opt.color ?? CATEGORY_DOT_FALLBACK,
                            }}
                          />
                          <span className="flex-1 truncate">{opt.name}</span>
                          {active && (
                            <Check className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Marque — équipements uniquement */}
            {isEquipment && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabelCls}>Marque</span>
                <select
                  value={filters.brandName ?? ""}
                  onChange={(e) =>
                    setFilters({
                      brandName: e.target.value === "" ? null : e.target.value,
                    })
                  }
                  className={`${inputCls} w-full`}
                  title="Marque"
                >
                  <option value="">
                    {catalogOptions.brandNames.length === 0
                      ? "Aucune marque"
                      : "Toutes"}
                  </option>
                  {catalogOptions.brandNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Options techniques — équipements uniquement */}
            {isEquipment && (
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabelCls}>Options</span>
                <div className={segmentedContainerCls}>
                  {TECH_OPTIONS.map((o) => {
                    const active = filters.techOptions.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggleTechOption(o.id)}
                        data-active={active}
                        className={segBtn(active)}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                // arkyo-server: habillage Strata (action d'effacement : --danger)
                className="flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--danger)]/30 px-2 text-[11px] font-medium text-[var(--danger-text)] transition-colors hover:bg-[var(--danger)]/10"
              >
                Effacer les filtres ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Mini-helper local (évite d'importer cn pour deux concaténations).
function cnFilters(...parts: (string | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

// Couleur de point par défaut pour une catégorie sans couleur.
const CATEGORY_DOT_FALLBACK = "#94a3b8"; // slate-400
