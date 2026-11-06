"use client";

import React from "react";
import {
  AlertTriangle,
  MapPin,
  Package,
  Ruler,
  Server,
  Tag,
  Trash2,
  Weight,
  Zap,
} from "@/components/ui/icons";

import { PLAQUE_STYLES, WIDTH_CONFIG } from "@/components/synoptique/lib/constants";
import { useCategoryColor } from "@/components/synoptique/lib/colors";
import type { AccessoryType, Slot } from "@/components/synoptique/lib/types";
import { SectionTitle, InfoCard, ActionButton } from "./property-patterns";
import { NameInput } from "./synoptic-general-panel";
import { apiFetch } from "@/lib/client-id";

export type ConnectorTypeDef = {
  id: string;
  name: string;
  version: string | null;
  iconId: string;
  color: string;
  category: string;
};

type ConnectorEntry = {
  face?: string;
  connectorTypeId?: string;
  quantity?: number;
  label?: string;
  direction?: string;
  signalName?: string;
};

export function SlotPropertiesPanel({
  slot,
  rackId,
  allSlots,
  onClose,
  onUpdate,
  connectorTypes = [],
  onOpenLabelling,
  onRemove,
  rackDepthMm,
  cableSafetyDepthMm,
}: {
  slot: Slot;
  rackId: string;
  allSlots: Slot[];
  onClose: () => void;
  onUpdate: (updated: Slot) => void;
  connectorTypes?: ConnectorTypeDef[];
  onOpenLabelling?: () => void;
  /** Retire l'élément de la baie (confirm + DELETE géré par l'appelant). */
  onRemove?: () => void;
  /** Profondeur du contenant — pour détecter un dépassement profondeur. */
  rackDepthMm?: number | null;
  /** Marge de sécurité câbles (mm) — incluse dans le check de dépassement. */
  cableSafetyDepthMm?: number;
}) {
  // Détection accessoire : pas d'équipement, pas de panel, mais notes JSON
  // valide avec `accessoryType`. Sert à afficher un panneau de propriétés
  // dédié (Hauteur + Profondeur éditables) au lieu du panneau équipement vide.
  const accessoryMeta = React.useMemo<{
    type: AccessoryType;
    style?: string;
    depthMm?: number;
  } | null>(() => {
    if (slot.equipment || slot.panel) return null;
    if (typeof slot.notes !== "string" || slot.notes.length === 0) return null;
    try {
      const parsed = JSON.parse(slot.notes);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed.accessoryType === "plaque" ||
          parsed.accessoryType === "etagere" ||
          parsed.accessoryType === "tiroir")
      ) {
        return {
          type: parsed.accessoryType as AccessoryType,
          style: typeof parsed.style === "string" ? parsed.style : undefined,
          depthMm:
            typeof parsed.depthMm === "number" && Number.isFinite(parsed.depthMm)
              ? parsed.depthMm
              : undefined,
        };
      }
    } catch {
      /* notes non-JSON */
    }
    return null;
  }, [slot.notes, slot.equipment, slot.panel]);

  const accessoryLabel = accessoryMeta
    ? accessoryMeta.type === "plaque"
      ? "Plaque"
      : accessoryMeta.type === "etagere"
        ? "Étagère"
        : "Tiroir"
    : null;

  const category = slot.panel
    ? "Panels de patch"
    : (slot.equipment?.category ?? (accessoryLabel ? "Accessoire rack" : undefined));
  const hex = useCategoryColor(category);
  const eq = slot.equipment;
  const eqName = slot.panel?.name ?? eq?.name ?? accessoryLabel ?? "—";
  const brandName = (eq as unknown as { brand?: { name?: string } } | null)?.brand?.name ?? null;
  const imageUrl = eq?.imageUrl ?? null;
  const ctMap = Object.fromEntries(connectorTypes.map((c) => [c.id, c]));

  const handleLabelChange = async (label: string) => {
    const conflict = label && allSlots.some((s) => s.id !== slot.id && s.label === label);
    if (conflict) return;
    const res = await apiFetch(`/api/racks/${rackId}/slots/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || null }),
    });
    if (res.ok) onUpdate({ ...slot, label: label || null });
  };


  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* Image */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="border-border bg-muted/30 h-24 w-full rounded-md border object-contain"
        />
      )}

      {/* Identité */}
      <div>
        <SectionTitle>
          {slot.panel ? "Panel de patch" : (accessoryLabel ?? "Équipement")}
        </SectionTitle>
        <NameInput rackName={slot.label ?? ""} onRackNameChange={handleLabelChange} />
        {(brandName || eqName) && !accessoryLabel && (
          <div className="text-muted-foreground text-[11px]">
            {[brandName, eqName].filter(Boolean).join(" · ")}
          </div>
        )}
        {accessoryMeta?.type === "plaque" && accessoryMeta.style && (
          <div className="text-muted-foreground text-[11px]">
            {PLAQUE_STYLES.find((s) => s.id === accessoryMeta.style)?.label ?? accessoryMeta.style}
          </div>
        )}
        {eq?.reference && (
          <div
            className="text-muted-foreground mt-0.5 text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {eq.reference}
          </div>
        )}
        {category && (
          <span
            className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
            style={{ background: `${hex}18`, color: hex }}
          >
            {category}
          </span>
        )}
      </div>

      {/* Connecteurs — groupés IN / OUT comme le synoptique */}
      {eq &&
        (() => {
          const entries: ConnectorEntry[] = Array.isArray(eq.connectors)
            ? (eq.connectors as ConnectorEntry[])
            : [];
          if (!entries.length) return null;

          type ChipData = {
            name: string;
            color: string;
            direction: string | null;
            signalName: string | null;
            count: number;
          };
          const chips: ChipData[] = [];
          for (const e of entries) {
            const ct = e.connectorTypeId ? ctMap[e.connectorTypeId] : null;
            const name = ct ? `${ct.name}${ct.version ? ` ${ct.version}` : ""}` : (e.label ?? "—");
            const color = ct?.color ?? "#71717a";
            const dir = e.direction?.toUpperCase() ?? null;
            chips.push({
              name,
              color,
              direction: dir,
              signalName: e.signalName ?? null,
              count: e.quantity ?? 1,
            });
          }
          const ins = chips.filter((c) => c.direction === "IN");
          const outs = chips.filter((c) => c.direction !== "IN");
          const total = chips.reduce((s, c) => s + c.count, 0);

          const renderChip = (c: ChipData, i: number) => {
            const dirLabel =
              c.direction === "IN"
                ? "IN"
                : c.direction === "OUT"
                  ? "OUT"
                  : c.direction === "BIDIR" || c.direction === "BOTH"
                    ? "BIDI"
                    : null;
            return (
              <span
                key={i}
                className="border-border bg-card inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]"
                title={[c.signalName, c.name, dirLabel].filter(Boolean).join(" · ")}
              >
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.color }} />
                <span className="font-medium">{c.name}</span>
                {dirLabel && <span className="text-muted-foreground text-[9px]">{dirLabel}</span>}
                <span className="text-muted-foreground font-mono text-[9px]">×{c.count}</span>
              </span>
            );
          };

          return (
            <div>
              <SectionTitle>Connecteurs ({total})</SectionTitle>
              <div className="flex gap-3">
                {ins.length > 0 && (
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="text-muted-foreground text-[9px] tracking-wider uppercase">
                      In
                    </div>
                    {ins.map(renderChip)}
                  </div>
                )}
                {outs.length > 0 && (
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="text-muted-foreground text-[9px] tracking-wider uppercase">
                      Out / Bidi
                    </div>
                    {outs.map(renderChip)}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Panel connecteurs */}
      {slot.panel && (
        <div>
          <SectionTitle>Panel</SectionTitle>
          <div className="flex gap-2">
            <InfoCard
              icon={<Server className="h-4 w-4" />}
              label="Hauteur"
              value={`${slot.panel.heightU}U`}
              className="flex-1"
            />
            <InfoCard
              icon={<Package className="h-4 w-4" />}
              label="Ports"
              value={slot.panel.heightU * slot.panel.slotsPerU}
              className="flex-1"
            />
          </div>
        </div>
      )}

      {/* InfoCards */}
      {eq &&
        (() => {
          const viewLabel =
            slot.view === "FRONT"
              ? "Avant"
              : slot.view === "REAR"
                ? "Arrière"
                : slot.view === "REAR_INTERIOR"
                  ? "Arr. intérieur"
                  : "Côté";
          const slotH = slot.heightU ?? 1;
          const slotStart = slot.startU;
          const posLabel =
            slotStart != null
              ? slotH > 1
                ? `${slotStart}U – ${slotStart + slotH - 1}U`
                : `${slotStart}U`
              : "Non placé";
          return (
            <div className="grid grid-cols-2 gap-2">
              {eq.weight != null && eq.weight > 0 && (
                <InfoCard
                  icon={<Weight className="h-4 w-4" />}
                  label="Poids"
                  value={`${eq.weight} kg`}
                />
              )}
              {eq.powerW != null && eq.powerW > 0 && (
                <InfoCard
                  icon={<Zap className="h-4 w-4" />}
                  label="Conso"
                  value={`${eq.powerW} W`}
                />
              )}
              {eq.heightU != null && eq.heightU > 0 && (
                <InfoCard
                  icon={<Server className="h-4 w-4" />}
                  label="Hauteur"
                  value={`${eq.heightU}U`}
                />
              )}
              <InfoCard
                icon={<Package className="h-4 w-4" />}
                label="Largeur"
                value={WIDTH_CONFIG[slot.widthFraction].label}
              />
              {eq.depthMm != null && eq.depthMm > 0 && (
                <InfoCard
                  icon={<Ruler className="h-4 w-4" />}
                  label="Profondeur"
                  value={`${eq.depthMm}mm`}
                />
              )}
              <InfoCard
                icon={<MapPin className="h-4 w-4" />}
                label="Emplacement"
                value={viewLabel}
              />
              <InfoCard icon={<Server className="h-4 w-4" />} label="Position" value={posLabel} />
            </div>
          );
        })()}

      {/* Avertissement profondeur — non bloquant, juste informatif. Affiché
          quand l'équipement (+ marge sécurité câbles) dépasse la profondeur
          utile du contenant. Le placement est autorisé mais l'utilisateur
          doit savoir que les câbles risquent d'être pincés. */}
      {eq &&
        eq.depthMm != null &&
        eq.depthMm > 0 &&
        rackDepthMm != null &&
        rackDepthMm > 0 &&
        (() => {
          const safety = cableSafetyDepthMm ?? 0;
          const usable = Math.max(0, rackDepthMm - safety);
          if (eq.depthMm! <= usable) return null;
          const total = eq.depthMm! + safety;
          const overflow = total - rackDepthMm;
          return (
            // arkyo-server: habillage Strata (alerte : --warning, --warning-text)
            <div className="border-border/60 bg-[var(--warning)]/5 dark:bg-[var(--warning)]/10 flex gap-2 rounded-md border border-[var(--warning)]/30 p-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              <div className="flex flex-col gap-1 text-[10px] leading-snug">
                <p className="text-foreground font-medium">
                  Profondeur dépassée
                </p>
                <p className="text-muted-foreground">
                  L&apos;équipement mesure{" "}
                  <strong className="text-foreground">{eq.depthMm} mm</strong>
                  {safety > 0 && (
                    <>
                      {" "}+ <strong className="text-foreground">{safety} mm</strong> de
                      sécurité câbles
                    </>
                  )}{" "}
                  ={" "}
                  <strong className="text-foreground">{total} mm</strong>, soit{" "}
                  {/* arkyo-server: habillage Strata (alerte : --warning-text) */}
                  <strong className="text-[var(--warning-text)]">
                    +{overflow} mm
                  </strong>{" "}
                  au-delà du contenant ({rackDepthMm} mm).
                </p>
              </div>
            </div>
          );
        })()}

      {/* InfoCards Hauteur / Profondeur / Emplacement / Position pour accessoires (read-only) */}
      {accessoryMeta &&
        (() => {
          const viewLabel =
            slot.view === "FRONT"
              ? "Avant"
              : slot.view === "REAR"
                ? "Arrière"
                : slot.view === "REAR_INTERIOR"
                  ? "Arr. intérieur"
                  : "Côté";
          const slotH2 = slot.heightU ?? 1;
          const slotStart2 = slot.startU;
          const posLabel =
            slotStart2 != null
              ? slotH2 > 1
                ? `${slotStart2}U – ${slotStart2 + slotH2 - 1}U`
                : `${slotStart2}U`
              : "Non placé";
          const hasDepth =
            accessoryMeta.type !== "plaque" &&
            accessoryMeta.depthMm != null &&
            accessoryMeta.depthMm > 0;
          return (
            <div className="grid grid-cols-2 gap-2">
              <InfoCard
                icon={<Server className="h-4 w-4" />}
                label="Hauteur"
                value={`${slot.heightU ?? 1}U`}
              />
              {hasDepth && (
                <InfoCard
                  icon={<Ruler className="h-4 w-4" />}
                  label="Profondeur"
                  value={`${accessoryMeta.depthMm}mm`}
                />
              )}
              <InfoCard
                icon={<MapPin className="h-4 w-4" />}
                label="Emplacement"
                value={viewLabel}
              />
              <InfoCard icon={<Server className="h-4 w-4" />} label="Position" value={posLabel} />
            </div>
          );
        })()}

      {/* Actions */}
      <div className="border-border flex flex-col gap-1.5 border-t pt-2">
        <SectionTitle>Actions</SectionTitle>
        {slot.panel && onOpenLabelling && (
          <ActionButton
            icon={<Tag className="h-3.5 w-3.5" />}
            label="Étiquetage des ports"
            onClick={onOpenLabelling}
          />
        )}
        {onRemove && (
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Retirer de la baie"
            onClick={onRemove}
            danger
          />
        )}
      </div>
    </div>
  );
}
