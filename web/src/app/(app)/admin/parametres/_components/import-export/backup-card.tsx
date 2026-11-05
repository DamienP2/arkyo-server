"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Archive, Check, Download } from "@/components/ui/icons";
import { BACKUP_SECTIONS, type BackupSectionKey } from "@/lib/services/backup";

type Summary = Partial<Record<BackupSectionKey, number>>;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Carte Sauvegarder : sélection des sections + téléchargement du fichier Arkyo. */
export function BackupCard() {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<BackupSectionKey>>(
    () => new Set(BACKUP_SECTIONS.map((s) => s.key)),
  );
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/tenant/parametres/backup/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setSummary(d as Summary);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (key: BackupSectionKey) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleDownload = async () => {
    const sections = BACKUP_SECTIONS.filter((s) => selected.has(s.key)).map((s) => s.key);
    if (sections.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenant/parametres/backup?sections=${sections.join(",")}`);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const match = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename = match?.[1] ?? `arkyo-sauvegarde-${todayStamp()}.json`;
      triggerDownload(blob, decodeURIComponent(filename));
      toast.success("Sauvegarde téléchargée.");
    } catch {
      toast.error("Sauvegarde impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <Archive className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Sauvegarder</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Téléchargez un fichier de restauration.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {BACKUP_SECTIONS.map((s) => {
          const checked = selected.has(s.key);
          const count = summary?.[s.key];
          return (
            <button
              key={s.key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggle(s.key)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                checked
                  ? "border-[var(--accent)]/40 bg-[var(--accent)]/5"
                  : "border-[var(--border)] hover:bg-[var(--secondary)]",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  checked
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                    : "border-[var(--border)]",
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 text-sm font-medium">{s.label}</span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">
                {count ?? "…"}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleDownload}
        disabled={selected.size === 0 || busy}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? "Préparation…" : "Télécharger"}
      </button>
    </div>
  );
}
