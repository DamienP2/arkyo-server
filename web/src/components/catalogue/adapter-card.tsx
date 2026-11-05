"use client";

/**
 * AdapterCard — carte adaptateur partagée par supervisor (CRUD) et tenant
 * (read-only).
 *
 * Design extrait de :
 *   app/(app)/admin/_components/adapters-tab.tsx (renderCard).
 *
 * Présentation pure : aucun état CRUD, aucune navigation, aucun fetch.
 *
 * Particularité : les `inputs/outputs` d'un adaptateur stockent uniquement
 * `connectorTypeId` (cf. AdapterPort). Le composant accepte une `connectorMap`
 * (id → ConnectorRef) pour résoudre les noms et couleurs. Si la map est
 * manquante pour un id, on tombe sur un placeholder neutre.
 */

import type { ReactNode } from "react";
import { ArrowRight, Plug } from "@/components/ui/icons";

import { ConnectorIcon } from "@/components/ui/connector-icon";

import type { AdapterCardItem, AdapterPort, ConnectorRef, Gender } from "./types";

const ACCENT = "#06b6d4";
const ROW_H = 40;

const GENDER_LABEL: Record<Gender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

type Props = {
  adapter: AdapterCardItem;
  /**
   * Couleur de la card. Vient en général de `adapter.function.color`. Fallback
   * sur la couleur accent pour rester cohérent avec le supervisor.
   */
  color?: string;
  /**
   * Lookup connectorTypeId → ConnectorRef (avec iconId optionnel). Sans ce
   * lookup, on affiche un Plug neutre. La forme reste ouverte : tout objet
   * `{ id, name, color, iconId? }` est accepté.
   */
  connectorMap?: Map<string, ConnectorRef & { iconId?: string; version?: string | null }>;
  /** Click sur la card entière (édition côté supervisor). */
  onClick?: () => void;
  /** Actions supervisor (delete, proposer…) — en haut à droite. */
  actions?: ReactNode;
  /** Badge optionnel (ex: ArkyoBadge) à afficher à côté du nom. */
  nameBadge?: ReactNode;
  /**
   * Variante d'affichage. `"grid"` (défaut) = card complète avec routing SVG.
   * `"list"` = ligne compacte horizontale (input → arrow → outputs icônes).
   */
  view?: "grid" | "list";
};

/**
 * Eclate les `outputs` selon la `quantity` : un AdapterPort avec quantity=4
 * produit 4 lignes affichées (une par câble physique).
 */
function expandOutputs(outputs: AdapterPort[]): { connectorTypeId: string; gender: Gender }[] {
  const result: { connectorTypeId: string; gender: Gender }[] = [];
  for (const p of outputs) {
    const q = Math.max(1, p.quantity ?? 1);
    for (let i = 0; i < q; i++) {
      result.push({ connectorTypeId: p.connectorTypeId, gender: p.gender });
    }
  }
  return result;
}

