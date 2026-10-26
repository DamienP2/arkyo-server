"use client";

/**
 * EquipmentIconPicker — sélecteur d'icône pour CatalogEquipment / Category.
 *
 * Deux onglets :
 *   - Lucide : grille des icônes broadcast curated (cf. `BROADCAST_LUCIDE_ICONS`)
 *   - Personnalisée : champ URL libre + bouton téléverser (POST /api/upload).
 *
 * Valeur stockée :
 *   - nom lucide (ex. `"camera"`) → résolu via `BROADCAST_LUCIDE_ICONS`
 *   - URL (`/uploads/...` ou `https://...`) → rendue en `<img>`
 *
 * Aligné sur les patterns de `components/ui/connector-icon.tsx` (détection URL).
 */

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Trash2, Upload, X } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BROADCAST_LUCIDE_ICONS, EquipmentIcon, isIconUrl } from "./equipment-icon";

type Tab = "lucide" | "custom";

export function EquipmentIconPicker({
  value,
  onChange,
  open,
  onOpenChange,
  inheritedFrom,
  title = "Choisir une icône",
}: {
  /** Valeur courante — nom lucide ou URL (null = pas d'override). */
  value: string | null;
  /** Callback de changement. `null` = effacer (revient au fallback / héritage). */
  onChange: (next: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Affiché en bas si la valeur est héritée (ex. catégorie parente). */
  inheritedFrom?: string | null;
  title?: string;
}) {
  const initialTab: Tab = value && isIconUrl(value) ? "custom" : "lucide";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [urlInput, setUrlInput] = useState<string>(value && isIconUrl(value) ? value : "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync l'onglet et le champ URL quand la valeur ou l'ouverture changent.
  useEffect(() => {
    if (!open) return;
    setTab(value && isIconUrl(value) ? "custom" : "lucide");
    setUrlInput(value && isIconUrl(value) ? value : "");
    setUploadError(null);
  }, [open, value]);

  const handlePickLucide = (id: string) => {
    onChange(id);
    onOpenChange(false);
  };

  const handleApplyUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      onChange(null);
      onOpenChange(false);
      return;
    }
    onChange(trimmed);
    onOpenChange(false);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "equipment/icons");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(typeof data?.error === "string" ? data.error : "Échec de l'envoi");
        return;
      }
      const url = typeof data?.url === "string" ? data.url : null;
      if (!url) {
        setUploadError("Réponse serveur invalide");
        return;
      }
      setUrlInput(url);
      onChange(url);
      onOpenChange(false);
    } catch {
      setUploadError("Erreur réseau pendant l'envoi");
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    onChange(null);
    onOpenChange(false);
  };

  const isCurrent = (id: string) => value === id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" showClose={false}>
        <DialogHeader className="border-border/60 flex flex-row items-center justify-between border-b px-5 py-3">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <DialogClose className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors">
            <X className="h-4 w-4" />
          </DialogClose>
        </DialogHeader>

        {/* Preview + onglets */}
        <div className="flex items-center gap-4 px-5 pt-4 pb-3">
          <div className="border-border/60 flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-[var(--card)]">
            <EquipmentIcon iconUrl={value} size={36} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">
              Icône courante
            </div>
            <div className="mt-0.5 truncate text-xs font-mono">
              {value ?? <span className="text-muted-foreground italic">Aucune</span>}
            </div>
            {inheritedFrom && !value && (
              <div className="text-muted-foreground mt-0.5 text-[10px]">
                Héritée de <span className="font-semibold">{inheritedFrom}</span>
              </div>
            )}
          </div>
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Effacer
            </button>
          )}
        </div>

        <div className="border-border/60 flex gap-1 border-t border-b px-3 py-1.5">
          <TabBtn label="Bibliothèque" active={tab === "lucide"} onClick={() => setTab("lucide")} />
          <TabBtn
            label="Personnalisée"
            active={tab === "custom"}
            onClick={() => setTab("custom")}
          />
        </div>

        {/* Contenu */}
        {tab === "lucide" && (
          <div className="max-h-[420px] overflow-auto p-4">
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {BROADCAST_LUCIDE_ICONS.map(({ id, Component, label }) => {
                const current = isCurrent(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handlePickLucide(id)}
                    title={label}
                    className={cn(
                      "group relative flex aspect-square flex-col items-center justify-center gap-1 rounded-md border p-2 transition-colors",
                      current
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
                        : "border-[var(--border)]/60 bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/50 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]",
                    )}
                  >
                    <Component size={22} strokeWidth={1.6} />
                    <span className="line-clamp-1 text-[9px] leading-tight font-medium tracking-wide">
                      {label}
                    </span>
                    {current && ( // arkyo-server: habillage Strata
                      <span className="bg-[var(--accent)] absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[var(--accent-foreground)]">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === "custom" && (
          <div className="space-y-3 p-5">
            <div>
              <label className="text-muted-foreground mb-1.5 block text-[10px] font-bold tracking-widest uppercase">
                URL personnalisée
              </label>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://… ou /uploads/…"
                className="border-border/60 flex h-9 w-full rounded-md border bg-transparent px-3 font-mono text-[11px] focus:ring-1 focus:ring-[var(--accent)] focus:outline-none"
              />
              <p className="text-muted-foreground mt-1 text-[10px]">
                Colle l&apos;URL d&apos;une image SVG/PNG (héberger sur un CDN ou utiliser le bouton ci-dessous).
              </p>
            </div>

            <div className="text-muted-foreground text-center text-[10px] tracking-widest uppercase">
              ou
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/svg+xml,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.currentTarget.value = "";
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-border/60 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/5 flex w-full items-center justify-center gap-2 rounded-md border border-dashed bg-transparent px-4 py-4 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? "Envoi…" : "Téléverser un fichier"}
              </button>
              {uploadError && (
                <p className="text-destructive mt-1.5 text-[11px]">{uploadError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:bg-muted h-8 rounded-md px-3 text-[11px] font-medium transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleApplyUrl}
                // arkyo-server: habillage Strata
                className="bg-[var(--accent)] hover:opacity-90 h-8 rounded-md px-4 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity"
              >
                Appliquer
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-colors",
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
