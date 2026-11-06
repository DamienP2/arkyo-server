"use client";

/**
 * InlineTypeCreator — création à la volée d'un type / sous-type de catalogue
 * (TenantType perso). Bouton « Ajouter » dashed compact ; au clic, révèle un
 * input inline (nom) + valider / annuler. Aucune ligne supplémentaire tant que
 * l'input n'est pas ouvert → préserve les layouts compacts sans scroll.
 *
 * Le composant ne connaît pas la route API : le parent fournit `onCreate` qui
 * effectue le POST (`/api/tenant/parametres/categories/type`), rafraîchit les
 * référentiels et sélectionne le type créé. Une erreur (ex. 409 doublon Arkyo)
 * remonte via la promesse rejetée et s'affiche en message inline discret.
 */

import { useState } from "react";
import { Check, Loader2, Plus, X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api-client";

export function InlineTypeCreator({
  label,
  placeholder = "Nom",
  onCreate,
  className,
}: {
  label: string;
  placeholder?: string;
  /** Effectue la création (POST + refetch + sélection). Rejette en cas d'échec. */
  onCreate: (name: string) => Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cancel = () => {
    setOpen(false);
    setValue("");
    setErr(null);
  };

  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate(name);
      setValue("");
      setOpen(false);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Échec de la création."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]",
          className,
        )}
      >
        <Plus className="h-3 w-3" />
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--card)] px-1.5 py-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          className="h-6 w-32 bg-transparent px-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          aria-label="Valider"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          aria-label="Annuler"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] disabled:opacity-40"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
      {err && (
        // arkyo-server: habillage Strata
        <span className="text-[10px] leading-tight text-[var(--danger-text)]">
          {err}
        </span>
      )}
    </span>
  );
}

/**
 * PersonalTypeDot — repère visuel « perso » : petite pastille pleine, hérite de
 * la couleur du texte (`bg-current`) donc lisible sur tous les fonds (pill
 * active accent incluse). Rendu uniquement pour les types personnels (source
 * PERSONAL) ; les types Arkyo n'affichent aucun repère.
 */
export function PersonalTypeDot({ className }: { className?: string }) {
  // arkyo-server: catalogue unique (tous les types sont PERSONAL) — repère
  // « perso » (badge Arkyo/perso) retiré : la pastille ne s'affiche plus.
  return null;
  return (
    <span
      title="Type personnel"
      aria-label="Type personnel"
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80",
        className,
      )}
    />
  );
}
