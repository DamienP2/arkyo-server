"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "@/components/ui/icons";

/**
 * Avatar rond avec fallback initiales + upload au clic.
 * Réutilisé dans le header de l'éditeur user et dans l'IdentityTab.
 */
export function AvatarUploadShared({
  value,
  onChange,
  initials,
}: {
  value: string;
  onChange: (url: string) => void;
  initials: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "avatars");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) onChange(data.url);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="group relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)]/15 text-2xl font-semibold text-[var(--accent)] transition-opacity hover:opacity-85"
        title="Modifier l'avatar"
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </button>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <Upload className="h-4 w-4 text-white" />
      </div>
      {value && !uploading && (
        <button
          type="button"
          onClick={() => onChange("")}
          // arkyo-server: habillage Strata
          className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow transition-opacity hover:opacity-90"
          title="Retirer l'avatar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
