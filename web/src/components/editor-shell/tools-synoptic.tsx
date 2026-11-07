"use client";
import type { ToolRegistry } from "./tool-registry";
import {
  useTopbarActions,
  type CableStyle,
  type CableCount,
  type CableMode,
} from "./topbar-actions-context";
import {
  segmentedContainerCls,
  segBtn,
  standaloneBtnCls,
  Group,
  GroupDivider,
} from "./tool-topbar-ui";

// ── CableTopbar ──────────────────────────────────────────────────────────────
function CableTopbar() {
  const cableStyle = useTopbarActions((s) => s.cableStyle);
  const cableCount = useTopbarActions((s) => s.cableCount);
  const cableMode = useTopbarActions((s) => s.cableMode);
  const setCableStyle = useTopbarActions((s) => s.setCableStyle);
  const setCableCount = useTopbarActions((s) => s.setCableCount);
  const setCableMode = useTopbarActions((s) => s.setCableMode);
  const spread = useTopbarActions((s) => s.cableSpreadEnabled);
  const setSpread = useTopbarActions((s) => s.setCableSpreadEnabled);

  const styleLabels: Record<CableStyle, string> = {
    ortho: "Orthogonal",
    rounded: "Arrondi",
    arrow: "Flèche",
  };
  const countLabels: Record<CableCount, string> = { single: "Simple", multi: "Multiple" };
  const modeLabels: Record<CableMode, string> = { auto: "Auto", multipoint: "Multipoint" };

  return (
    <div className="flex items-center gap-3">
      <Group label="Nombre">
        <div className={segmentedContainerCls}>
          {(["single", "multi"] as CableCount[]).map((v) => {
            const active = cableCount === v;
            return (
              <button key={v} onClick={() => setCableCount(v)} className={segBtn(active)}>
                {countLabels[v]}
              </button>
            );
          })}
        </div>
      </Group>
      <GroupDivider />
      <Group label="Mode">
        <div className={segmentedContainerCls}>
          {(["auto", "multipoint"] as CableMode[]).map((v) => {
            const active = cableMode === v;
            return (
              <button key={v} onClick={() => setCableMode(v)} className={segBtn(active)}>
                {modeLabels[v]}
              </button>
            );
          })}
        </div>
      </Group>
      <GroupDivider />
      <Group label="Style">
        <div className={segmentedContainerCls}>
          {(["ortho", "rounded", "arrow"] as CableStyle[]).map((v) => {
            const active = cableStyle === v;
            return (
              <button key={v} onClick={() => setCableStyle(v)} className={segBtn(active)}>
                {styleLabels[v]}
              </button>
            );
          })}
        </div>
      </Group>
      {cableCount === "multi" && (
        <>
          <GroupDivider />
          <Group label="Parallèle">
            <div className={segmentedContainerCls}>
              <button onClick={() => setSpread(false)} className={segBtn(!spread)}>
                Superposé
              </button>
              <button onClick={() => setSpread(true)} className={segBtn(spread)}>
                Écarté
              </button>
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

// ── SynopticLabelTopbar ──────────────────────────────────────────────────────
function SynopticLabelTopbar() {
  const labelFont = useTopbarActions((s) => s.synopticLabelFont);
  const labelFontSize = useTopbarActions((s) => s.synopticLabelFontSize);
  const labelColor = useTopbarActions((s) => s.synopticLabelColor);
  const setLabelFont = useTopbarActions((s) => s.setSynopticLabelFont);
  const setLabelFontSize = useTopbarActions((s) => s.setSynopticLabelFontSize);
  const setLabelColor = useTopbarActions((s) => s.setSynopticLabelColor);

  const FONTS = [
    { id: "sans", label: "Sans", value: "system-ui" },
    { id: "mono", label: "Mono", value: "var(--font-mono)" },
    { id: "serif", label: "Serif", value: "var(--font-serif)" },
  ];
  const COLORS = ["#111827", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

  return (
    <div className="flex items-center gap-3">
      <Group label="Police">
        <div className={segmentedContainerCls}>
          {FONTS.map((f) => {
            const active = labelFont === f.value;
            return (
              <button
                key={f.id}
                onClick={() => setLabelFont(f.value)}
                className={segBtn(active)}
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </Group>
      <GroupDivider />
      <Group label="Taille">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={7}
            max={80}
            step={1}
            value={labelFontSize}
            onChange={(e) => setLabelFontSize(Number(e.target.value))}
            className="arkyo-slider w-24"
          />
          <span
            className="text-muted-foreground w-8 text-[10px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {labelFontSize}px
          </span>
        </div>
      </Group>
      <GroupDivider />
      <Group label="Couleur">
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setLabelColor(c)}
              className={`h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform duration-150 ${labelColor === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-[1.2]"} active:scale-90`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Group>
      <GroupDivider />
      <LabelPillControls />
    </div>
  );
}

function LabelPillControls() {
  const pill = useTopbarActions((s) => s.synopticLabelPill);
  const setPill = useTopbarActions((s) => s.setSynopticLabelPill);
  const pillBg = useTopbarActions((s) => s.synopticLabelPillBg);
  const setPillBg = useTopbarActions((s) => s.setSynopticLabelPillBg);
  const pillRadius = useTopbarActions((s) => s.synopticLabelPillRadius);
  const setPillRadius = useTopbarActions((s) => s.setSynopticLabelPillRadius);
  const BG_COLORS = [
    "#fde68a",
    "#fecaca",
    "#bbf7d0",
    "#bfdbfe",
    "#e9d5ff",
    "#fce7f3",
    "#e5e7eb",
    "#1f2937",
  ];
  return (
    <>
      <Group label="Pillule">
        <div className={segmentedContainerCls}>
          <button onClick={() => setPill(false)} className={segBtn(!pill)}>
            Non
          </button>
          <button onClick={() => setPill(true)} className={segBtn(pill)}>
            Oui
          </button>
        </div>
      </Group>
      {pill && (
        <>
          <GroupDivider />
          <Group label="Fond">
            <div className="flex items-center gap-1">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPillBg(c)}
                  className={`h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform duration-150 ${pillBg === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-[1.2]"} active:scale-90`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Group>
          <GroupDivider />
          <Group label="Radius">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={32}
                step={1}
                value={pillRadius}
                onChange={(e) => setPillRadius(Number(e.target.value))}
                className="arkyo-slider w-20"
              />
              <span
                className="text-muted-foreground w-8 text-[10px]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {pillRadius}px
              </span>
            </div>
          </Group>
        </>
      )}
    </>
  );
}

// ── SynopticZoneTopbar ───────────────────────────────────────────────────────
function SynopticZoneTopbar() {
  const zoneColor = useTopbarActions((s) => s.zoneColor);
  const setZoneColor = useTopbarActions((s) => s.setZoneColor);
  const zoneLabel = useTopbarActions((s) => s.zoneLabel);
  const zoneLabelPosition = useTopbarActions((s) => s.zoneLabelPosition);
  const setZoneDefaults = useTopbarActions((s) => s.setZoneDefaults);
  const COLORS = [
    "#6366f1",
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#64748b",
  ];
  const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const posLabel = (p: (typeof POSITIONS)[number]) =>
    p === "top-left" ? "↖" : p === "top-right" ? "↗" : p === "bottom-left" ? "↙" : "↘";
  return (
    <div className="flex items-center gap-3">
      <Group label="Titre par défaut">
        <input
          type="text"
          value={zoneLabel}
          onChange={(e) => setZoneDefaults({ zoneLabel: e.target.value })}
          placeholder="Zone"
          className="border-border bg-card h-7 w-40 rounded-md border px-2 text-[11px] focus:border-[var(--accent)] focus:outline-none"
        />
      </Group>
      <GroupDivider />
      <Group label="Position">
        <div className={segmentedContainerCls}>
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setZoneDefaults({ zoneLabelPosition: p })}
              className={segBtn(zoneLabelPosition === p)}
            >
              {posLabel(p)}
            </button>
          ))}
        </div>
      </Group>
      <GroupDivider />
      <Group label="Couleur">
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setZoneColor(c)}
              className={`h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform duration-150 ${zoneColor === c ? "scale-110 ring-2 ring-[var(--accent)]" : "hover:scale-[1.2]"} active:scale-90`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Group>
    </div>
  );
}

// ── AdapterTopbar ────────────────────────────────────────────────────────────
function AdapterMini({ inCount, outCount }: { inCount: number; outCount: number }) {
  const ins = Math.min(inCount, 3);
  const outs = Math.min(outCount, 3);
  return (
    <svg width={40} height={14} viewBox="0 0 40 14" aria-hidden>
      <rect
        x="6"
        y="3"
        width="28"
        height="8"
        rx="1.5"
        fill="currentColor"
        opacity="0.08"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      {Array.from({ length: ins }).map((_, i) => (
        <circle key={`i-${i}`} cx="6" cy={4.5 + i * 2.2} r="1" fill="currentColor" />
      ))}
      {inCount > 3 && (
        <text
          x="0.5"
          y="12"
          fontSize="4"
          fill="currentColor"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          +{inCount - 3}
        </text>
      )}
      {Array.from({ length: outs }).map((_, i) => (
        <circle key={`o-${i}`} cx="34" cy={4.5 + i * 2.2} r="1" fill="currentColor" />
      ))}
      {outCount > 3 && (
        <text
          x="34.5"
          y="12"
          fontSize="4"
          fill="currentColor"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          +{outCount - 3}
        </text>
      )}
      <path
        d="M 14 7 L 26 7 M 26 7 L 24 5.5 M 26 7 L 24 8.5"
        stroke="currentColor"
        strokeWidth="0.8"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}

function AdapterTopbar() {
  const adapters = useTopbarActions((s) => s.availableAdapters);
  const pickingAdapterId = useTopbarActions((s) => s.pickingAdapterId);
  const setPickingAdapterId = useTopbarActions((s) => s.setPickingAdapterId);
  const pendingAdapterPort = useTopbarActions((s) => s.pendingAdapterPort);
  const setPendingAdapterPort = useTopbarActions((s) => s.setPendingAdapterPort);
  const onInsertAdapterAtPort = useTopbarActions((s) => s.onInsertAdapterAtPort);

  if (!adapters || adapters.length === 0) {
    return (
      <span
        className="text-muted-foreground text-[11px] italic"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Aucun adaptateur disponible
      </span>
    );
  }

  // Filtrage par port cliqué : on ne garde que les adaptateurs dont au moins un input OU output
  // matche le connectorTypeId du port "pending".
  const filterCt = pendingAdapterPort?.connectorTypeId ?? null;
  const filtered = filterCt
    ? adapters.filter((a) => {
        const ios = [...(a.inputs ?? []), ...(a.outputs ?? [])];
        return ios.some((io) => io.connectorTypeId === filterCt);
      })
    : adapters;

  return (
    <Group label={pendingAdapterPort ? "Compatibles" : "Adaptateurs"}>
      <div className="-mx-0.5 flex max-w-[680px] items-center gap-1 overflow-x-auto px-0.5 py-0">
        {pendingAdapterPort && filtered.length === 0 ? (
          <span
            className="text-muted-foreground px-1 text-[10px] italic"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Aucun compatible
          </span>
        ) : null}
        {filtered.map((a) => {
          const active = pickingAdapterId === a.id;
          const inCount = (a.inputs ?? []).reduce((acc, io) => acc + (io.quantity ?? 1), 0);
          const outCount = (a.outputs ?? []).reduce((acc, io) => acc + (io.quantity ?? 1), 0);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                if (pendingAdapterPort && onInsertAdapterAtPort) {
                  // Workflow port-first : insertion inline immédiate
                  onInsertAdapterAtPort(a.id, {
                    slotId: pendingAdapterPort.slotId,
                    portIndex: pendingAdapterPort.portIndex,
                    side: pendingAdapterPort.side,
                  });
                  setPendingAdapterPort(null);
                  setPickingAdapterId(null);
                } else {
                  setPickingAdapterId(active ? null : a.id);
                }
              }}
              title={`${a.name}${a.reference ? ` · ${a.reference}` : ""} · ${inCount} entrée(s) / ${outCount} sortie(s)`}
              className={`group/adapter flex flex-col items-center gap-0 rounded-md border px-1.5 py-0.5 transition-all duration-200 active:scale-95 ${
                active
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 12 % : --accent-strong)
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-[var(--accent)]/40"
              }`}
              style={{ minWidth: 60 }}
            >
              <AdapterMini inCount={inCount} outCount={outCount} />
              <span
                className="max-w-[50px] truncate text-[8px] leading-none font-medium"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {a.name}
              </span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

// ── EraseTopbar ───────────────────────────────────────────────────────────────
function EraseTopbar() {
  const onClearLabels = useTopbarActions((s) => s.onSynopticClearLabels);
  const onDecable = useTopbarActions((s) => s.onSynopticDecable);
  return (
    <div className="flex items-center gap-3">
      <Group label="Mode">
        <span
          className="text-muted-foreground text-[10px] italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Cliquez sur un élément pour le supprimer
        </span>
      </Group>
      <GroupDivider />
      <Group label="Actions en lot">
        <button
          type="button"
          onClick={() => onClearLabels?.()}
          // arkyo-server: habillage Strata (texte de danger au survol : --danger-text)
          className="border-border bg-card text-foreground hover:bg-destructive/10 hover:text-[var(--danger-text)] hover:border-destructive/40 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition-colors active:scale-95"
        >
          Nettoyer les labels
        </button>
        <button
          type="button"
          onClick={() => onDecable?.()}
          // arkyo-server: habillage Strata (texte de danger au survol : --danger-text)
          className="border-border bg-card text-foreground hover:bg-destructive/10 hover:text-[var(--danger-text)] hover:border-destructive/40 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition-colors active:scale-95"
        >
          Tout décâbler
        </button>
      </Group>
    </div>
  );
}

// ── NumberingTopbar ──────────────────────────────────────────────────────────
function NumberingTopbar() {
  const onRenumberAuto = useTopbarActions((s) => s.onRenumberAuto);
  const onManualNumber = useTopbarActions((s) => s.onManualNumber);
  const onValidateRack = useTopbarActions((s) => s.onValidateRack);
  const errCount = useTopbarActions((s) => s.validationErrorCount);
  const warnCount = useTopbarActions((s) => s.validationWarningCount);
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onRenumberAuto?.()}
        className={standaloneBtnCls + " border-border border"}
      >
        Numérotation
      </button>
      <button
        onClick={() => onManualNumber?.()}
        className={standaloneBtnCls + " border-border border"}
      >
        Numérotation manuelle
      </button>
      <button
        onClick={() => onValidateRack?.()}
        className={standaloneBtnCls + " border-border flex items-center gap-1.5 border"}
        title="Valider le rack (BOM + graphe de câblage)"
      >
        Valider le rack
        {(errCount > 0 || warnCount > 0) && (
          <span className="flex items-center gap-1 text-[10px]">
            {errCount > 0 && (
              <span className="bg-destructive rounded-full px-1.5 py-[1px] text-white">
                {errCount}
              </span>
            )}
            {warnCount > 0 && (
              // arkyo-server: habillage Strata (alerte : --warning ; blanc sur --warning clair < 4,5:1, d'où --foreground en clair et --card en sombre)
              <span className="rounded-full bg-[var(--warning)] px-1.5 py-[1px] text-[var(--foreground)] dark:text-[var(--card)]">
                {warnCount}
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────
export const synopticRegistry: ToolRegistry = {
  workspace: "synoptic",
  tools: [
    // Groupe 1 — Sélection / Navigation
    {
      id: "select",
      label: "Sélection",
      shortcut: "V",
      icon: "MousePointer2",
      variants: [
        { id: "rect", label: "Rectangle" },
        { id: "lasso", label: "Lasso" },
      ],
      defaultVariantId: "rect",
    },
    { id: "pan", label: "Main", shortcut: "H", icon: "Hand" },
    { id: "move", label: "Déplacer", shortcut: "M", icon: "Move" },
    { id: "div1", divider: true },
    // Groupe 2 — Création
    {
      id: "cable",
      label: "Câble",
      shortcut: "C",
      icon: "Cable",
      renderContextualTopbar: () => <CableTopbar />,
    },
    { id: "adapter", label: "Adaptateur", shortcut: "A", icon: "Plug" },
    {
      id: "external",
      label: "Connexions externe",
      shortcut: "X",
      icon: "ExternalLink",
      // Pas d'options contextuelles pour cette MVP — la liaison Général viendra plus tard.
      renderContextualTopbar: () => null,
    },
    {
      id: "label",
      label: "Label",
      shortcut: "T",
      icon: "Type",
      renderContextualTopbar: () => <SynopticLabelTopbar />,
    },
    {
      id: "zone",
      label: "Zone",
      shortcut: "R",
      icon: "Square",
      renderContextualTopbar: () => <SynopticZoneTopbar />,
    },
    { id: "div2", divider: true },
    // Groupe 3 — Utilitaires
    {
      id: "erase",
      label: "Gomme / Décâblage",
      shortcut: "E",
      icon: "Eraser",
      renderContextualTopbar: () => <EraseTopbar />,
    },
  ],
};

/**
 * Mapping entre les id d'outils du shell (workspace store) et les string
 * d'outil internes utilisés par `synoptic-view.tsx` (composant legacy).
 * Permet de synchroniser les deux états pendant la migration.
 */
export const SYNOPTIC_TOOL_MAP: Record<string, string> = {
  select: "select",
  pan: "pan",
  move: "move",
  cable: "cable",
  adapter: "adapter",
  external: "external",
  label: "label",
  zone: "zone",
  zoom: "zoom",
  erase: "erase",
};
