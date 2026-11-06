"use client";

import React from "react";

import type { Equipment, Slot } from "@/components/synoptique/lib/types";

/**
 * Image ARRIÈRE (dos) d'un équipement pour le mode image courant.
 *  - "graphic" → symbole vecto arrière (`rackSymbolRearUrl`)
 *  - "photo"   → photo arrière (`rackPhotoRearUrl`)
 *  - "standard"→ jamais (pas de projection)
 * Retourne `null` si l'équipement n'a pas d'image de dos pour ce mode : dans ce
 * cas la projection n'est PAS rendue (repli sans placeholder).
 */
export function rearImageForMode(
  eq: Equipment | null,
  renderMode: "standard" | "graphic" | "photo",
): string | null {
  if (!eq || renderMode === "standard") return null;
  if (renderMode === "graphic") return eq.rackSymbolRearUrl ?? null;
  return eq.rackPhotoRearUrl ?? null;
}

/**
 * Projection en LECTURE SEULE du dos d'un équipement monté à l'AVANT, affichée
 * dans la vue ARRIÈRE en mode image. Purement visuelle :
 *  - `pointer-events-none` sur toute la boîte → aucun drag, aucune sélection,
 *    aucun menu contextuel, n'intercepte jamais les DroppableCell ni les vrais
 *    slots arrière.
 *  - estompée (opacité réduite) + badge « dos » discret.
 *
 * Ne réutilise pas `DraggableSlot` (qui embarque drag/shelf/sélection) : ici on
 * ne veut QUE l'image arrière, sans aucune interactivité.
 */
export function ProjectedSlot({
  slot,
  renderMode,
}: {
  slot: Slot;
  renderMode: "standard" | "graphic" | "photo";
}) {
  const imageUrl = rearImageForMode(slot.equipment, renderMode);
  if (!imageUrl) return null;

  return (
    <div
      className="pointer-events-none relative h-full w-full"
      aria-hidden="true"
      style={{ opacity: 0.45 }}
    >
      {/* Même géométrie que le visuel de DraggableSlot : la boîte est au
          ratio de crop hors-tout ; on compense seulement l'inset vertical
          ±1px (pas de bordure ici) pour toucher les séparations de U. */}
      <div className="absolute inset-x-0" style={{ top: -1, bottom: -1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-fill"
          draggable={false}
        />
      </div>
      {/* Badge « dos » discret — coin haut-gauche, style sobre (mono, muted). */}
      <span
        className="absolute top-0.5 left-0.5 rounded-sm border border-[var(--border)] bg-[var(--card)]/80 px-1 text-[7px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase backdrop-blur-sm"
        style={{ lineHeight: "12px" }}
      >
        dos
      </span>
    </div>
  );
}
