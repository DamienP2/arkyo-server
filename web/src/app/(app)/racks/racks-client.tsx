"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Plus,
  Zap,
  Weight,
  Trash2,
  Loader2,
  Container,
  AlertTriangle,
  Settings,
  SlidersHorizontal,
  X,
  Search,
} from "@/components/ui/icons";
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
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { IfTenantPerm } from "@/components/ui/tenant-perm-button";
import { api, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { NewRackWizard } from "@/components/racks/new-rack-wizard";
import { AdminListToolbar } from "@/app/(app)/admin/_components/admin-list-toolbar";
import {
  ActiveFilterPills,
  Chip,
  type ActivePill,
} from "@/app/(app)/admin/_components/list-toolbar-helpers";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

// ── Types ──────────────────────────────────────────────────────────────────

type RackType = "STANDARD" | "FLIGHT_CASE_CLASSIC" | "FLIGHT_CASE_SKB" | "PELICAN" | "CAP";

type Slot = {
  id: string;
  view: string;
  startU: number;
  heightU: number;
  label: string | null;
  notes: string | null;
  equipment: Equipment | null;
};
type RigRef = { id: string; rigConfig: { id: string; name: string } };
type Rack = {
  id: string;
  name: string;
  totalU: number;
  depthMm: number;
  maxWeightKg: number | null;
  maxPowerW: number | null;
  emptyWeightKg: number | null;
  rearInteriorGapMm: number | null;
  notes: string | null;
  rackType: RackType;
  hasWheels: boolean;
  createdAt: Date;
  updatedAt: Date;
  slots: Slot[];
  rigs: RigRef[];
};

// ── Rack Type SVGs ─────────────────────────────────────────────────────────
// Style : contours isométriques 3/4, capot ouvert pour les flight cases

function RackTypeSvg({
  type,
  hasWheels,
  size = 80,
}: {
  type: RackType;
  hasWheels?: boolean;
  size?: number;
}) {
  // viewBox fixe 100×84 — tous les types utilisent ce repère
  const VW = 100,
    VH = 84;
  const sw = size;
  const sh = Math.round((size * VH) / VW);
  // Attributs stroke-only (pas de fill, hérité du parent fill="none")
  const lc = "round" as const;
  const S = (w: number, op = 1) =>
    ({
      stroke: "currentColor",
      strokeWidth: w,
      strokeLinecap: lc,
      strokeLinejoin: lc,
      strokeOpacity: op,
    }) as const;
  // Attributs fill-only
  const F = (op: number) => ({ fill: "currentColor", fillOpacity: op }) as const;
  // Attributs mixtes (fill + stroke)
  const FS = (fop: number, sw2: number, sop = 1) =>
    ({
      fill: "currentColor",
      fillOpacity: fop,
      stroke: "currentColor",
      strokeWidth: sw2,
      strokeOpacity: sop,
      strokeLinecap: lc,
      strokeLinejoin: lc,
    }) as const;

  if (type === "STANDARD") {
    // Vue de face — baie ouverte 19"
    // Châssis : montants latéraux + perforations + slots rack
    return (
      <svg width={sw} height={sh} viewBox={`0 0 ${VW} ${VH}`} fill="none">
        {/* Corps extérieur */}
        <rect x={2} y={2} width={96} height={80} rx={2} {...S(1.8)} />
        {/* Montant gauche */}
        <rect x={2} y={2} width={12} height={80} rx={1} {...F(0.1)} />
        <rect x={2} y={2} width={12} height={80} rx={1} {...S(1.2)} />
        {/* Montant droit */}
        <rect x={86} y={2} width={12} height={80} rx={1} {...F(0.1)} />
        <rect x={86} y={2} width={12} height={80} rx={1} {...S(1.2)} />
        {/* Perforations montant gauche */}
        {[12, 22, 32, 42, 52, 62].map((y) => (
          <rect key={y} x={5} y={y} width={6} height={8} rx={1.5} {...F(0.35)} />
        ))}
        {/* Perforations montant droit */}
        {[12, 22, 32, 42, 52, 62].map((y) => (
          <rect key={y} x={89} y={y} width={6} height={8} rx={1.5} {...F(0.35)} />
        ))}
        {/* Rails de fixation (ligne intérieure) */}
        <line x1={14} y1={2} x2={14} y2={82} {...S(0.8, 0.3)} />
        <line x1={86} y1={2} x2={86} y2={82} {...S(0.8, 0.3)} />
        {/* Slots rack simulés */}
        {[10, 24, 36, 50, 62].map((y) => (
          <g key={y}>
            <rect x={16} y={y} width={68} height={10} rx={1} {...F(0.06)} />
            <rect x={16} y={y} width={68} height={10} rx={1} {...S(0.8, 0.25)} />
          </g>
        ))}
      </svg>
    );
  }

  if (type === "FLIGHT_CASE_CLASSIC") {
    // Vue 3/4 isométrique, capot ouvert vers l'arrière
    // Vecteur profondeur : dx=+16, dy=-9
    const DX = 16,
      DY = 9;
    // Face avant du corps
    const bx1 = 4,
      by1 = 46,
      bx2 = 70,
      by2 = 82;
    // Face droite
    const rx1 = bx2,
      ry1 = by1,
      rx2 = bx2 + DX,
      ry2 = by1 - DY,
      rx3 = bx2 + DX,
      ry3 = by2 - DY;
    // Face supérieure (ouverture vue de dessus)
    const tx1 = bx1 + DX,
      ty1 = by1 - DY; // arrière-gauche
    const tx2 = bx2 + DX,
      ty2 = by1 - DY; // arrière-droit (= rx2,ry2)
    // Capot ouvert (charnière arrière, pivote vers le haut)
    const lhinge_x = tx1,
      lhinge_y = ty1;
    const rhinge_x = tx2,
      rhinge_y = ty2;
    const lidH = 30;
    const ll_x = lhinge_x - 2,
      ll_y = lhinge_y - lidH; // bord ext gauche capot
    const lr_x = rhinge_x - 2,
      lr_y = rhinge_y - lidH; // bord ext droit capot
    // Épaisseur capot (côté droit visible)
    const capThick = 3;
    return (
      <svg width={sw} height={sh} viewBox={`0 0 ${VW} ${VH}`} fill="none">
        {/* ── Capot ouvert ── */}
        {/* Face intérieure du capot (visible car ouvert) */}
        <polygon
          points={`${lhinge_x},${lhinge_y} ${rhinge_x},${rhinge_y} ${lr_x},${lr_y} ${ll_x},${ll_y}`}
          fill="currentColor"
          fillOpacity={0.04}
          {...S(1.5)}
        />
        {/* Tranche droite du capot */}
        <polygon
          points={`${rhinge_x},${rhinge_y} ${rhinge_x + capThick},${rhinge_y - 2} ${lr_x + capThick},${lr_y - 2} ${lr_x},${lr_y}`}
          fill="currentColor"
          fillOpacity={0.08}
          {...S(1)}
        />
        {/* Tranche supérieure du capot */}
        <polygon
          points={`${ll_x},${ll_y} ${lr_x},${lr_y} ${lr_x + capThick},${lr_y - 2} ${ll_x + capThick},${ll_y - 2}`}
          fill="currentColor"
          fillOpacity={0.06}
          {...S(0.8)}
        />

        {/* ── Corps ── */}
        {/* Face avant */}
        <rect
          x={bx1}
          y={by1}
          width={bx2 - bx1}
          height={by2 - by1}
          fill="currentColor"
          fillOpacity={0.04}
          {...S(1.8)}
        />
        {/* Face droite */}
        <polygon
          points={`${rx1},${ry1} ${rx2},${ry2} ${rx3},${ry3} ${rx1},${by2}`}
          fill="currentColor"
          fillOpacity={0.08}
          {...S(1.5)}
        />
        {/* Face supérieure (ouverture) */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by1} ${tx2},${ty2} ${tx1},${ty1}`}
          fill="currentColor"
          fillOpacity={0.06}
          {...S(1.2)}
        />

        {/* ── Rails rack intérieurs ── */}
        <line x1={bx1 + 8} y1={by1 + 1} x2={bx1 + 8} y2={by2 - 1} {...S(1.2, 0.5)} />
        <line x1={bx2 - 8} y1={by1 + 1} x2={bx2 - 8} y2={by2 - 1} {...S(1.2, 0.5)} />
        {/* Perforations rails */}
        {[50, 56, 62, 68, 74, 80].map((y) => (
          <g key={y}>
            <rect x={bx1 + 5} y={y - 2} width={5} height={4} rx={1} {...F(0.3)} />
            <rect x={bx2 - 10} y={y - 2} width={5} height={4} rx={1} {...F(0.3)} />
          </g>
        ))}

        {/* ── Angles métalliques (équerres) ── */}
        {/* Chaque angle = 2 rectangles en L */}
        {/* Bas-gauche */}
        <rect x={bx1 - 1} y={by2 - 11} width={9} height={13} rx={1} {...F(0.18)} />
        <rect x={bx1 - 1} y={by2 - 11} width={9} height={13} rx={1} {...S(1)} />
        <rect x={bx1 - 1} y={by2 - 1} width={18} height={5} rx={1} {...F(0.18)} />
        <rect x={bx1 - 1} y={by2 - 1} width={18} height={5} rx={1} {...S(1)} />
        {/* Bas-droit */}
        <rect x={bx2 - 8} y={by2 - 11} width={9} height={13} rx={1} {...F(0.18)} />
        <rect x={bx2 - 8} y={by2 - 11} width={9} height={13} rx={1} {...S(1)} />
        <rect x={bx2 - 17} y={by2 - 1} width={18} height={5} rx={1} {...F(0.18)} />
        <rect x={bx2 - 17} y={by2 - 1} width={18} height={5} rx={1} {...S(1)} />
        {/* Haut-gauche face avant */}
        <rect x={bx1 - 1} y={by1 - 2} width={9} height={13} rx={1} {...F(0.18)} />
        <rect x={bx1 - 1} y={by1 - 2} width={9} height={13} rx={1} {...S(1)} />
        <rect x={bx1 - 1} y={by1 - 4} width={18} height={5} rx={1} {...F(0.18)} />
        <rect x={bx1 - 1} y={by1 - 4} width={18} height={5} rx={1} {...S(1)} />
        {/* Haut-droit face avant */}
        <rect x={bx2 - 8} y={by1 - 2} width={9} height={13} rx={1} {...F(0.18)} />
        <rect x={bx2 - 8} y={by1 - 2} width={9} height={13} rx={1} {...S(1)} />
        <rect x={bx2 - 17} y={by1 - 4} width={18} height={5} rx={1} {...F(0.18)} />
        <rect x={bx2 - 17} y={by1 - 4} width={18} height={5} rx={1} {...S(1)} />

        {/* ── Loquet central ── */}
        <rect x={34} y={by2 - 2} width={14} height={5} rx={1.5} {...F(0.2)} />
        <rect x={34} y={by2 - 2} width={14} height={5} rx={1.5} {...S(1)} />

        {/* ── Roulettes ── */}
        {hasWheels &&
          [14, 60].map((cx) => (
            <g key={cx}>
              <circle
                cx={cx}
                cy={by2 + 8}
                r={6}
                fill="currentColor"
                fillOpacity={0.12}
                {...S(1.2)}
              />
              <circle cx={cx} cy={by2 + 8} r={2} {...F(0.3)} />
              <line x1={cx} y1={by2} x2={cx} y2={by2 + 2} {...S(1.2)} />
            </g>
          ))}
      </svg>
    );
  }

  if (type === "FLIGHT_CASE_SKB") {
    // Vue 3/4 isométrique, capot ouvert — style plastique moulé SKB
    const DX = 16,
      DY = 9;
    const bx1 = 4,
      by1 = 44,
      bx2 = 68,
      by2 = 80;
    const tx1 = bx1 + DX,
      ty1 = by1 - DY;
    const tx2 = bx2 + DX,
      ty2 = by1 - DY;
    // Capot ouvert
    const lidH = 28;
    const ll_x = tx1 - 2,
      ll_y = ty1 - lidH;
    const lr_x = tx2 - 2,
      lr_y = ty2 - lidH;
    return (
      <svg width={sw} height={sh} viewBox={`0 0 ${VW} ${VH}`} fill="none">
        {/* ── Capot ouvert (plastique, coins arrondis) ── */}
        {/* Face intérieure du capot */}
        <path
          d={`M ${tx1} ${ty1} L ${tx2} ${ty2} L ${lr_x} ${lr_y} L ${ll_x} ${ll_y} Z`}
          fill="currentColor"
          fillOpacity={0.04}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* Lèvre du couvercle (rail moulé sur le bord intérieur) */}
        <line
          x1={tx1 + 2}
          y1={ty1 - 2}
          x2={tx2 + 2}
          y2={ty2 - 2}
          stroke="currentColor"
          strokeWidth={0.8}
          strokeOpacity={0.35}
        />
        {/* Tranche droite capot */}
        <polygon
          points={`${tx2},${ty2} ${tx2 + 3},${ty2 - 2} ${lr_x + 3},${lr_y - 2} ${lr_x},${lr_y}`}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={0.8}
          strokeLinejoin="round"
        />

        {/* ── Corps (face avant, arrondis plastique) ── */}
        <rect
          x={bx1}
          y={by1}
          width={bx2 - bx1}
          height={by2 - by1}
          rx={4}
          fill="currentColor"
          fillOpacity={0.04}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Lèvre moulée body/lid (rainure sur face avant) */}
        <path
          d={`M ${bx1 + 4} ${by1 + 4} L ${bx2 - 4} ${by1 + 4}`}
          stroke="currentColor"
          strokeWidth={0.8}
          strokeOpacity={0.4}
        />
        {/* Face droite */}
        <polygon
          points={`${bx2},${by1} ${tx2},${ty2} ${tx2},${ty2 + (by2 - by1)} ${bx2},${by2}`}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* Face sup (ouverture) */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by1} ${tx2},${ty2} ${tx1},${ty1}`}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />

        {/* ── Nervures plastique horizontales ── */}
        {[by1 + 14, by1 + 24].map((y) => (
          <line
            key={y}
            x1={bx1 + 4}
            y1={y}
            x2={bx2 - 4}
            y2={y}
            stroke="currentColor"
            strokeWidth={0.8}
            strokeOpacity={0.25}
          />
        ))}

        {/* ── Rails rack intérieurs ── */}
        <line
          x1={bx1 + 7}
          y1={by1 + 2}
          x2={bx1 + 7}
          y2={by2 - 1}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeOpacity={0.45}
        />
        <line
          x1={bx2 - 7}
          y1={by1 + 2}
          x2={bx2 - 7}
          y2={by2 - 1}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeOpacity={0.45}
        />
        {/* Perforations rail */}
        {[50, 57, 64, 71].map((y) => (
          <g key={y}>
            <rect x={bx1 + 4} y={y - 2} width={4} height={4} rx={1} {...F(0.28)} />
            <rect x={bx2 - 8} y={y - 2} width={4} height={4} rx={1} {...F(0.28)} />
          </g>
        ))}

        {/* ── Loquet SKB (butterfly latch sur face droite) ── */}
        <rect x={bx2 + 2} y={(by1 + by2) / 2 - 6} width={8} height={12} rx={2} {...F(0.15)} />
        <rect
          x={bx2 + 2}
          y={(by1 + by2) / 2 - 6}
          width={8}
          height={12}
          rx={2}
          stroke="currentColor"
          strokeWidth={0.9}
          fill="none"
        />
        <rect x={bx2 + 4} y={(by1 + by2) / 2 - 2} width={4} height={4} rx={1} {...F(0.35)} />

        {/* ── Poignée (côté droit isométrique, recessed) ── */}
        <path
          d={`M ${tx2 - 2} ${ty2 + 12} L ${tx2 + 10} ${ty2 + 6} L ${tx2 + 10} ${ty2 + 16} L ${tx2 - 2} ${ty2 + 22} Z`}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <line
          x1={tx2 + 2}
          y1={ty2 + 10}
          x2={tx2 + 8}
          y2={ty2 + 8}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeOpacity={0.5}
        />
      </svg>
    );
  }

  if (type === "PELICAN") {
    // Vue 3/4 isométrique, fermé — Pelican/Peli case
    const DX = 16,
      DY = 9;
    // Corps total
    const bx1 = 3,
      by1 = 14,
      bx2 = 70,
      by2 = 81;
    const tx1 = bx1 + DX,
      ty1 = by1 - DY; // arrière-gauche haut
    const tx2 = bx2 + DX,
      ty2 = by1 - DY; // arrière-droit haut
    // Ligne de séparation couvercle/corps (à ~45% de la hauteur)
    const splitY = by1 + Math.round((by2 - by1) * 0.42);
    const splitBackY = ty1 + Math.round((ty2 - ty1) * 0); // même que ty1 (horizontal)
    const splitRightY = splitY - DY; // sur la face droite

    return (
      <svg width={sw} height={sh} viewBox={`0 0 ${VW} ${VH}`} fill="none">
        {/* ── Face avant (body + lid) ── */}
        {/* Couvercle (partie haute) - coins très arrondis */}
        <path
          d={`M ${bx1 + 5} ${by1} Q ${bx1} ${by1} ${bx1} ${by1 + 5} L ${bx1} ${splitY} L ${bx2} ${splitY} L ${bx2} ${by1 + 5} Q ${bx2} ${by1} ${bx2 - 5} ${by1} Z`}
          fill="currentColor"
          fillOpacity={0.05}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Corps (partie basse) */}
        <path
          d={`M ${bx1} ${splitY} L ${bx1} ${by2 - 5} Q ${bx1} ${by2} ${bx1 + 5} ${by2} L ${bx2 - 5} ${by2} Q ${bx2} ${by2} ${bx2} ${by2 - 5} L ${bx2} ${splitY} Z`}
          fill="currentColor"
          fillOpacity={0.07}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />

        {/* ── Face droite ── */}
        {/* Côté droit du couvercle */}
        <polygon
          points={`${bx2},${by1} ${tx2},${ty1} ${tx2},${ty1 + (splitY - by1)} ${bx2},${splitY}`}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* Côté droit du corps */}
        <polygon
          points={`${bx2},${splitY} ${tx2},${ty1 + (splitY - by1)} ${tx2},${ty1 + (by2 - by1)} ${bx2},${by2}`}
          fill="currentColor"
          fillOpacity={0.12}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* ── Face supérieure (top du couvercle) ── */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by1} ${tx2},${ty1} ${tx1},${ty1}`}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* ── Ligne de séparation lid/body (joint) ── */}
        <line
          x1={bx1}
          y1={splitY}
          x2={bx2}
          y2={splitY}
          stroke="currentColor"
          strokeWidth={2}
          strokeOpacity={0.5}
        />
        {/* Ligne sur face droite */}
        <line
          x1={bx2}
          y1={splitY}
          x2={tx2}
          y2={splitY - DY}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeOpacity={0.4}
        />

        {/* ── Loquets butterfly (3 sur face avant, centrés sur joint) ── */}
        {[17, 36, 55].map((lx) => (
          <g key={lx}>
            {/* Corps du loquet */}
            <rect
              x={lx}
              y={splitY - 5}
              width={12}
              height={10}
              rx={2}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="currentColor"
              strokeWidth={1}
            />
            {/* Ailettes haut/bas */}
            <rect
              x={lx + 2}
              y={splitY - 8}
              width={8}
              height={5}
              rx={1.5}
              fill="currentColor"
              fillOpacity={0.2}
              stroke="currentColor"
              strokeWidth={0.8}
            />
            <rect
              x={lx + 2}
              y={splitY + 3}
              width={8}
              height={5}
              rx={1.5}
              fill="currentColor"
              fillOpacity={0.2}
              stroke="currentColor"
              strokeWidth={0.8}
            />
            {/* Point central */}
            <circle cx={lx + 6} cy={splitY} r={1.5} fill="currentColor" fillOpacity={0.5} />
          </g>
        ))}

        {/* ── Poignée sur face supérieure (isométrique) ── */}
        <path
          d={`M ${bx1 + DX + 8} ${ty1 + 3} Q ${(bx1 + bx2) / 2 + DX / 2} ${ty1 - 5} ${bx2 + DX - 8} ${ty1 + 3}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeOpacity={0.5}
        />
        {/* Attaches poignée */}
        <line
          x1={bx1 + DX + 8}
          y1={ty1}
          x2={bx1 + DX + 8}
          y2={ty1 + 4}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeOpacity={0.4}
        />
        <line
          x1={bx2 + DX - 8}
          y1={ty1}
          x2={bx2 + DX - 8}
          y2={ty1 + 4}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeOpacity={0.4}
        />

        {/* ── Valve de pression (face avant, coin haut droit) ── */}
        <circle
          cx={bx2 - 7}
          cy={by1 + 8}
          r={3.5}
          fill="currentColor"
          fillOpacity={0.08}
          stroke="currentColor"
          strokeWidth={1}
        />
        <circle cx={bx2 - 7} cy={by1 + 8} r={1.5} fill="currentColor" fillOpacity={0.3} />

        {/* ── Nervures de renfort sur corps (face avant) ── */}
        <line
          x1={bx1 + 2}
          y1={splitY + 10}
          x2={bx2 - 2}
          y2={splitY + 10}
          stroke="currentColor"
          strokeWidth={0.7}
          strokeOpacity={0.2}
        />
        <line
          x1={bx1 + 2}
          y1={splitY + 20}
          x2={bx2 - 2}
          y2={splitY + 20}
          stroke="currentColor"
          strokeWidth={0.7}
          strokeOpacity={0.2}
        />
      </svg>
    );
  }

  if (type === "CAP") {
    // Casquette à poser — vue légèrement de dessus, 3/4
    const DX = 14,
      DY = 7;
    const bx1 = 2,
      by1 = 8,
      bx2 = 82,
      by2 = 56; // corps casquette (bas et plat)
    const legH = 18,
      legW = 10;
    return (
      <svg width={sw} height={sh} viewBox={`0 0 ${VW} ${VH}`} fill="none">
        {/* ── Casquette (corps rack couché) ── */}
        {/* Face avant */}
        <rect
          x={bx1}
          y={by1}
          width={bx2 - bx1}
          height={by2 - by1}
          rx={3}
          fill="currentColor"
          fillOpacity={0.04}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Face droite */}
        <polygon
          points={`${bx2},${by1} ${bx2 + DX},${by1 - DY} ${bx2 + DX},${by2 - DY} ${bx2},${by2}`}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* Face supérieure */}
        <polygon
          points={`${bx1},${by1} ${bx2},${by1} ${bx2 + DX},${by1 - DY} ${bx1 + DX},${by1 - DY}`}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* ── Montants rack (face avant) ── */}
        <rect
          x={bx1}
          y={by1}
          width={10}
          height={by2 - by1}
          rx={1}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <rect
          x={bx2 - 10}
          y={by1}
          width={10}
          height={by2 - by1}
          rx={1}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        {/* Perforations */}
        {[14, 22, 30, 38, 46].map((y) => (
          <g key={y}>
            <rect
              x={3}
              y={y}
              width={6}
              height={6}
              rx={1.5}
              fill="currentColor"
              fillOpacity={0.35}
            />
            <rect
              x={bx2 - 9}
              y={y}
              width={6}
              height={6}
              rx={1.5}
              fill="currentColor"
              fillOpacity={0.35}
            />
          </g>
        ))}
        {/* Slots rack */}
        {[12, 22, 32, 42].map((y) => (
          <g key={y}>
            <rect
              x={12}
              y={y}
              width={bx2 - 24}
              height={8}
              rx={1}
              fill="currentColor"
              fillOpacity={0.05}
              stroke="currentColor"
              strokeWidth={0.7}
              strokeOpacity={0.25}
            />
          </g>
        ))}

        {/* ── Pieds ── */}
        {/* Pied avant-gauche */}
        <rect
          x={6}
          y={by2}
          width={legW}
          height={legH}
          rx={2}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        {/* Pied avant-droit */}
        <rect
          x={bx2 - 16}
          y={by2}
          width={legW}
          height={legH}
          rx={2}
          fill="currentColor"
          fillOpacity={0.1}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        {/* Pied arrière-droit (isométrique) */}
        <polygon
          points={`${bx2 + DX - 14},${by2 - DY} ${bx2 + DX - 4},${by2 - DY} ${bx2 + DX - 4},${by2 - DY + legH} ${bx2 + DX - 14},${by2 - DY + legH}`}
          fill="currentColor"
          fillOpacity={0.08}
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
        />

        {/* ── Surface de pose ── */}
        <line
          x1={bx1}
          y1={by2 + legH}
          x2={bx2 + DX}
          y2={by2 + legH - DY}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.2}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return null;
}