export function AdapterCard({
  adapter,
  color: colorProp,
  connectorMap,
  onClick,
  actions,
  nameBadge,
  view = "grid",
}: Props) {
  const cardColor = colorProp ?? adapter.function?.color ?? ACCENT;
  const src = adapter.inputs[0];
  const srcCt = src && connectorMap ? connectorMap.get(src.connectorTypeId) : undefined;
  const srcColor = srcCt?.color ?? "#a3a3a3";
  const srcGender = src ? GENDER_LABEL[src.gender] : "";
  const expanded = expandOutputs(adapter.outputs);

  const interactive = Boolean(onClick);

  // ── LIST view : ligne compacte horizontale ───────────────────────────────
  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={`group flex items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors ${
          interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
        }`}
        style={{
          borderTopColor: `${cardColor}20`,
          borderRightColor: `${cardColor}20`,
          borderBottomColor: `${cardColor}20`,
          borderLeftColor: cardColor,
          borderLeftWidth: 3,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{adapter.name}</p>
          </div>
          {nameBadge}
        </div>
        {adapter.reference && (
          <span className="shrink-0 font-mono text-[9px] text-[var(--muted-foreground)]">
            {adapter.reference}
          </span>
        )}
        {adapter.function && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              backgroundColor: `${adapter.function.color}18`,
              color: adapter.function.color,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: adapter.function.color }}
            />
            {adapter.function.label}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {srcCt && (
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ backgroundColor: `${srcColor}20` }}
            >
              {srcCt.iconId ? (
                <ConnectorIcon iconId={srcCt.iconId} color={srcColor} size={14} />
              ) : (
                <Plug className="h-3 w-3" style={{ color: srcColor }} />
              )}
            </div>
          )}
          {srcGender && (
            <span className="rounded bg-[var(--secondary)] px-1 py-0 text-[8px] font-bold text-[var(--muted-foreground)]">
              {srcGender}
            </span>
          )}
          <ArrowRight className="mx-0.5 h-3 w-3 text-[var(--muted-foreground)] opacity-40" />
          {expanded.slice(0, 5).map((ep, i) => {
            const ct = connectorMap?.get(ep.connectorTypeId);
            const color = ct?.color ?? "#a3a3a3";
            return (
              <div
                key={i}
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ backgroundColor: `${color}20` }}
              >
                {ct?.iconId ? (
                  <ConnectorIcon iconId={ct.iconId} color={color} size={14} />
                ) : (
                  <Plug className="h-3 w-3" style={{ color }} />
                )}
              </div>
            );
          })}
          {expanded.length > 5 && (
            <span className="text-[9px] text-[var(--muted-foreground)]">
              +{expanded.length - 5}
            </span>
          )}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-[var(--card)] transition-colors ${
        interactive ? "cursor-pointer hover:bg-[var(--secondary)]/50" : ""
      }`}
      style={{
        borderTopColor: `${cardColor}15`,
        borderRightColor: `${cardColor}15`,
        borderBottomColor: `${cardColor}15`,
        borderLeftColor: cardColor,
        borderLeftWidth: 3,
      }}
    >
      <div
        className="flex items-start justify-between gap-2 px-4 pt-3 pb-2"
        style={{ background: `${cardColor}08` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="truncate text-sm leading-tight font-semibold">{adapter.name}</p>
            {nameBadge}
          </div>
          {adapter.reference && (
            <p
              className="mt-0.5 truncate font-mono text-[10px] font-bold"
              style={{ color: cardColor }}
            >
              {adapter.reference}
            </p>
          )}
          {adapter.function && (
            <span
              className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ backgroundColor: `${adapter.function.color}18`, color: adapter.function.color }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: adapter.function.color }}
              />
              {adapter.function.label}
            </span>
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <div className="flex items-center gap-0 px-4 py-4">
        <div className="flex w-[76px] shrink-0 flex-col items-center gap-1.5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${srcColor}18`, border: `1.5px solid ${srcColor}30` }}
          >
            {srcCt?.iconId ? (
              <ConnectorIcon iconId={srcCt.iconId} color={srcColor} size={22} />
            ) : (
              <Plug className="h-5 w-5 text-[var(--muted-foreground)]" />
            )}
          </div>
          <div className="max-w-full text-center">
            <p className="truncate text-[10px] leading-tight font-semibold">
              {srcCt?.name ?? "—"}
              {srcCt?.version && (
                <span className="ml-0.5 font-normal opacity-60">{srcCt.version}</span>
              )}
            </p>
            {srcGender && (
              <span className="mt-0.5 inline-block rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[8px] font-bold text-[var(--muted-foreground)]">
                {srcGender}
              </span>
            )}
          </div>
        </div>
        <CableRoutingSvg outputCount={expanded.length} />
        <div className="flex shrink-0 flex-col">
          {expanded.map((ep, i) => {
            const ct = connectorMap?.get(ep.connectorTypeId);
            const color = ct?.color ?? "#a3a3a3";
            const gb = GENDER_LABEL[ep.gender];
            return (
              <div
                key={i}
                className="flex min-w-0 items-center gap-2 px-2"
                style={{ height: ROW_H }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${color}18`, border: `1.5px solid ${color}30` }}
                >
                  {ct?.iconId ? (
                    <ConnectorIcon iconId={ct.iconId} color={color} size={15} />
                  ) : (
                    <Plug className="h-3 w-3 text-[var(--muted-foreground)]" />
                  )}
                </div>
                <p className="min-w-0 truncate text-[10px] leading-tight font-semibold">
                  {ct?.name ?? "?"}
                  {ct?.version && (
                    <span className="ml-0.5 font-normal opacity-60">{ct.version}</span>
                  )}
                  {gb && (
                    <span className="ml-1 rounded bg-[var(--secondary)] px-1 py-0 text-[8px] font-bold text-[var(--muted-foreground)]">
                      {gb}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
          {expanded.length === 0 && (
            <div
              className="flex items-center px-2 text-[10px] text-[var(--muted-foreground)] italic"
              style={{ height: ROW_H }}
            >
              Aucune cible
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CableRoutingSvg ─────────────────────────────────────────────────────────
// Câble pieuvre : tronc épais depuis la source, point de jonction, puis
// 1 branche par connecteur individuel (quantity éclatée).

function CableRoutingSvg({ outputCount }: { outputCount: number }) {
  const n = Math.max(outputCount, 1);
  const VW = 120;
  const H = n * ROW_H;
  const midY = H / 2;
  const splitX = 28;

  return (
    <svg
      viewBox={`0 0 ${VW} ${H}`}
      className="flex-1"
      style={{ height: H, minWidth: 60, maxWidth: 140 }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path
        d={`M 0,${midY} L ${splitX},${midY}`}
        fill="none"
        stroke={ACCENT}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.55}
      />
      {Array.from({ length: n }, (_, i) => {
        const targetY = ROW_H / 2 + i * ROW_H;
        let d: string;
        if (Math.abs(targetY - midY) < 1) {
          d = `M ${splitX},${midY} L ${VW},${targetY}`;
        } else {
          const cx1 = splitX + (VW - splitX) * 0.4;
          const cx2 = splitX + (VW - splitX) * 0.6;
          d = `M ${splitX},${midY} C ${cx1},${midY} ${cx2},${targetY} ${VW},${targetY}`;
        }
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.5}
          />
        );
      })}
      {n > 1 && <circle cx={splitX} cy={midY} r={4.5} fill={ACCENT} opacity={0.45} />}
      <circle cx={0} cy={midY} r={4.5} fill={ACCENT} opacity={0.65} />
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx={VW} cy={ROW_H / 2 + i * ROW_H} r={3.5} fill={ACCENT} opacity={0.55} />
      ))}
    </svg>
  );
}
