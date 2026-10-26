"use client";

import { useState } from "react";
import { RefreshCw } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

interface CatalogResyncButtonProps {
  entityType: string;
  modifiedCount: number;
  onResyncComplete?: (result: { restored: number; recreated: number }) => void;
}

export function CatalogResyncButton({
  entityType,
  modifiedCount,
  onResyncComplete,
}: CatalogResyncButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (modifiedCount === 0) return null;

  async function handleResync() {
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType }),
      });
      const result = await res.json();
      onResyncComplete?.(result);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--muted-foreground)]">
          Restaurer {modifiedCount} element{modifiedCount > 1 ? "s" : ""} ?
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowConfirm(false)}
          disabled={loading}
        >
          Annuler
        </Button>
        <Button size="sm" onClick={handleResync} disabled={loading}>
          {loading ? "Resync..." : "Confirmer"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setShowConfirm(true)}
      className="gap-1.5 text-xs"
    >
      <RefreshCw className="size-3.5" />
      Resynchroniser
    </Button>
  );
}
