"use client";

// Sous-bloc "Caractéristiques techniques" du tab "Généralités".
//
// Refonte 2026-05-23 (v7) : les sub-blocs sémantiques sont désormais exportés
// individuellement pour permettre à general-tab.tsx de les répartir dans le
// Hero (Dimensions + Poids & énergie en col 2) et de garder uniquement les
// Visuels rack sous le Hero (pleine largeur). `PhysicalTab` reste exporté
// comme wrapper backward-compatible — il compose les 3 blocs comme avant.
//
// Blocs exportés :
//   - PhysicalDimensionsBlock  : largeur (chips) + hauteur U + profondeur
//                                 OU L/W/H (si pose libre)
//   - PhysicalPowerBlock       : poids + puissance + dissipation (auto-fill
//                                 depuis la puissance)
//   - PhysicalRackVisualsBlock : grid 4 colonnes — symboles + photos rack
//
// Chaque sub-bloc a un mini-titre uppercase + contenu en `space-y-3` séparé
// par une bordure légère (border/40 rounded-xl) pour la cohérence visuelle.

import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { ImageCropUpload } from "@/components/ui/image-crop-upload";
import { RangeInput } from "@/components/wizard/range-input";
import { FieldPresenceRing } from "@/components/presence/field-presence-ring";
import { WidthGlyph } from "@/components/equipment/format-block";
import { FormData } from "./types";
import { CustomFieldsBlock } from "./custom-fields";

// Ré-export pour compat : la fiche importe WidthGlyph depuis physical-tab.
export { WidthGlyph } from "@/components/equipment/format-block";

// ── Ratio rack imposé pour le crop des visuels (symboles + photos rack) :
// calculé exactement comme `rackAspect()` dans `image-crop-upload.tsx`
// (largeur 19" × fraction / (heightU × hauteur 1U)). Constantes partagées
// par PhysicalRackVisualsBlock — exposées pour qu'un autre consommateur
// puisse calculer le même ratio sans dupliquer.
const RACK_WIDTH_MM = 482.6;
const U_HEIGHT_MM = 44.45;
const WF_FRACTION: Record<string, number> = {
  FULL: 1,
  HALF: 0.5,
  THIRD: 1 / 3,
  QUARTER: 0.25,
};

// ─── PhysicalDimensionsBlock ─────────────────────────────────────────────
//
// Largeur (si rackable) + Hauteur U + Profondeur, OU L/W/H si pose libre.

