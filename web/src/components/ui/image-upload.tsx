"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, X, Loader2, ImageIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface ImageUploadProps {
  value: string; // URL actuelle
  onChange: (url: string) => void;
  folder?: string; // sous-dossier dans public/uploads/
  className?: string;
  previewSize?: "sm" | "md" | "lg";
  label?: string;
}

export function ImageUpload({
  value,
  onChange,
  folder = "misc",
  className,
  previewSize = "md",
  label = "Logo",
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const previewDims =
    previewSize === "sm" ? "w-14 h-14" : previewSize === "lg" ? "w-28 h-28" : "w-20 h-20";

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
    upload(file);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [upload],
  );  

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = () => setDragging(false);

  return (
    <div className={cn("flex items-start gap-4", className)}>
      {/* Preview */}
      <div
        className={cn(
          previewDims,
          "group relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : value
              ? "border-[var(--border)] bg-white dark:bg-white/10"
              : "border-[var(--border)] bg-[var(--secondary)] hover:border-[var(--accent)]/60",
        )}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        title="Cliquer ou glisser une image"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        ) : value ? (
          <>
            <img
              src={value}
              alt={label}
              className="h-full w-full object-contain p-1.5"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {/* Overlay au hover */}
            <div className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Upload className="h-4 w-4 text-white" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-[var(--muted-foreground)]">
            <ImageIcon className="h-5 w-5 opacity-50" />
            <span className="px-1 text-center text-[9px] leading-tight font-medium opacity-50">
              Glisser
              <br />
              ou cliquer
            </span>
          </div>
        )}
      </div>

      {/* Droite : infos + actions */}
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
            {label}
          </p>
          {value ? (
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
              {value.split("/").pop()}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              PNG, JPG, SVG, WebP — max 5 Mo
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <Upload className="h-3 w-3" />
            {value ? "Changer" : "Uploader"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              // arkyo-server: habillage Strata
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--danger)]/30 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
            >
              <X className="h-3 w-3" />
              Supprimer
            </button>
          )}
        </div>

        {/* arkyo-server: habillage Strata */}
        {error && <p className="text-[11px] text-[var(--danger-text)]">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
