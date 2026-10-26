"use client";

/**
 * FileUpload — composant léger pour uploader un document (PDF par défaut)
 * via /api/upload. Pendant qu'`ImageUpload` est dédié aux images avec preview,
 * ce composant affiche juste l'état du fichier (nom + taille) et un bouton
 * remplacer/supprimer.
 */

import { useCallback, useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

interface FileUploadProps {
  value: string;
  onChange: (url: string) => void;
  /** Sous-dossier dans `public/uploads/`. */
  folder?: string;
  /** Mime acceptés côté input — ne remplace pas la validation serveur. */
  accept?: string;
  className?: string;
  label?: string;
}

export function FileUpload({
  value,
  onChange,
  folder = "documents",
  accept = "application/pdf",
  className,
  label = "Document",
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", folder);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Erreur upload");
          return;
        }
        onChange(data.url);
      } catch {
        setError("Erreur réseau");
      } finally {
        setUploading(false);
      }
    },
    [folder, onChange],
  );

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    void upload(file);
  };

  const filename = value ? (value.split("/").pop() ?? "Fichier") : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 truncate text-xs text-[var(--accent)] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {filename}
          </a>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="px-2 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remplacer"}
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={uploading}
            // arkyo-server: habillage Strata
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
            aria-label="Retirer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/40"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 text-left text-xs">
            {uploading ? `Upload de ${label.toLowerCase()}…` : `Choisir un ${label.toLowerCase()}`}
          </span>
          <span className="text-[9px] tracking-wider uppercase opacity-60">PDF · 10 Mo</span>
        </button>
      )}

      {/* arkyo-server: habillage Strata */}
      {error && <p className="text-[10px] text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