export function PhysicalDimensionsBlock({
  form,
  set,
  isReadOnly,
  catColor,
  cableSafetyDefaultMm = 150,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  /** Lecture pure : valeurs visibles à plein contraste, pas de slider, pas de
   *  bornes. Pour la largeur (rackable), on n'affiche QUE la card sélectionnée. */
  isReadOnly?: boolean;
  catColor: string;
  /** Valeur globale « Sécurité câblage » (Admin > Paramètres > Dimensions).
   *  Affichée par défaut sur le champ override ; y revenir = hériter (`null`). */
  cableSafetyDefaultMm?: number;
}) {
  void catColor;

  // Largeur en vocabulaire 19" : cartes grid 4 colonnes avec illustration
  // façade de baie (rails + oreilles + portion occupée). Cohérent avec le
  // badge du cropper (« Format imposé 19" · 2U »).
  //  - Hauteur : juste le RangeInput curseur, pas de chips U prédéfinies
  const WIDTH_CARDS: { value: FormData["widthFraction"]; label: string }[] = [
    { value: "FULL", label: '19"' },
    { value: "HALF", label: '½ · 19"' },
    { value: "THIRD", label: '⅓ · 19"' },
    { value: "QUARTER", label: '¼ · 19"' },
  ];

  return (
    <SubBlock title="Dimensions">
      {form.isRackable ? (
        <>
          {/* Largeur — cartes 4 colonnes (pattern wizard) */}
          <div className="space-y-1.5">
            <FieldLabel label="Largeur" />
            {isReadOnly ? (
              <div className="grid grid-cols-1 gap-1.5">
                {(() => {
                  const wf =
                    WIDTH_CARDS.find((w) => w.value === form.widthFraction) ??
                    WIDTH_CARDS[0];
                  return (
                    <div
                      key={wf.value}
                      role="presentation"
                      className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border)]/40 bg-transparent px-2 text-[11px] font-bold text-[var(--foreground)]"
                    >
                      <WidthGlyph fraction={wf.value} />
                      <span>{wf.label}</span>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {WIDTH_CARDS.map((wf) => {
                  const active = form.widthFraction === wf.value;
                  return (
                    <button
                      key={wf.value}
                      type="button"
                      onClick={() => set("widthFraction", wf.value)}
                      className={cn(
                        "flex h-16 flex-col items-center justify-center gap-1 rounded-lg border-2 px-1 text-[11px] font-bold transition-all",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                      )}
                    >
                      <WidthGlyph fraction={wf.value} />
                      <span>{wf.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hauteur — curseur uniquement (pas de U prédéfinis) */}
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={1}
              max={48}
              step={1}
              value={form.heightU ?? 1}
              onChange={(v) => set("heightU", v)}
              label="Hauteur"
              unit="U"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>

          {/* Profondeur (mm) */}
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={0}
              max={1200}
              step={50}
              value={form.depthMm ?? 0}
              onChange={(v) => set("depthMm", v === 0 ? null : v)}
              label="Profondeur"
              unit="mm"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>

          {/* Réserve câblage arrière (override). Par défaut = valeur globale
              « Sécurité câblage » (Admin > Paramètres > Dimensions) ; y revenir
              = hériter (stocké `null`). Ne s'affiche en baie que si l'équipement
              a des connecteurs arrière. */}
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={0}
              max={600}
              step={10}
              value={form.rearCableDepthMm ?? cableSafetyDefaultMm}
              onChange={(v) =>
                set("rearCableDepthMm", v === cableSafetyDefaultMm ? null : v)
              }
              label="Sécurité câbles arrière"
              unit="mm"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>
        </>
      ) : (
        <>
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={0}
              max={2000}
              step={10}
              value={form.dimLmm ?? 0}
              onChange={(v) => set("dimLmm", v === 0 ? null : v)}
              label="Longueur"
              unit="mm"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={0}
              max={2000}
              step={10}
              value={form.dimWmm ?? 0}
              onChange={(v) => set("dimWmm", v === 0 ? null : v)}
              label="Largeur"
              unit="mm"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>
          <DisabledWrap disabled={isReadOnly}>
            <RangeInput
              min={0}
              max={2000}
              step={10}
              value={form.dimHmm ?? 0}
              onChange={(v) => set("dimHmm", v === 0 ? null : v)}
              label="Hauteur"
              unit="mm"
              editable
              showBounds
              readOnly={isReadOnly}
            />
          </DisabledWrap>
        </>
      )}
    </SubBlock>
  );
}

// ─── PhysicalPowerBlock ──────────────────────────────────────────────────
//
// Poids + puissance + dissipation. La dissipation est auto-calculée depuis
// la puissance (1 W ≈ 3,412 BTU/h) — calqué EXACTEMENT sur HeatStep du
// wizard. À chaque changement de `powerW`, on aligne `heatBtuH` sur la
// valeur estimée. La valeur reste éditable, mais sera ré-écrasée au
// prochain changement de puissance.

export function PhysicalPowerBlock({
  form,
  set,
  isReadOnly,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  isReadOnly?: boolean;
}) {
  const powerW = form.powerW ?? 0;
  const computedHeatFromPower = powerW > 0 ? Math.round(powerW * 3.412) : null;
  useEffect(() => {
    if (isReadOnly) return;
    if (computedHeatFromPower === null) return;
    set("heatBtuH", computedHeatFromPower);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedHeatFromPower]);

  return (
    <SubBlock title="Poids & énergie">
      <FieldPresenceRing field="weight">
        <DisabledWrap disabled={isReadOnly}>
          <RangeInput
            min={0}
            max={200}
            step={0.5}
            value={form.weight ?? 0}
            onChange={(v) => set("weight", v === 0 ? null : v)}
            label="Poids"
            unit="kg"
            editable
            showBounds
            readOnly={isReadOnly}
          />
        </DisabledWrap>
      </FieldPresenceRing>
      <FieldPresenceRing field="power">
        <DisabledWrap disabled={isReadOnly}>
          <RangeInput
            min={0}
            max={5000}
            step={10}
            value={form.powerW ?? 0}
            onChange={(v) => set("powerW", v === 0 ? null : v)}
            label="Puissance"
            unit="W"
            editable
            showBounds
            readOnly={isReadOnly}
          />
        </DisabledWrap>
      </FieldPresenceRing>
      <DisabledWrap disabled={isReadOnly}>
        <RangeInput
          min={0}
          max={15000}
          step={100}
          value={form.heatBtuH ?? 0}
          onChange={(v) => set("heatBtuH", v === 0 ? null : v)}
          label="Dissipation"
          unit="BTU/h"
          editable
          showBounds
          readOnly={isReadOnly}
        />
        {!isReadOnly && computedHeatFromPower !== null && (
          <p className="mt-1 text-[10px] leading-snug text-[var(--muted-foreground)]/80">
            Estimée depuis la puissance ({powerW} W × 3,412). Modifiable.
          </p>
        )}
      </DisabledWrap>
    </SubBlock>
  );
}

// ─── PhysicalRackVisualsBlock ────────────────────────────────────────────
//
// Visuels rack (symboles + photos, avant + arrière). Rendu uniquement si
// rackable + heightU défini — le consommateur peut tester `showRackVisuals`
// via les props pour décider du rendu.

export function PhysicalRackVisualsBlock({
  form,
  set,
  isReadOnly,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  /** Lecture pure : on n'affiche que les visuels présents, sans tuile vide. */
  isReadOnly?: boolean;
}) {
  const rackShape = form.heightU
    ? { heightU: form.heightU, widthFraction: form.widthFraction }
    : undefined;

  const rackForceRatio = form.heightU
    ? (RACK_WIDTH_MM * (WF_FRACTION[form.widthFraction] ?? 1)) /
      (form.heightU * U_HEIGHT_MM)
    : undefined;

  const showRackVisuals = form.isRackable && !!form.heightU;
  if (!showRackVisuals) return null;

  // Les 4 visuels rack sont TOUJOURS rendus. En mode lecture pure, les tuiles
  // sans image affichent un placeholder (icône centrée) — pas de skip.
  type RackVisualKey =
    | "rackSymbolUrl"
    | "rackSymbolRearUrl"
    | "rackPhotoFrontUrl"
    | "rackPhotoRearUrl";
  const visuals: { key: RackVisualKey; label: string; hint: string; folder: string }[] = [
    { key: "rackSymbolUrl", label: "Symbole — avant", hint: "Vecto synoptique.", folder: "equipment/symbols" },
    { key: "rackSymbolRearUrl", label: "Symbole — arrière", hint: "Vecto synoptique.", folder: "equipment/symbols" },
    { key: "rackPhotoFrontUrl", label: "Photo — avant", hint: "Photo réelle U.", folder: "equipment/photos" },
    { key: "rackPhotoRearUrl", label: "Photo — arrière", hint: "Photo réelle U.", folder: "equipment/photos" },
  ];

  return (
    <SubBlock title="Visuels rack">
      <div className="flex flex-col gap-3">
        {visuals.map((v) => (
          <ImageTile key={v.key} label={v.label} hint={v.hint}>
            <ImageCropUpload
              value={(form[v.key] ?? "") as string}
              onChange={(val) => set(v.key, val as FormData[RackVisualKey])}
              folder={v.folder}
              label=""
              rackShape={rackShape}
              forceAspectRatio={rackForceRatio}
              className="!w-full"
              readOnly={isReadOnly}
            />
          </ImageTile>
        ))}
      </div>
    </SubBlock>
  );
}

// ─── PhysicalTab — wrapper backward-compatible ───────────────────────────
//
// Compose les 3 blocs comme avant (dimensions + énergie en ligne 1, visuels
// rack en ligne 2, champs personnalisés en ligne 3). Conservé pour ne rien
// casser ; general-tab.tsx utilise maintenant les blocs individuellement.

export function PhysicalTab({
  form,
  set,
  catColor,
  uHeights,
  showCustomFields = false,
}: {
  form: FormData;
  set: <K extends keyof FormData>(key: K, val: FormData[K]) => void;
  catColor: string;
  uHeights: number[];
  showCustomFields?: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* ── Ligne 1 : Dimensions | Poids & énergie ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PhysicalDimensionsBlock
          form={form}
          set={set}
          catColor={catColor}
        />
        <PhysicalPowerBlock form={form} set={set} />
      </div>

      {/* ── Ligne 2 : Visuels rack (si rackable + heightU défini) ────── */}
      <PhysicalRackVisualsBlock form={form} set={set} />

      {/* ── Champs personnalisés (Supervisor uniquement) ──────────────── */}
      {showCustomFields && (
        <CustomFieldsBlock
          fields={form.customFields}
          onChange={(next) => set("customFields", next)}
          catColor={catColor}
        />
      )}
    </div>
  );
}

// ── SubBlock — conteneur sémantique (titre uppercase + contenu encadré) ──

export function SubBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)]/40 bg-[var(--card)]/30 p-4">
      <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]/80">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ── Label uniforme — pattern compact (10px uppercase fin) ────────────────

function FieldLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
      {label}
    </p>
  );
}

// ── DisabledWrap — désactive un sous-arbre quand `disabled` ────────────
//
// Comme `RangeInput` n'expose pas de prop `disabled` (composant partagé
// wizard), on intercepte les events et grise le sous-arbre via classes.

export function DisabledWrap({
  disabled,
  children,
}: {
  disabled?: boolean;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  return (
    <div
      className="pointer-events-none cursor-not-allowed opacity-50"
      aria-disabled="true"
    >
      {children}
    </div>
  );
}

// ── ImageTile — petit conteneur uniforme (libellé + slot upload) ───────

function ImageTile({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
          {label}
        </p>
        {hint && (
          <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted-foreground)]/70">
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