const RACK_TYPE_OPTIONS: { value: RackType; label: string; sub?: string }[] = [
  { value: "STANDARD", label: "Baies", sub: '19" ouvert' },
  { value: "FLIGHT_CASE_CLASSIC", label: "Flight case", sub: "Classique · angles métal" },
  { value: "FLIGHT_CASE_SKB", label: "SKB", sub: "Fermetures avant" },
  { value: "PELICAN", label: "Pelicase", sub: "Rigide étanche" },
  { value: "CAP", label: "Rack studio", sub: "Mobilier" },
];

// ── Stats ──────────────────────────────────────────────────────────────────

function getRackStats(rack: Rack) {
  const usedU = rack.slots.filter((s) => s.view === "FRONT").reduce((a, s) => a + s.heightU, 0);
  const rearUsedU = rack.slots.filter((s) => s.view === "REAR").reduce((a, s) => a + s.heightU, 0);
  const rearIntUsedU = rack.slots
    .filter((s) => s.view === "REAR_INTERIOR")
    .reduce((a, s) => a + s.heightU, 0);
  const fillPct = Math.min(100, Math.round((usedU / rack.totalU) * 100));
  const rearFillPct = Math.min(100, Math.round((rearUsedU / rack.totalU) * 100));
  const rearIntFillPct = Math.min(100, Math.round((rearIntUsedU / rack.totalU) * 100));
  const weightKg =
    rack.slots.reduce((a, s) => a + (s.equipment?.weight ?? 0), 0) + (rack.emptyWeightKg ?? 0);
  const powerW = rack.slots.reduce((a, s) => a + (s.equipment?.powerW ?? 0), 0);
  const weightAlert = rack.maxWeightKg != null && weightKg > rack.maxWeightKg;
  const powerAlert = rack.maxPowerW != null && powerW > rack.maxPowerW;
  return {
    usedU,
    fillPct,
    rearUsedU,
    rearFillPct,
    rearIntUsedU,
    rearIntFillPct,
    weightKg,
    powerW,
    weightAlert,
    powerAlert,
  };
}

