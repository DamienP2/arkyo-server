"use client";

// Conteneur du tab top-level "Généralités".
//
// Refonte 2026-05-23 (v9) : Hero 3 colonnes ÉGALES (33/33/33), réorganisé :
//   - Col 1 (HeroIdentityColumn) : Identité (nom + ref) + Marque +
//             Classification (Supervisor) + Options techniques + Documents.
//   - Col 2 (HeroSpecsColumn)    : Format + Dimensions + Poids & énergie.
//             Les blocs Dimensions / Poids & énergie viennent de
//             physical-tab.tsx (exports nommés PhysicalDimensionsBlock /
//             PhysicalPowerBlock) — extraction faite pour éviter la duplication
//             tout en gardant PhysicalTab opérationnel comme wrapper.
//   - Col 3 (HeroImagesColumn)   : INCHANGÉ — image principale 16:9 +
//             icône + schéma.
//
// Sous le Hero : Visuels rack (PhysicalRackVisualsBlock — pleine largeur,
// volumineux par nature) + Champs personnalisés (Supervisor uniquement).
//
// Persistance des documents : `FormData.documents` (EquipmentDocument[]),
// propagé au payload via `equipment-editor.tsx`. Champ DB :
//   - `CatalogEquipment.documents` (Json @default("[]"))
//   - `TenantEquipment.documents`  (Json @default("[]"))
//
// Capitalize au blur : le champ Nom transforme la 1ère lettre en majuscule
// au blur uniquement (pas pendant la saisie). Géré côté UI via `set("name", …)`.

import { useRef, useState } from "react";
import {
  Check,
  Cpu,
  FileText,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  Loader2,
  Network,
  Package,
  Server,
  Trash2,
  Upload,
} from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { getTypeIcon, isIconUrl } from "@/lib/type-icons";
import { RangeInput } from "@/components/wizard/range-input";
import { api, getApiErrorMessage } from "@/lib/api-client";
import {
  BrandPickerModal,
  BrandPickerTrigger,
} from "@/components/catalogue/brand-picker-modal";
import {
  FunctionPickerModal,
  FunctionPickerTrigger,
} from "@/components/catalogue/function-picker-modal";
import {
  TypePickerModal,
  TypePickerTrigger,
} from "@/components/catalogue/type-picker-modal";
import {
  FunctionMultiPickerModal,
  FunctionMultiPickerTrigger,
} from "@/components/catalogue/function-multi-picker-modal";
import {
  InlineTypeCreator,
  PersonalTypeDot,
} from "@/components/catalogue/inline-type-creator";
import { KindChoice } from "@/components/equipment/format-block";
import { FieldPresenceRing } from "@/components/presence/field-presence-ring";

import {
  type Brand,
  type CatalogFunctionLite,
  type CatalogTypeLite,
  type EquipmentDocument,
  type FormData,
  uid,
} from "./types";
import { CapacityIpTab } from "./capacity-ip-tab";
import {
  DisabledWrap,
  PhysicalDimensionsBlock,
  PhysicalPowerBlock,
  PhysicalRackVisualsBlock,
  SubBlock,
} from "./physical-tab";
import { CustomFieldsBlock } from "./custom-fields";

// Capitalize la première lettre d'une chaîne (gère les caractères accentués
// via toLocaleUpperCase). Ne touche pas si la 1ère lettre est déjà
// uppercase, ou si c'est un chiffre / symbole. Trim également.
function capitalizeFirstLetter(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  const first = trimmed.charAt(0);
  const upper = first.toLocaleUpperCase();
  if (first === upper) return trimmed;
  return upper + trimmed.slice(1);
}

