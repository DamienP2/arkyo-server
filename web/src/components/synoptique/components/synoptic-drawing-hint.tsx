"use client";

type SynopticDrawingHintProps = {
  drawingFrom: { slotId: string; portIndex: number } | null;
  multiSrcPorts: { slotId: string; portIndices: number[] } | null;
  multiSrcConfirmed: boolean;
  cableCount: "single" | "multi";
  cableMode: "auto" | "multipoint";
};

export function SynopticDrawingHint({
  drawingFrom,
  multiSrcPorts,
  multiSrcConfirmed,
  cableCount,
  cableMode,
}: SynopticDrawingHintProps) {
  if (!drawingFrom && !multiSrcPorts) return null;

  const kbd = (k: string) => (
    <kbd className="rounded bg-[var(--secondary)] px-1 py-0.5 text-[10px]">{k}</kbd>
  );

  // Multi phase 2: confirmed, pick destination
  if (cableCount === "multi" && multiSrcConfirmed && multiSrcPorts) {
    const n = multiSrcPorts.portIndices.length;
    return (
      <div
        className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--accent)]/40 px-3 py-1.5 shadow"
        style={{ background: "var(--surface)", zIndex: 20 }}
      >
        <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
        <span className="text-[11px] text-[var(--foreground)]">
          <span className="font-bold text-[var(--accent)]">
            {"\u00d7"}
            {n} ports s{"\u00e9"}lectionn{"\u00e9"}s
          </span>
          {" \u2014 "}Cliquez sur le port de destination {"\u2014"} {kbd("Esc")} annuler
        </span>
      </div>
    );
  }

  // Multi phase 1: first port selected, waiting for second
  if (cableCount === "multi" && !multiSrcConfirmed && multiSrcPorts) {
    return (
      <div
        className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--accent)]/40 px-3 py-1.5 shadow"
        style={{ background: "var(--surface)", zIndex: 20 }}
      >
        <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
        <span className="text-[11px] text-[var(--foreground)]">
          Port de d{"\u00e9"}part s{"\u00e9"}lectionn{"\u00e9"} {"\u2014"} cliquez un autre port du{" "}
          <span className="font-bold text-[var(--accent)]">
            m{"\u00ea"}me {"\u00e9"}quipement
          </span>{" "}
          pour d{"\u00e9"}finir la plage {"\u2014"} {kbd("Esc")} annuler
        </span>
      </div>
    );
  }

  // Single mode
  return (
    <div
      className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--accent)]/40 px-3 py-1.5 shadow"
      style={{ background: "var(--surface)", zIndex: 20 }}
    >
      <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
      <span className="text-[11px] text-[var(--foreground)]">
        {cableMode === "multipoint" ? (
          <>
            Cliquez sur le canvas pour ajouter une ancre {"\u2014"} puis sur un port cible{" "}
            {"\u2014"}{" "}
          </>
        ) : (
          <>Cliquez sur un port cible {"\u2014"} </>
        )}
        {kbd("Esc")} pour annuler
      </span>
    </div>
  );
}