// ── Formulaire ─────────────────────────────────────────────────────────────

const FALLBACK_U_PRESETS = [6, 9, 12, 18, 24, 30, 36, 42, 45, 48];
const FALLBACK_DEPTH_PRESETS = [400, 450, 500, 550, 600, 700, 800, 900, 1000];

function RackForm({
  defaultValues,
  onSave,
  onCancel,
  submitLabel,
  uPresets = FALLBACK_U_PRESETS,
  defaultTotalU = 42,
  depthPresets = FALLBACK_DEPTH_PRESETS,
  defaultDepthMm = 600,
}: {
  defaultValues?: {
    name?: string;
    totalU?: number;
    depthMm?: number;
    emptyWeightKg?: number | null;
    hasRearInterior?: boolean;
    rearGap?: number;
    rackType?: RackType;
    hasWheels?: boolean;
  };
  onSave: (data: RackFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  uPresets?: number[];
  defaultTotalU?: number;
  depthPresets?: number[];
  defaultDepthMm?: number;
}) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [totalU, setTotalU] = useState(defaultValues?.totalU ?? defaultTotalU);
  const [depthMm, setDepthMm] = useState(defaultValues?.depthMm ?? defaultDepthMm);
  const [emptyWeight, setEmptyWeight] = useState(
    defaultValues?.emptyWeightKg != null ? String(defaultValues.emptyWeightKg) : "",
  );
  const [hasRearInterior, setHasRearInterior] = useState(defaultValues?.hasRearInterior ?? false);
  const [rearGap, setRearGap] = useState(defaultValues?.rearGap ?? 50);
  const [rackType, setRackType] = useState<RackType>(defaultValues?.rackType ?? "STANDARD");
  const [hasWheels, setHasWheels] = useState(defaultValues?.hasWheels ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pill = (active: boolean) =>
    cn(
      "h-9 px-3 rounded-lg border-2 text-[11px] font-bold transition-all",
      active
        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !totalU || !depthMm) return;
    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        totalU,
        depthMm,
        emptyWeightKg: emptyWeight !== "" ? parseFloat(emptyWeight) : null,
        hasRearInterior,
        rearGap,
        rackType,
        hasWheels,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
      {/* ── Nom ── */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Nom *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rack A — Vidéo"
          autoFocus
          className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>

      {/* ── Type de contenant ── */}
      <div className="space-y-2">
        <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Type de contenant
        </label>
        <div className="grid grid-cols-5 gap-2">
          {RACK_TYPE_OPTIONS.map((opt) => {
            const active = rackType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setRackType(opt.value);
                  if (opt.value !== "FLIGHT_CASE_CLASSIC") setHasWheels(false);
                }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all",
                  active
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 8 % : --accent-strong)
                    ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent-strong)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
                )}
              >
                <div className="flex w-full items-center justify-center" style={{ minHeight: 56 }}>
                  <RackTypeSvg
                    type={opt.value}
                    hasWheels={opt.value === "FLIGHT_CASE_CLASSIC" && hasWheels}
                    size={60}
                  />
                </div>
                <span className="text-center text-[10px] leading-tight font-semibold">
                  {opt.label}
                </span>
                {opt.sub && (
                  <span className="text-center text-[9px] leading-tight opacity-60">{opt.sub}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Roulettes — visible uniquement pour flight case classique */}
        {rackType === "FLIGHT_CASE_CLASSIC" && (
          <div className="mt-1 flex items-center gap-3 px-1">
            <span className="flex-1 text-xs text-[var(--muted-foreground)]">Avec roulettes</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setHasWheels(false)}
                className={cn(
                  "h-7 rounded-lg border-2 px-3 text-xs font-semibold transition-all",
                  !hasWheels
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                Non
              </button>
              <button
                type="button"
                onClick={() => setHasWheels(true)}
                className={cn(
                  "h-7 rounded-lg border-2 px-3 text-xs font-semibold transition-all",
                  hasWheels
                    // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                )}
              >
                Oui
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hauteur + Profondeur (grid 2 col) ── */}
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Hauteur — <span className="text-[var(--accent)]">{totalU}U</span>
          </label>
          <div className="grid grid-cols-5 gap-1">
            {uPresets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTotalU(p)}
                className={pill(totalU === p)}
              >
                {p}U
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Profondeur — <span className="text-[var(--accent)]">{depthMm} mm</span>
          </label>
          <div className="grid grid-cols-5 gap-1">
            {depthPresets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDepthMm(p)}
                className={pill(depthMm === p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Poids + Arrière intérieur (grid 2 col) ── */}
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Poids à vide <span className="font-normal opacity-50">(kg)</span>
          </label>
          <input
            type="number"
            min="0"
            placeholder="—"
            value={emptyWeight}
            onChange={(e) => setEmptyWeight(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            Arrière intérieur
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setHasRearInterior(false)}
              className={cn(
                "h-9 flex-1 rounded-lg border-2 text-xs font-semibold transition-all",
                !hasRearInterior
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              Non
            </button>
            <button
              type="button"
              onClick={() => setHasRearInterior(true)}
              className={cn(
                "h-9 flex-1 rounded-lg border-2 text-xs font-semibold transition-all",
                hasRearInterior
                  // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              Oui
            </button>
          </div>
          {hasRearInterior && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                <span>Distance arrière → int.</span>
                <span className="font-semibold text-[var(--accent)]">{rearGap} mm</span>
              </div>
              <input
                type="range"
                min="20"
                max="300"
                step="5"
                value={rearGap}
                onChange={(e) => setRearGap(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2 border-t border-[var(--border)] pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 flex-1 rounded-lg border border-[var(--border)] text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !name.trim() || !totalU || !depthMm}
          // arkyo-server: habillage Strata (texte sur accent plein : --accent-foreground)
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sauvegarde…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  );
}

// ── Shared edit/delete modals extracted ───────────────────────────────────

type RackFormData = {
  name: string;
  totalU: number;
  depthMm: number;
  emptyWeightKg: number | null;
  hasRearInterior: boolean;
  rearGap: number;
  rackType: RackType;
  hasWheels: boolean;
};

function RackEditModal({
  rack,
  onSave,
  onClose,
  uPresets,
  depthPresets,
}: {
  rack: Rack;
  onSave: (data: RackFormData) => Promise<void>;
  onClose: () => void;
  uPresets?: number[];
  depthPresets?: number[];
}) {
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<RackFormData | null>(null);

  const handleSave = async (data: RackFormData) => {
    if (rack.slots.length > 0) {
      setPendingEdit(data);
      setConfirmEdit(true);
      return;
    }
    await onSave(data);
  };

  if (confirmEdit && pendingEdit)
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => {
          setConfirmEdit(false);
          setPendingEdit(null);
        }}
      >
        <div
          className="w-[360px] space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            {/* arkyo-server: habillage Strata (alerte : --warning, icône en --warning-text) */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--warning)]/15">
              <AlertTriangle className="h-4 w-4 text-[var(--warning-text)]" />
            </div>
            <div>
              <p className="text-sm font-semibold">Le rack sera vidé</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                La modification va supprimer les{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  {rack.slots.length} équipement{rack.slots.length !== 1 ? "s" : ""}
                </span>{" "}
                placés.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirmEdit(false);
                setPendingEdit(null);
              }}
              className="h-9 flex-1 rounded-xl border border-[var(--border)] text-xs transition-colors hover:bg-[var(--secondary)]"
            >
              Annuler
            </button>
            <button
              onClick={() => onSave(pendingEdit)}
              // arkyo-server: habillage Strata (alerte pleine : fond --warning-text, texte --surface ; 5,0:1 en clair, 9,0:1 en sombre)
              className="h-9 flex-1 rounded-xl bg-[var(--warning-text)] text-xs font-semibold text-[var(--surface)] transition-opacity hover:opacity-90"
            >
              Confirmer
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-[820px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 pt-5 pb-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)]">
            <RackTypeSvg type={rack.rackType} hasWheels={rack.hasWheels} size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{rack.name}</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Modifier la configuration
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--border)]"
          >
            <X className="h-4 w-4 text-[var(--muted-foreground)]" />
          </button>
        </div>
        <RackForm
          defaultValues={{
            name: rack.name,
            totalU: rack.totalU,
            depthMm: rack.depthMm,
            emptyWeightKg: rack.emptyWeightKg,
            hasRearInterior: rack.rearInteriorGapMm != null,
            rearGap: rack.rearInteriorGapMm ?? 50,
            rackType: rack.rackType,
            hasWheels: rack.hasWheels,
          }}
          onSave={handleSave as Parameters<typeof RackForm>[0]["onSave"]}
          onCancel={onClose}
          submitLabel="Enregistrer"
          uPresets={uPresets}
          depthPresets={depthPresets}
        />
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  rack,
  onConfirm,
  onClose,
}: {
  rack: Rack;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[340px] space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {/* arkyo-server: habillage Strata (danger : --danger, icône en --danger-text) */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger)]/15">
            <Trash2 className="h-4 w-4 text-[var(--danger-text)]" />
          </div>
          <div>
            <p className="text-sm font-semibold">Supprimer ce rack ?</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              <span className="font-semibold text-[var(--foreground)]">{rack.name}</span> et ses{" "}
              {rack.slots.length} équipement{rack.slots.length !== 1 ? "s" : ""} seront supprimés.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-xl border border-[var(--border)] text-xs transition-colors hover:bg-[var(--secondary)]"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            // arkyo-server: habillage Strata (danger plein : --destructive, comme le bouton destructive)
            className="h-9 flex-1 rounded-xl bg-[var(--destructive)] text-xs font-semibold text-[var(--destructive-foreground)] transition-opacity hover:opacity-90"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Labels type rack ───────────────────────────────────────────────────────

const RACK_TYPE_LABEL: Record<RackType, string> = {
  STANDARD: "Baies",
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Rack studio",
};

// ── Couleurs par type de rack ──────────────────────────────────────────────

const RACK_TYPE_COLORS: Record<RackType, string> = {
  STANDARD: "#22c55e",
  FLIGHT_CASE_CLASSIC: "#3b82f6",
  FLIGHT_CASE_SKB: "#8b5cf6",
  PELICAN: "#f59e0b",
  CAP: "#94a3b8",
};

const RACK_TYPE_ORDER: RackType[] = [
  "STANDARD",
  "FLIGHT_CASE_CLASSIC",
  "FLIGHT_CASE_SKB",
  "PELICAN",
  "CAP",
];

// ── Main ───────────────────────────────────────────────────────────────────

export function RacksClient({ racks: initialRacks }: { racks: Rack[] }) {
  const router = useRouter();
  const confirm = useConfirm();

  const [racks, setRacks] = useState(initialRacks);
  useEffect(() => setRacks(initialRacks), [initialRacks]);

  const [search, setSearch] = useState("");
  // Multi-select : Set<RackType>. Vide = aucun filtre (tous les types).
  const [typeFilter, setTypeFilter] = useState<Set<RackType>>(new Set());
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [sortKey, setSortKey] = useState<"recent" | "name">("recent");
  // Vue grid / list — persistée localStorage (aligné sur la liste Projets).
  const [view, setView] = useLocalStorageState<"grid" | "list">("racks:view", "grid", {
    isValid: (v): v is "grid" | "list" => v === "grid" || v === "list",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editRack, setEditRack] = useState<Rack | null>(null);

  // Presets BDD (utilisés dans RackForm)
  const [uPresets, setUPresets] = useState<number[]>(FALLBACK_U_PRESETS);
  const [defaultTotalU, setDefaultTotalU] = useState(42);
  const [depthPresets, setDepthPresets] = useState<number[]>(FALLBACK_DEPTH_PRESETS);
  const [defaultDepthMm, setDefaultDepthMm] = useState(600);

  useEffect(() => {
    api
      .get<Record<string, string>>("/api/admin/config")
      .then((cfg) => {
        try {
          const h = JSON.parse(cfg.u_heights ?? "null");
          if (Array.isArray(h)) setUPresets(h);
        } catch {}
        if (cfg.default_rack_height) setDefaultTotalU(Number(cfg.default_rack_height));
        try {
          const d = JSON.parse(cfg.rack_depths ?? "null");
          if (Array.isArray(d)) setDepthPresets(d);
        } catch {}
        if (cfg.default_rack_depth) setDefaultDepthMm(Number(cfg.default_rack_depth));
      })
      .catch(() => {});
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────
  // Création gérée directement dans <NewRackWizard onSubmit={...}> ci-dessous.

  const handleUpdate = async (rack: Rack, data: RackFormData) => {
    let updated: Rack;
    try {
      updated = await api.patch<Rack>(`/api/racks/${rack.id}`, {
        name: data.name,
        totalU: data.totalU,
        depthMm: data.depthMm,
        emptyWeightKg: data.emptyWeightKg,
        rearInteriorGapMm: data.hasRearInterior ? data.rearGap : null,
        rackType: data.rackType,
        hasWheels: data.hasWheels,
      });
    } catch (e) {
      if (e instanceof ApiError) return;
      throw e;
    }
    setRacks((prev) => prev.map((r) => (r.id === updated.id ? { ...updated, slots: [] } : r)));
    setEditRack(null);
  };

  const handleDelete = async (rack: Rack) => {
    const ok = await confirm({
      title: "Supprimer ce rack ?",
      description: (
        <>
          <strong>{rack.name}</strong>
          {rack.slots.length > 0 && (
            <>
              {" "}
              et ses {rack.slots.length} équipement
              {rack.slots.length !== 1 ? "s" : ""}
            </>
          )}{" "}
          seront supprimés.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/racks/${rack.id}`);
      setRacks((prev) => prev.filter((r) => r.id !== rack.id));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  };

  // ── Filtrage + tri + groupement par type ────────────────────────────────
  const filtered = useMemo(() => {
    const list = racks.filter((r) => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter.size > 0 && !typeFilter.has(r.rackType)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "fr");
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [racks, search, typeFilter, sortKey]);

  const grouped = useMemo(() => {
    const m: Record<string, Rack[]> = {};
    for (const r of filtered) (m[r.rackType] ??= []).push(r);
    return m;
  }, [filtered]);

  const orderedTypes = RACK_TYPE_ORDER.filter((t) => grouped[t]?.length);

  const toggleTypeFilter = (t: RackType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };
  // Nombre de dimensions de filtre actives (ici une seule : le type).
  const activeFilterCount = typeFilter.size > 0 ? 1 : 0;
  const resetFilters = () => {
    setSearch("");
    setTypeFilter(new Set());
  };

  // Pills des filtres actifs (affichées dans la toolbar).
  const activePills = useMemo<ActivePill[]>(() => {
    const out: ActivePill[] = [];
    for (const t of typeFilter) {
      out.push({
        key: `type:${t}`,
        label: RACK_TYPE_LABEL[t],
        color: RACK_TYPE_COLORS[t],
        onRemove: () => toggleTypeFilter(t),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  // ─── Rendu ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex-1 overflow-y-auto px-8",
          // Empty state plein écran centré verticalement (pattern liste Projets).
          racks.length === 0
            ? "flex items-center justify-center py-8"
            : "space-y-5 py-5",
        )}
      >
        {/* Empty state — aucun rack */}
        {racks.length === 0 && (
          <EmptyState
            icon={<Container strokeWidth={1.5} />}
            title="Aucun contenant"
            description={`Créez votre premier contenant pour y placer vos équipements.`}
            action={
              <IfTenantPerm domain="design" level="write">
                <EmptyStateAction onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Nouveau contenant
                </EmptyStateAction>
              </IfTenantPerm>
            }
          />
        )}

        {/* Toolbar filtres — pattern aligné sur la liste Projets (drawer Sheet) */}
        {racks.length > 0 && (
          <AdminListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Nom…"
            count={filtered.length}
            total={racks.length}
            onSort={() => setSortKey(sortKey === "recent" ? "name" : "recent")}
            sortDir={sortKey === "recent" ? "desc" : "asc"}
            onFilter={() => setFilterDrawerOpen(true)}
            filterCount={activeFilterCount}
            onClearFilters={resetFilters}
            view={view}
            onViewChange={setView}
          >
            <ActiveFilterPills pills={activePills} />
          </AdminListToolbar>
        )}

        {/* Aucun résultat après filtres */}
        {racks.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun contenant ne correspond à ces filtres"
            description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
            action={
              <button
                onClick={resetFilters}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Réinitialiser les filtres
              </button>
            }
            className="py-16"
          />
        )}

        {racks.length > 0 && filtered.length > 0 && (
          <div className="space-y-7">
            {/* Inline add — réservé à design:write */}
            <IfTenantPerm domain="design" level="write">
              {view === "grid" ? (
                <button
                  onClick={() => setCreateOpen(true)}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                  style={{ minHeight: 72 }}
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-xs font-medium">Nouveau contenant</span>
                </button>
              ) : (
                <button
                  onClick={() => setCreateOpen(true)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Nouveau contenant</span>
                </button>
              )}
            </IfTenantPerm>

            {orderedTypes.map((type) => {
              const items = grouped[type] ?? [];
              const color = RACK_TYPE_COLORS[type];
              return (
                <div key={type}>
                  {/* Header groupe type */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <h3 className="text-xs font-bold tracking-widest uppercase" style={{ color }}>
                      {RACK_TYPE_LABEL[type]}
                    </h3>
                    <div className="h-px flex-1" style={{ backgroundColor: `${color}30` }} />
                    <span className="text-xs text-[var(--muted-foreground)]">{items.length}</span>
                  </div>

                  {view === "grid" ? (
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      }}
                    >
                      {items.map((rack) => {
                        const stats = getRackStats(rack);
                        const hasAlert = stats.weightAlert || stats.powerAlert;
                        return (
                          <div
                            key={rack.id}
                            onClick={() => router.push(`/racks/${rack.id}`)}
                            className="group relative flex cursor-pointer items-center gap-3 rounded-xl border bg-[var(--card)] p-3 transition-colors hover:bg-[var(--secondary)]"
                            style={{
                              borderTopColor: `${color}15`,
                              borderRightColor: `${color}15`,
                              borderBottomColor: `${color}15`,
                              borderLeftColor: color,
                              borderLeftWidth: 3,
                            }}
                          >
                            <div
                              className="flex shrink-0 items-center justify-center rounded-lg"
                              style={{
                                width: 40,
                                height: 40,
                                background: `${color}20`,
                                color,
                              }}
                            >
                              <RackTypeSvg
                                type={rack.rackType}
                                hasWheels={rack.hasWheels}
                                size={28}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="truncate text-sm font-semibold">{rack.name}</p>
                                {hasAlert && (
                                  // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                  <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--danger-text)]" />
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 truncate text-[11px] text-[var(--muted-foreground)]">
                                <span>
                                  {rack.totalU}U · {rack.depthMm}mm
                                </span>
                                {rack.rigs.length > 0 && (
                                  <>
                                    <span>·</span>
                                    {/* arkyo-server: habillage Strata (texte d'accent sur --secondary au survol, 4,3:1 : --accent-strong) */}
                                    <span className="truncate font-medium text-[var(--accent-strong)]">
                                      {rack.rigs[0].rigConfig.name}
                                    </span>
                                  </>
                                )}
                              </div>
                              {/* Mini barre occupation */}
                              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--secondary)]">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    // arkyo-server: habillage Strata (alerte de dépassement : --danger)
                                    hasAlert ? "bg-[var(--danger)]" : "",
                                  )}
                                  style={{
                                    width: `${stats.fillPct}%`,
                                    background: hasAlert ? undefined : color,
                                  }}
                                />
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                                <span className="tabular-nums">
                                  {stats.usedU}/{rack.totalU}U
                                </span>
                                {stats.weightKg > 0 && (
                                  <span
                                    className={cn(
                                      "flex items-center gap-0.5",
                                      // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                      stats.weightAlert && "font-semibold text-[var(--danger-text)]",
                                    )}
                                  >
                                    <Weight className="h-2.5 w-2.5" />
                                    {stats.weightKg.toFixed(1)}kg
                                  </span>
                                )}
                                {stats.powerW > 0 && (
                                  <span
                                    className={cn(
                                      "flex items-center gap-0.5",
                                      // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                      stats.powerAlert && "font-semibold text-[var(--danger-text)]",
                                    )}
                                  >
                                    <Zap className="h-2.5 w-2.5" />
                                    {stats.powerW}W
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <IfTenantPerm domain="design" level="write">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditRack(rack);
                                  }}
                                  className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                                  title="Configurer"
                                >
                                  <Settings className="h-3 w-3" />
                                </button>
                              </IfTenantPerm>
                              <IfTenantPerm domain="design" level="admin">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(rack);
                                  }}
                                  // arkyo-server: habillage Strata
                                  className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </IfTenantPerm>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {items.map((rack) => {
                        const stats = getRackStats(rack);
                        const hasAlert = stats.weightAlert || stats.powerAlert;
                        return (
                          <div
                            key={rack.id}
                            onClick={() => router.push(`/racks/${rack.id}`)}
                            className="group flex cursor-pointer items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]"
                            style={{
                              borderTopColor: `${color}20`,
                              borderRightColor: `${color}20`,
                              borderBottomColor: `${color}20`,
                              borderLeftColor: color,
                              borderLeftWidth: 3,
                            }}
                          >
                            <div
                              className="flex shrink-0 items-center justify-center rounded-lg"
                              style={{
                                width: 28,
                                height: 28,
                                background: `${color}20`,
                                color,
                              }}
                            >
                              <RackTypeSvg
                                type={rack.rackType}
                                hasWheels={rack.hasWheels}
                                size={20}
                              />
                            </div>
                            <p className="flex-1 truncate text-xs font-semibold">
                              {rack.name}
                              {hasAlert && (
                                // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                <AlertTriangle className="ml-1 inline-block h-3 w-3 text-[var(--danger-text)]" />
                              )}
                            </p>
                            <span className="hidden shrink-0 text-[10px] text-[var(--muted-foreground)] tabular-nums sm:inline">
                              {rack.totalU}U · {rack.depthMm}mm
                            </span>
                            {rack.rigs.length > 0 && (
                              // arkyo-server: habillage Strata (texte d'accent sur l'accent à 15 % : --accent-strong)
                              <span className="hidden max-w-[120px] shrink-0 truncate rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent-strong)] md:inline">
                                {rack.rigs[0].rigConfig.name}
                              </span>
                            )}
                            <div className="hidden w-20 shrink-0 md:block">
                              <div className="h-1 overflow-hidden rounded-full bg-[var(--secondary)]">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${stats.fillPct}%`,
                                    // arkyo-server: habillage Strata (alerte de dépassement : --danger)
                                    background: hasAlert ? "var(--danger)" : color,
                                  }}
                                />
                              </div>
                              <p className="text-center text-[9px] text-[var(--muted-foreground)] tabular-nums">
                                {stats.usedU}/{rack.totalU}U
                              </p>
                            </div>
                            {stats.weightKg > 0 && (
                              <span
                                className={cn(
                                  "hidden shrink-0 items-center gap-0.5 text-[10px] lg:flex",
                                  stats.weightAlert
                                    // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                    ? "font-semibold text-[var(--danger-text)]"
                                    : "text-[var(--muted-foreground)]",
                                )}
                              >
                                <Weight className="h-3 w-3" />
                                {stats.weightKg.toFixed(1)}kg
                              </span>
                            )}
                            {stats.powerW > 0 && (
                              <span
                                className={cn(
                                  "hidden shrink-0 items-center gap-0.5 text-[10px] lg:flex",
                                  stats.powerAlert
                                    // arkyo-server: habillage Strata (alerte de dépassement : --danger-text)
                                    ? "font-semibold text-[var(--danger-text)]"
                                    : "text-[var(--muted-foreground)]",
                                )}
                              >
                                <Zap className="h-3 w-3" />
                                {stats.powerW}W
                              </span>
                            )}
                            <IfTenantPerm domain="design" level="write">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditRack(rack);
                                }}
                                className="rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                                title="Configurer"
                              >
                                <Settings className="h-3 w-3" />
                              </button>
                            </IfTenantPerm>
                            <IfTenantPerm domain="design" level="admin">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(rack);
                                }}
                                // arkyo-server: habillage Strata
                                className="rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </IfTenantPerm>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Wizard création — calqué sur `AddContainerWizard` (sans MODE/TEMPLATE) */}
      <NewRackWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        uPresets={uPresets}
        onSubmit={async (data) => {
          let newRack: Rack;
          try {
            newRack = await api.post<Rack>("/api/racks", {
              name: data.name,
              rackType: data.rackType,
              isRackable: data.isRackable,
              totalU: data.totalU,
              depthMm: data.depthMm,
              ...(data.widthMm !== undefined ? { widthMm: data.widthMm } : {}),
              ...(data.heightMm !== undefined ? { heightMm: data.heightMm } : {}),
              ...(data.hasWheels !== undefined ? { hasWheels: data.hasWheels } : {}),
              ...(data.emptyWeightKg !== undefined
                ? { emptyWeightKg: data.emptyWeightKg }
                : {}),
              ...(data.rearInteriorGapMm !== undefined
                ? { rearInteriorGapMm: data.rearInteriorGapMm }
                : {}),
            });
          } catch (e) {
            if (e instanceof ApiError) return;
            throw e;
          }
          router.push(`/racks/${newRack.id}`);
        }}
      />

      {/* Modal édition — réutilise RackEditModal existant */}
      {editRack && (
        <RackEditModal
          rack={editRack}
          onSave={(data) => handleUpdate(editRack, data)}
          onClose={() => setEditRack(null)}
          uPresets={uPresets}
          depthPresets={depthPresets}
        />
      )}

      {/* Drawer filtres — pattern aligné sur la liste Projets */}
      <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <SheetContent className="w-[340px]">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <SheetTitle className="text-sm">Filtrer les contenants</SheetTitle>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif
                  {activeFilterCount > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <SheetBody>
            <div>
              <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                Type de contenant
              </p>
              <div className="flex flex-wrap gap-2">
                {RACK_TYPE_ORDER.map((t) => (
                  <Chip
                    key={t}
                    label={RACK_TYPE_LABEL[t]}
                    active={typeFilter.has(t)}
                    onClick={() => toggleTypeFilter(t)}
                    color={RACK_TYPE_COLORS[t]}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--muted-foreground)]/80">
                Aucune sélection = tous les types.
              </p>
            </div>
          </SheetBody>

          {activeFilterCount > 0 && (
            <SheetFooter>
              <button
                onClick={resetFilters}
                // arkyo-server: habillage Strata
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent)]/20"
              >
                <X className="h-3.5 w-3.5" />
                Effacer les filtres
              </button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