export function GeneralTab({
  form,
  set,
  brands,
  isReadOnly,
  catColor,
  uHeights,
  showClassification,
  showDistribution,
  onCapacityChange,
  functions,
  types,
  typeId,
  setTypeId,
  functionIds,
  setFunctionIds,
  onCreateType,
  cableSafetyDefaultMm,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  brands: Brand[];
  /** Global « Sécurité câblage » (mm) — défaut affiché sur l'override arrière. */
  cableSafetyDefaultMm?: number;
  /** Lecture pure (tenant + arkyo) : pas d'opacité, mais les contrôles
   *  cliquables disparaissent et les inputs deviennent `readOnly`. */
  isReadOnly?: boolean;
  catColor: string;
  uHeights: number[];
  showClassification: boolean;
  showDistribution: boolean;
  /** Callback SMPTE 2110 — propagé jusqu'au bloc capacité IP (rendu inline
   *  sous le toggle SMPTE 2110 quand `form.is2110` est activé). */
  onCapacityChange: (
    signalName: string,
    patch: { in?: number; out?: number },
  ) => void;
  functions?: CatalogFunctionLite[];
  types?: CatalogTypeLite[];
  typeId: string | null;
  setTypeId: (v: string | null) => void;
  functionIds: string[];
  setFunctionIds: (v: string[] | ((prev: string[]) => string[])) => void;
  /** Création à la volée d'un type/sous-type perso. Absent = pas de création
   *  (mode superviseur ou lecture pure). */
  onCreateType?: (
    name: string,
    opts: { parentId: string | null; functionId: string },
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      {/* ── HERO 3 colonnes égales (33 / 33 / 33) ─────────────────────── */}
      <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
        {/* Col 1 : Identité + Marque + Classification + Options + Documents */}
        <HeroIdentityColumn
          form={form}
          set={set}
          brands={brands}
          isReadOnly={isReadOnly}
          catColor={catColor}
          showClassification={showClassification}
          functions={functions}
          types={types}
          typeId={typeId}
          setTypeId={setTypeId}
          functionIds={functionIds}
          setFunctionIds={setFunctionIds}
          onCapacityChange={onCapacityChange}
          onCreateType={onCreateType}
        />

        {/* Col 2 : Format + Dimensions + Poids & énergie */}
        <HeroSpecsColumn
          form={form}
          set={set}
          isReadOnly={isReadOnly}
          catColor={catColor}
          uHeights={uHeights}
          cableSafetyDefaultMm={cableSafetyDefaultMm}
        />

        {/* Col 3 : Image principale 16:9 → URL paste → Icône + Schéma */}
        <HeroImagesColumn
          form={form}
          set={set}
          isReadOnly={isReadOnly}
          typeId={typeId}
          types={types}
        />
      </section>

      {/* ── Champs personnalisés (Supervisor uniquement) ──────────────── */}
      {showDistribution && (
        <section className="space-y-3">
          <CustomFieldsBlock
            fields={form.customFields}
            onChange={(next) => set("customFields", next)}
            catColor={catColor}
          />
        </section>
      )}
    </div>
  );
}

// ─── Colonne 1 du Hero ──────────────────────────────────────────────────
//
// Identité + Marque + Classification (Supervisor) + Options techniques +
// Documents. Les options techniques et documents ont été déplacés depuis la
// col 2 (refonte v9) pour libérer cette col 2 et y placer Dimensions /
// Poids & énergie issus de physical-tab.tsx.

function HeroIdentityColumn({
  form,
  set,
  brands,
  isReadOnly,
  catColor,
  showClassification,
  functions,
  types,
  typeId,
  setTypeId,
  functionIds,
  setFunctionIds,
  onCapacityChange,
  onCreateType,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  brands: Brand[];
  isReadOnly?: boolean;
  catColor: string;
  showClassification: boolean;
  functions?: CatalogFunctionLite[];
  types?: CatalogTypeLite[];
  typeId: string | null;
  setTypeId: (v: string | null) => void;
  functionIds: string[];
  setFunctionIds: (v: string[] | ((prev: string[]) => string[])) => void;
  onCapacityChange: (
    signalName: string,
    patch: { in?: number; out?: number },
  ) => void;
  onCreateType?: (
    name: string,
    opts: { parentId: string | null; functionId: string },
  ) => Promise<void>;
}) {
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [functionPickerOpen, setFunctionPickerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [extraFunctionPickerOpen, setExtraFunctionPickerOpen] = useState(false);

  const selectedBrand = brands.find((b) => b.id === form.brandId) ?? null;

  const selectedType =
    typeId && types ? types.find((t) => t.id === typeId) ?? null : null;

  const primaryFunctionId = selectedType?.functionId ?? functionIds[0] ?? null;
  const primaryFunction =
    primaryFunctionId && functions
      ? functions.find((f) => f.id === primaryFunctionId) ?? null
      : null;

  const compatibleTypes =
    types && primaryFunctionId
      ? types.filter((t) => t.functionId === primaryFunctionId)
      : [];

  // ── Résolution 2 niveaux (type racine + sous-type optionnel) ────────────
  // `selectedType` peut être une racine OU un sous-type. On résout la racine
  // (le parent si sous-type) et la liste des sous-types disponibles.
  const rootType = selectedType
    ? selectedType.parentId
      ? types?.find((t) => t.id === selectedType.parentId) ?? selectedType
      : selectedType
    : null;
  const subTypes =
    rootType && types ? types.filter((t) => t.parentId === rootType.id) : [];
  const selectedSubTypeId = selectedType?.parentId ? selectedType.id : null;

  const setPrimaryFunction = (fnId: string | null) => {
    if (!fnId) {
      if (primaryFunctionId) {
        setFunctionIds((prev) => prev.filter((id) => id !== primaryFunctionId));
      }
      setTypeId(null);
      return;
    }
    // Reset type si incompatible
    if (types) {
      const t = typeId ? types.find((x) => x.id === typeId) : null;
      if (t && t.functionId !== fnId) {
        setTypeId(null);
      }
    }
    setFunctionIds((prev) => {
      const without = prev.filter((id) => id !== fnId);
      const oldPrimary =
        primaryFunctionId && primaryFunctionId !== fnId ? primaryFunctionId : null;
      const cleaned = oldPrimary ? without.filter((id) => id !== oldPrimary) : without;
      return [fnId, ...cleaned];
    });
  };

  // Fonctions additionnelles = celles de functionIds sauf la principale
  const additionalFunctionIds = functionIds.filter(
    (id) => id !== primaryFunctionId,
  );

  const setAdditionalFunctionIds = (ids: string[]) => {
    setFunctionIds((prev) => {
      const primary = prev.find((id) => id === primaryFunctionId);
      const head = primary ? [primary] : [];
      // Conserver l'ordre des nouveaux ids
      return [...head, ...ids.filter((id) => id !== primaryFunctionId)];
    });
  };

  return (
    <div className="flex h-full flex-col gap-5">
      {/* ── Identité — champ unique Nom / Référence (porté par `name` ;
          `reference` est un champ legacy dormant depuis la fusion) ────── */}
      <div className="flex flex-col gap-3">
        <FieldBlock label="Nom / Référence" required>
          <FieldPresenceRing field="name">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              onBlur={(e) => {
                if (isReadOnly) return;
                const next = capitalizeFirstLetter(e.target.value);
                if (next !== form.name) {
                  set("name", next);
                }
              }}
              placeholder="BRC-X400"
              autoFocus={!isReadOnly}
              readOnly={isReadOnly}
              className="flex h-11 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </FieldPresenceRing>
        </FieldBlock>
      </div>

      {/* ── Marque ────────────────────────────────────────────────────── */}
      <FieldBlock label="Marque">
        <FieldPresenceRing field="brand">
          <BrandPickerTrigger
            brand={selectedBrand}
            onClick={() => setBrandPickerOpen(true)}
            readOnly={isReadOnly}
          />
        </FieldPresenceRing>
        {!isReadOnly && (
          <BrandPickerModal
            open={brandPickerOpen}
            onOpenChange={setBrandPickerOpen}
            brands={brands}
            selectedId={form.brandId || null}
            onSelect={(id) => set("brandId", id ?? "")}
          />
        )}
      </FieldBlock>

      {/* ── Classification (Supervisor uniquement) ───────────────────── */}
      {showClassification && functions && types && (
        <div className="space-y-3">
          <SubBlockTitle title="Classification" />

          {/* Fonction principale */}
          <FieldBlock label="Fonction principale" required>
            {functions.length === 0 ? (
              <p className="py-1 text-[11px] text-[var(--muted-foreground)]">
                Aucune fonction définie. Ajoutez-en dans Paramètres → Classification.
              </p>
            ) : (
              <>
                <FunctionPickerTrigger
                  fn={primaryFunction}
                  onClick={() => setFunctionPickerOpen(true)}
                  readOnly={isReadOnly}
                />
                {!isReadOnly && (
                  <FunctionPickerModal
                    open={functionPickerOpen}
                    onOpenChange={setFunctionPickerOpen}
                    functions={functions}
                    selectedId={primaryFunctionId}
                    onSelect={(id) => setPrimaryFunction(id)}
                  />
                )}
              </>
            )}
          </FieldBlock>

          {/* Type d'équipement (racine, sous-type optionnel géré ci-dessous).
              Le bouton dashed « Nouveau type » crée un type perso à la volée —
              disponible même si aucun type Arkyo n'est encore rattaché. */}
          <FieldBlock label="Type d'équipement">
            {!primaryFunction ? (
              <p className="py-1 text-[11px] text-[var(--muted-foreground)]">
                Sélectionnez d&apos;abord une fonction principale.
              </p>
            ) : (
              <div className="space-y-2">
                {compatibleTypes.length === 0 ? (
                  !onCreateType || isReadOnly ? (
                    <p className="py-1 text-[11px] text-[var(--muted-foreground)]">
                      Aucun type rattaché à{" "}
                      <strong>{primaryFunction.label}</strong>.
                    </p>
                  ) : null
                ) : (
                  <>
                    <FieldPresenceRing field="type">
                      <TypePickerTrigger
                        type={selectedType}
                        parentType={selectedType?.parentId ? rootType : null}
                        accentColor={primaryFunction.color}
                        onClick={() => setTypePickerOpen(true)}
                        readOnly={isReadOnly}
                      />
                    </FieldPresenceRing>
                    {!isReadOnly && (
                      <TypePickerModal
                        open={typePickerOpen}
                        onOpenChange={setTypePickerOpen}
                        types={types}
                        functionFilterId={primaryFunctionId}
                        accentColor={primaryFunction.color}
                        selectedId={typeId}
                        onSelect={(id) => setTypeId(id)}
                      />
                    )}
                  </>
                )}
                {onCreateType && !isReadOnly && primaryFunctionId && (
                  <InlineTypeCreator
                    label="Nouveau type"
                    placeholder="Nom du type"
                    onCreate={(name) =>
                      onCreateType(name, {
                        parentId: null,
                        functionId: primaryFunctionId,
                      })
                    }
                  />
                )}
              </div>
            )}
          </FieldBlock>

          {/* Sous-type — visible dès qu'un type racine est retenu (Arkyo ou
              perso), pour permettre la création d'un sous-type sous une racine
              Arkyo. "Aucun" n'apparaît que s'il existe déjà des sous-types. */}
          {!isReadOnly && rootType && (subTypes.length > 0 || !!onCreateType) && (
            <FieldBlock label="Sous-type">
              <div className="flex flex-wrap gap-1.5">
                {subTypes.length > 0 && (
                  <SubTypeChip
                    label="Aucun"
                    active={!selectedSubTypeId}
                    color={primaryFunction?.color}
                    onClick={() => setTypeId(rootType.id)}
                  />
                )}
                {subTypes.map((sub) => (
                  <SubTypeChip
                    key={sub.id}
                    label={sub.name}
                    active={selectedSubTypeId === sub.id}
                    color={primaryFunction?.color}
                    personal={sub.source === "PERSONAL"}
                    onClick={() => setTypeId(sub.id)}
                  />
                ))}
                {onCreateType && (
                  <InlineTypeCreator
                    label="Nouveau sous-type"
                    placeholder="Nom du sous-type"
                    onCreate={(name) =>
                      onCreateType(name, {
                        parentId: rootType.id,
                        functionId: rootType.functionId,
                      })
                    }
                  />
                )}
              </div>
            </FieldBlock>
          )}

          {/* Fonctions supplémentaires (multi via picker) */}
          <FieldBlock label="Fonctions supplémentaires">
            {functions.length <= 1 ? (
              <p className="py-1 text-[11px] text-[var(--muted-foreground)]">
                Aucune fonction additionnelle disponible.
              </p>
            ) : (
              <>
                <FunctionMultiPickerTrigger
                  functions={functions}
                  selectedIds={additionalFunctionIds}
                  primaryFunctionId={primaryFunctionId}
                  onClick={() => setExtraFunctionPickerOpen(true)}
                  readOnly={isReadOnly}
                />
                {!isReadOnly && (
                  <FunctionMultiPickerModal
                    open={extraFunctionPickerOpen}
                    onOpenChange={setExtraFunctionPickerOpen}
                    functions={functions}
                    selectedIds={additionalFunctionIds}
                    onChange={(ids) => setAdditionalFunctionIds(ids)}
                    primaryFunctionId={primaryFunctionId}
                  />
                )}
              </>
            )}
          </FieldBlock>
        </div>
      )}

      {/* ── Options techniques (déplacé depuis col 2 — v9) ───────────── */}
      <OptionsSection
        form={form}
        set={set}
        isReadOnly={isReadOnly}
        catColor={catColor}
        onCapacityChange={onCapacityChange}
      />

      {/* ── Documents (déplacé depuis col 2 — v9) ────────────────────── */}
      <DocumentsSection
        form={form}
        set={set}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

// ─── Colonne 2 du Hero — Format + Dimensions + Poids & énergie ──────────
//
// Format reste premier sous-bloc. Dimensions et Poids & énergie viennent
// désormais de physical-tab.tsx (exports PhysicalDimensionsBlock /
// PhysicalPowerBlock) pour éviter la duplication. Options techniques et
// Documents ont été déplacés vers la col 1 (HeroIdentityColumn).

function HeroSpecsColumn({
  form,
  set,
  isReadOnly,
  catColor,
  uHeights,
  cableSafetyDefaultMm,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
  catColor: string;
  uHeights: number[];
  cableSafetyDefaultMm?: number;
}) {
  void uHeights;
  return (
    <div className="flex h-full flex-col gap-5">
      {/* ── Format (modularité + rackable/pose libre fusionnés) ──────── */}
      <FormatSection form={form} set={set} isReadOnly={isReadOnly} />

      {/* ── Dimensions (depuis physical-tab.tsx) ─────────────────────── */}
      {/* Un composant n'a pas d'empreinte propre : le bloc Dimensions est
          entièrement masqué (les valeurs stockées restent intactes). */}
      {!form.isComponent && (
        <PhysicalDimensionsBlock
          form={form}
          set={set}
          isReadOnly={isReadOnly}
          catColor={catColor}
          cableSafetyDefaultMm={cableSafetyDefaultMm}
        />
      )}

      {/* ── Poids & énergie (depuis physical-tab.tsx) ────────────────── */}
      <PhysicalPowerBlock
        form={form}
        set={set}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

// ─── OptionsSection — Choix exclusif 2110 / lumière DMX ────────────────
//
// Extraite de l'ancienne HeroFormatColumn (v8) pour rejoindre la col 1
// (Identité). Le comportement reste identique au wizard OptionsStep.

function OptionsSection({
  form,
  set,
  isReadOnly,
  catColor,
  onCapacityChange,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
  catColor: string;
  onCapacityChange: (
    signalName: string,
    patch: { in?: number; out?: number },
  ) => void;
}) {
  // Choix EXCLUSIF — calqué sur OptionsStep du wizard
  // (un équipement est soit 2110, soit Lumière DMX, soit ni l'un ni l'autre).
  const optionType: "none" | "2110" | "lighting" = form.is2110
    ? "2110"
    : form.isLightingFixture
      ? "lighting"
      : "none";

  const selectOption = (next: "none" | "2110" | "lighting") => {
    if (isReadOnly) return;
    set("is2110", next === "2110");
    set("isLightingFixture", next === "lighting");
    // Reset ip2110Mode quand on quitte 2110, init OOB par défaut quand on l'active.
    if (next === "2110") {
      if (form.ip2110Mode !== "OOB" && form.ip2110Mode !== "IB") {
        set("ip2110Mode", "OOB");
      }
    } else {
      set("ip2110Mode", null);
    }
  };

  // Lecture pure : si aucune option n'est sélectionnée, on ne rend pas du
  // tout le bloc (rien de pertinent à montrer). Sinon, on rend uniquement
  // la card active dans la grille, sans interaction.
  if (isReadOnly) {
    const hasAnything = optionType !== "none";
    if (!hasAnything) return null;
    return (
      <div className="space-y-3">
        <SubBlockTitle title="Options techniques" />
        <div className="grid grid-cols-1 gap-3">
          {optionType === "2110" && (
            <OptionCard
              icon={Network}
              title="SMPTE ST 2110"
              description="Flux IP vidéo / audio / ANC"
              active
              readOnly
              onClick={() => {}}
            />
          )}
          {optionType === "lighting" && (
            <OptionCard
              icon={Lightbulb}
              title="Appareil lumière"
              description="Pilotage DMX"
              active
              readOnly
              onClick={() => {}}
            />
          )}
        </div>

        {optionType === "2110" && (
          <div className="space-y-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
            <IpModeSelector
              value={form.ip2110Mode}
              onChange={() => {}}
              readOnly
            />
            <CapacityIpTab
              form={form}
              set={set}
              onCapacityChange={onCapacityChange}
              catColor={catColor}
              readOnly
            />
          </div>
        )}

        {optionType === "lighting" && (
          <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
            <RangeInput
              min={1}
              max={512}
              step={1}
              value={form.dmxChannelsDefault ?? 1}
              onChange={() => {}}
              label="Canaux DMX par défaut"
              unit=""
              editable
              showBounds
              readOnly
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SubBlockTitle title="Options techniques" />

      <div className="grid grid-cols-2 gap-3">
        <OptionCard
          icon={Network}
          title="SMPTE ST 2110"
          description="Flux IP vidéo / audio / ANC"
          active={optionType === "2110"}
          onClick={() => selectOption(optionType === "2110" ? "none" : "2110")}
        />
        <OptionCard
          icon={Lightbulb}
          title="Appareil lumière"
          description="Pilotage DMX"
          active={optionType === "lighting"}
          onClick={() =>
            selectOption(optionType === "lighting" ? "none" : "lighting")
          }
        />
      </div>

      {optionType === "2110" && (
        <div className="space-y-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
          <IpModeSelector
            value={form.ip2110Mode}
            onChange={(v) => set("ip2110Mode", v)}
          />
          <CapacityIpTab
            form={form}
            set={set}
            onCapacityChange={onCapacityChange}
            catColor={catColor}
          />
        </div>
      )}

      {optionType === "lighting" && (
        <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--card)]/40 p-3">
          <RangeInput
            min={1}
            max={512}
            step={1}
            value={form.dmxChannelsDefault ?? 1}
            onChange={(v) => set("dmxChannelsDefault", v)}
            label="Canaux DMX par défaut"
            unit=""
            editable
            showBounds
          />
        </div>
      )}
    </div>
  );
}

// ─── FormatSection — bloc « Format » unifié (col 2) ─────────────────────────
//
// Fusionne la modularité (toggle « Équipement modulaire » + choix Châssis /
// Composant) et le format de baie (Rackable / Pose libre) dans un seul bloc.
//
// Un équipement modulaire est SOIT un châssis (accueille des composants),
// SOIT un composant (s'insère dans un hôte) — jamais les deux (l'API renvoie
// 400 sinon). L'état « modulaire » est dérivé de `isComponentHost ||
// isComponent` : aucun champ FormData supplémentaire n'est introduit.
//
// Sélectionner « Composant » force la pose libre (`isRackable=false`) et
// masque le choix Rackable / Pose libre : un composant n'a pas de format de
// baie propre. Quitter « Composant » (vers Châssis ou toggle OFF) restaure
// `isRackable=true` — comportement par défaut d'un équipement.

function FormatSection({
  form,
  set,
  isReadOnly,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
}) {
  const isModular = form.isComponentHost || form.isComponent;

  const toggleModular = () => {
    if (isReadOnly) return;
    if (isModular) {
      // Désactivation → ni châssis ni composant, retour au format par défaut.
      set("isComponentHost", false);
      set("isComponent", false);
      set("isRackable", true);
    } else {
      // Activation → châssis par défaut.
      set("isComponentHost", true);
      set("isComponent", false);
      if (form.hostSlotCount == null) set("hostSlotCount", 10);
    }
  };

  const selectChassis = () => {
    if (isReadOnly) return;
    set("isComponentHost", true);
    set("isComponent", false);
    // Quitter « Composant » restaure le format par défaut.
    set("isRackable", true);
    if (form.hostSlotCount == null) set("hostSlotCount", 10);
  };

  const selectComponent = () => {
    if (isReadOnly) return;
    set("isComponent", true);
    set("isComponentHost", false);
    // Un composant s'insère dans un hôte : pas de format de baie propre.
    set("isRackable", false);
  };

  return (
    <SubBlock title="Format">
      <ModularToggle
        checked={isModular}
        onChange={toggleModular}
        readOnly={isReadOnly}
      />

      {isModular && (
        <>
          <KindChoice
            value={form.isComponent ? "component" : "chassis"}
            onChange={(v) => (v === "chassis" ? selectChassis() : selectComponent())}
            options={[
              {
                value: "chassis",
                icon: Server,
                label: "Châssis",
                description: "Accueille des composants.",
              },
              {
                value: "component",
                icon: Cpu,
                label: "Composant",
                description: "S'insère dans un hôte.",
              },
            ]}
            readOnly={isReadOnly}
          />

          {form.isComponentHost && (
            <DisabledWrap disabled={isReadOnly}>
              <RangeInput
                min={1}
                max={40}
                step={1}
                value={form.hostSlotCount ?? 10}
                onChange={(v) => set("hostSlotCount", v)}
                label="Nombre de slots"
                unit="slots"
                editable
                showBounds
                readOnly={isReadOnly}
              />
            </DisabledWrap>
          )}

          {form.isComponent && (
            <DisabledWrap disabled={isReadOnly}>
              <RangeInput
                min={1}
                max={8}
                step={1}
                value={form.componentSlotSpan}
                onChange={(v) => set("componentSlotSpan", v)}
                label="Slots occupés"
                unit="slots"
                editable
                showBounds
                readOnly={isReadOnly}
              />
            </DisabledWrap>
          )}
        </>
      )}

      {/* Rackable / Pose libre — masqué pour un composant (pose libre forcée,
          sans format de baie propre). Mêmes cartes à icône que Châssis /
          Composant. */}
      {!form.isComponent && (
        <KindChoice
          value={form.isRackable ? "rack" : "free"}
          onChange={(v) => set("isRackable", v === "rack")}
          options={[
            {
              value: "rack",
              icon: Layers,
              label: 'Rackable 19"',
              description: "Se monte en U sur baie 19″.",
            },
            {
              value: "free",
              icon: Package,
              label: "Pose libre",
              description: "Caisson, périphérique posé.",
            },
          ]}
          readOnly={isReadOnly}
        />
      )}
    </SubBlock>
  );
}

// ── ModularToggle — interrupteur « Équipement modulaire » ────────────────

function ModularToggle({
  checked,
  onChange,
  readOnly,
}: {
  checked: boolean;
  onChange: () => void;
  readOnly?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={readOnly}
      onClick={onChange}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
        checked
          ? "border-[var(--accent)]/50 bg-[var(--accent)]/5"
          : "border-[var(--border)] bg-[var(--card)]",
        readOnly
          ? "cursor-default"
          : "hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span className="text-xs font-semibold text-[var(--foreground)]">
        Équipement modulaire
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

// ─── Colonne 3 du Hero — Images (principale + URL paste + icône + schéma) ──

function HeroImagesColumn({
  form,
  set,
  isReadOnly,
  typeId,
  types,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
  typeId?: string | null;
  types?: CatalogTypeLite[];
}) {
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [pendingCropSrc, setPendingCropSrc] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Image principale 16:9. En mode lecture pure : ImageCropUpload affiche
          un placeholder (icône centrée) si pas de valeur. */}
      <div className="relative">
        <ImageCropUpload
          value={form.imageUrl ?? ""}
          onChange={(v) => set("imageUrl", v || "")}
          folder="equipment/photos"
          label=""
          externalImageSrc={pendingCropSrc}
          onExternalCropResolved={() => setPendingCropSrc(null)}
          forceAspectRatio={16 / 9}
          readOnly={isReadOnly}
        />
        {!isReadOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUrlModalOpen(true);
            }}
            title="Importer depuis une URL"
            className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-[var(--border)]/60 bg-[var(--card)]/90 px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)] shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
          >
            <LinkIcon className="h-3 w-3" />
            URL
          </button>
        )}
      </div>

      {!isReadOnly && (
        <ImageUrlPasteModal
          open={urlModalOpen}
          onOpenChange={setUrlModalOpen}
          onResolved={(url) => {
            setPendingCropSrc(url);
            setUrlModalOpen(false);
          }}
        />
      )}

      {/* Icône + Schéma de principe côte à côte. Si l'équipement n'a pas
          d'iconUrl propre mais que son CatalogType en a une, on l'affiche
          DANS le placeholder de l'upload (image OU icône lucide) avec un
          badge "GÉNÉRIQUE" — l'utilisateur voit immédiatement ce qui sera
          rendu sur les plans tant qu'aucune image custom n'est uploadée. */}
      {(() => {
        const selectedType = typeId ? types?.find((t) => t.id === typeId) : null;
        const inheritedIconId = selectedType?.iconId ?? null;
        const inheritedSchemaUrl = selectedType?.schemaImageUrl ?? null;
        const isInheritedIconUrl = isIconUrl(inheritedIconId);
        const inheritedEntry =
          !isInheritedIconUrl && inheritedIconId ? getTypeIcon(inheritedIconId) : null;
        const InheritedIcon = inheritedEntry?.Icon ?? null;
        return (
          <div className="grid grid-cols-2 gap-3">
            <ImageCropUpload
              value={form.iconUrl ?? ""}
              onChange={(v) => set("iconUrl", v || null)}
              folder="equipment/icons"
              label="Icône"
              forceAspectRatio={1}
              readOnly={isReadOnly}
              placeholderImageUrl={isInheritedIconUrl ? inheritedIconId : null}
              placeholderNode={
                InheritedIcon ? <InheritedIcon className="h-10 w-10" /> : null
              }
              placeholderBadge={
                inheritedIconId && selectedType ? "Générique" : null
              }
            />
            <ImageCropUpload
              value={form.schemaImageUrl ?? ""}
              onChange={(v) => set("schemaImageUrl", v || null)}
              folder="equipment-schemas"
              label="Schéma de principe"
              forceAspectRatio={1}
              readOnly={isReadOnly}
              placeholderImageUrl={inheritedSchemaUrl ?? null}
              placeholderBadge={
                inheritedSchemaUrl && selectedType ? "Générique" : null
              }
            />
          </div>
        );
      })()}

      {/* Visuels rack — vues FRONT/REAR/REAR_INTERIOR/SIDE. Rendu null si l'équipement
          n'est pas rackable (PhysicalRackVisualsBlock gère sa propre garde). */}
      <PhysicalRackVisualsBlock form={form} set={set} isReadOnly={isReadOnly} />
    </div>
  );
}

// ─── ImageUrlPasteModal — saisie d'une URL distante → /api/upload/from-url ──
//
// Sortie : la prop `onResolved(url)` est invoquée avec l'URL publique locale
// (déposée dans /public/uploads/equipment/...) que le parent passe ensuite
// à ImageCropUpload via `externalImageSrc` pour ouvrir le modal de crop.

function ImageUrlPasteModal({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResolved: (url: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset à chaque ouverture
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setDraft("");
      setError(null);
      setDownloading(false);
    }
    onOpenChange(v);
  };

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDownloading(true);
    setError(null);
    try {
      const data = await api.post<{ url: string }>("/api/upload/from-url", {
        url: trimmed,
        folder: "equipment",
      });
      if (data?.url) {
        onResolved(data.url);
        setDraft("");
      } else {
        setError("Réponse invalide du serveur.");
      }
    } catch (e) {
      setError(getApiErrorMessage(e, "Téléchargement impossible depuis cette URL."));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importer depuis une URL</DialogTitle>
          <DialogDescription>
            Collez l&apos;adresse d&apos;une image distante (JPEG, PNG, WebP, GIF).
            Le fichier est téléchargé puis vous pourrez le recadrer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !downloading) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={downloading}
              placeholder="https://exemple.com/image.jpg"
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          {/* arkyo-server: habillage Strata */}
          {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={downloading}
          >
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={downloading || draft.trim().length === 0}
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {downloading ? "Téléchargement…" : "Importer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Documents — notes internes + liste {title, url} (modal upload) ──────
//
// Persistance des liens : `FormData.documents` (EquipmentDocument[]) ; le
// payload est envoyé par `equipment-editor.tsx` au champ DB `documents`.
// Les notes restent stockées sur `form.notes`.
//
// UX : un placeholder dashed cliquable ouvre `DocumentUploadModal` qui
// propose deux modes — upload PDF (POST /api/upload, folder=equipment/docs)
// ou collage d'URL externe (lien direct). À la confirmation, on append
// `{ id, title, url }` à `form.documents`.

function DocumentsSection({
  form,
  set,
  isReadOnly,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
}) {
  const docs: EquipmentDocument[] = form.documents ?? [];
  const [modalOpen, setModalOpen] = useState(false);

  const addDoc = (doc: { title: string; url: string }) => {
    if (isReadOnly) return;
    const next: EquipmentDocument = { id: uid(), title: doc.title, url: doc.url };
    set("documents", [...docs, next]);
  };

  const removeDoc = (index: number) => {
    if (isReadOnly) return;
    set(
      "documents",
      docs.filter((_, i) => i !== index),
    );
  };

  // Lecture pure : si pas de documents et pas de notes, on ne rend rien.
  // Sinon on rend uniquement ce qui existe (liste + notes), sans bouton
  // d'ajout / suppression.
  if (isReadOnly) {
    const hasNotes = form.notes && form.notes.trim().length > 0;
    if (docs.length === 0 && !hasNotes) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-1.5">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-[var(--muted-foreground)]">
              Documents
            </span>
          </div>
        </div>

        {docs.length > 0 && (
          <ul className="space-y-1.5">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] p-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-xs text-[var(--foreground)] hover:underline"
                  title={`${doc.title} — ${doc.url}`}
                >
                  {doc.title || doc.url}
                </a>
              </li>
            ))}
          </ul>
        )}

        {hasNotes && (
          <FieldBlock label="Notes internes">
            <textarea
              value={form.notes}
              readOnly
              rows={4}
              className="w-full resize-none rounded-lg border border-[var(--border)]/60 bg-transparent px-3 py-2 text-xs leading-relaxed focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
            />
          </FieldBlock>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* En-tête */}
      <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-1.5">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-[var(--muted-foreground)]">
            Documents
          </span>
        </div>
      </div>

      {/* Placeholder dashed cliquable — déclenche le modal d'upload */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-3 text-[var(--muted-foreground)]/70 transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)]/80"
      >
        <FileText className="h-4 w-4" />
        <span className="text-[11px] font-semibold tracking-wider uppercase">
          Ajouter un document
        </span>
      </button>

      <DocumentUploadModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onConfirm={(doc) => {
          addDoc(doc);
          setModalOpen(false);
        }}
      />

      {/* Liste des documents (chips compactes) */}
      {docs.length > 0 && (
        <ul className="space-y-1.5">
          {docs.map((doc, i) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] p-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs text-[var(--foreground)] hover:underline"
                title={`${doc.title} — ${doc.url}`}
              >
                {doc.title || doc.url}
              </a>
              <button
                type="button"
                onClick={() => removeDoc(i)}
                title="Retirer ce document"
                // arkyo-server: habillage Strata
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Notes internes */}
      <FieldBlock label="Notes internes">
        <FieldPresenceRing field="notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Notes internes, remarques techniques…"
            rows={4}
            className="w-full resize-none rounded-lg border border-[var(--border)]/60 bg-transparent px-3 py-2 text-xs leading-relaxed focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
          />
        </FieldPresenceRing>
      </FieldBlock>
    </div>
  );
}

// ─── DocumentUploadModal — Titre + (PDF upload | URL externe) ──────────────

type DocSourceMode = "file" | "url";

function DocumentUploadModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (doc: { title: string; url: string }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<DocSourceMode>("file");
  const [title, setTitle] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset à chaque ouverture/fermeture
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setMode("file");
      setTitle("");
      setUrlDraft("");
      setPendingFile(null);
      setUploading(false);
      setError(null);
    }
    onOpenChange(v);
  };

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type !== "application/pdf") {
      setError("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    setPendingFile(file);
    // Pré-remplit le titre avec le nom du fichier (sans extension) si vide.
    if (!title.trim()) {
      const base = file.name.replace(/\.pdf$/i, "");
      setTitle(base);
    }
  };

  const submit = async () => {
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Le titre est obligatoire.");
      return;
    }

    if (mode === "file") {
      if (!pendingFile) {
        setError("Sélectionnez un fichier PDF.");
        return;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", pendingFile);
        fd.append("folder", "equipment/docs");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !data?.url) {
          setError(data?.error ?? "Échec de l'upload.");
          return;
        }
        onConfirm({ title: trimmedTitle, url: data.url });
      } catch {
        setError("Erreur réseau lors de l'upload.");
      } finally {
        setUploading(false);
      }
      return;
    }

    // Mode URL
    const trimmedUrl = urlDraft.trim();
    if (!trimmedUrl) {
      setError("L'URL est obligatoire.");
      return;
    }
    try {
      // Validation basique côté client.
      new URL(trimmedUrl);
    } catch {
      setError("URL invalide.");
      return;
    }
    onConfirm({ title: trimmedTitle, url: trimmedUrl });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un document</DialogTitle>
          <DialogDescription>
            Téléversez un PDF (datasheet, manuel) ou collez l&apos;adresse
            d&apos;un document distant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Titre */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
              Titre <span className="text-[var(--destructive)]">*</span>
            </p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Datasheet, manuel utilisateur…"
              className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          {/* Tabs : Fichier | URL */}
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40 p-1">
            <button
              type="button"
              onClick={() => setMode("file")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                mode === "file"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              Uploader un PDF
            </button>
            <button
              type="button"
              onClick={() => setMode("url")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                mode === "url"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Coller une URL
            </button>
          </div>

          {/* Contenu selon le mode */}
          {mode === "file" ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-6 text-[var(--muted-foreground)]/70 transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)]/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-5 w-5" />
                <span className="text-xs font-semibold">
                  {pendingFile ? pendingFile.name : "Choisir un fichier PDF (max 10 Mo)"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0])}
                onClick={(e) => {
                  (e.target as HTMLInputElement).value = "";
                }}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
                URL du document
              </p>
              <div className="relative">
                <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !uploading) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="https://exemple.com/datasheet.pdf"
                  type="url"
                  className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>
            </div>
          )}

          {/* arkyo-server: habillage Strata */}
          {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={uploading}
          >
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={
              uploading ||
              title.trim().length === 0 ||
              (mode === "file" ? !pendingFile : urlDraft.trim().length === 0)
            }
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {uploading ? "Téléversement…" : "Ajouter"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── OptionCard — calqué sur OptionsStep du wizard ──────────────────────

function OptionCard({
  icon: Icon,
  title,
  description,
  active,
  disabled,
  readOnly,
  onClick,
}: {
  icon: typeof Network;
  title: string;
  description: string;
  active: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onClick: () => void;
}) {
  if (readOnly) {
    return (
      <div
        role="presentation"
        className="relative flex flex-col items-start gap-2 rounded-xl border border-[var(--border)]/40 bg-transparent p-3 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--secondary)] text-[var(--muted-foreground)]">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-xs font-semibold text-[var(--foreground)]">
            {title}
          </div>
          <div className="text-[10px] leading-snug text-[var(--muted-foreground)]">
            {description}
          </div>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-sm"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <div className="text-xs font-semibold text-[var(--foreground)]">
          {title}
        </div>
        <div className="text-[10px] leading-snug text-[var(--muted-foreground)]">
          {description}
        </div>
      </div>
      {active && (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

// ─── IpModeSelector — toggle OOB / IB calqué sur le wizard ──────────────

const IP_MODE_OPTIONS: {
  value: "OOB" | "IB";
  label: string;
  description: string;
}[] = [
  {
    value: "OOB",
    label: "Out Of Band",
    description: "Management séparé du réseau media.",
  },
  {
    value: "IB",
    label: "In Band",
    description: "Management embarqué dans le réseau media.",
  },
];

function IpModeSelector({
  value,
  onChange,
  disabled,
  readOnly,
}: {
  value: "OOB" | "IB" | null;
  onChange: (v: "OOB" | "IB") => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  // En mode lecture pure, on n'affiche que l'option active (s'il y en a une).
  if (readOnly) {
    if (!value) return null;
    const opt = IP_MODE_OPTIONS.find((o) => o.value === value);
    if (!opt) return null;
    return (
      <div className="grid grid-cols-1 gap-2">
        <div
          role="presentation"
          className="flex flex-col items-start gap-0.5 rounded-lg border border-[var(--border)]/40 bg-transparent px-3 py-2 text-left text-xs text-[var(--foreground)]"
        >
          <span className="font-semibold">{opt.label}</span>
          <span className="text-[10px] leading-tight text-[var(--muted-foreground)]">
            {opt.description}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {IP_MODE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-xs transition-all",
              active
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="font-semibold">{opt.label}</span>
            <span className="text-[10px] leading-tight opacity-80">
              {opt.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Helpers UI ──────────────────────────────────────────────────────────

// Chip de sélection d'un sous-type — teintée avec la couleur de la fonction
// quand active (cohérent avec les cards du TypePickerModal).
function SubTypeChip({
  label,
  active,
  color,
  personal,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  personal?: boolean;
  onClick: () => void;
}) {
  const c = color ?? "var(--accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
        !active &&
          "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
      )}
      style={active ? { borderColor: c, backgroundColor: `${c}15`, color: c } : undefined}
    >
      {personal && <PersonalTypeDot />}
      {label}
    </button>
  );
}

function SubBlockTitle({ title }: { title: string }) {
  return (
    <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]/80">
      {title}
    </p>
  );
}

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
      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
        {label}
        {required && <span className="ml-1 text-[var(--destructive)]">*</span>}
      </p>
      {children}
    </div>
  );
}

