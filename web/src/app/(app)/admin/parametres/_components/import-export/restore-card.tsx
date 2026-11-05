"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { ArchiveRestore } from "@/components/ui/icons";
import { validateBackupFile, type ArkyoBackup } from "@/lib/services/backup";

/** Carte Restaurer : dépôt d'un fichier Arkyo, validation, passage à la vérification. */
export function RestoreCard({ onValidated }: { onValidated: (backup: ArkyoBackup) => void }) {
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        toast.error("Fichier illisible : ce n'est pas un fichier Arkyo valide.");
        return;
      }
      const result = validateBackupFile(raw);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onValidated(result.backup);
    } catch {
      toast.error("Lecture du fichier impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
          <ArchiveRestore className="h-4 w-4 text-[var(--foreground)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Restaurer</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Depuis un fichier de sauvegarde Arkyo.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] hover:bg-[var(--secondary)]",
          busy && "cursor-wait opacity-60",
        )}
      >
        <ArchiveRestore className="h-7 w-7 text-[var(--muted-foreground)]" />
        <div>
          <p className="text-sm font-medium">
            {busy ? "Lecture du fichier…" : "Glissez un fichier Arkyo ici, ou cliquez"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Fichier .json</p>
        </div>
      </button>
    </div>
  );
}
