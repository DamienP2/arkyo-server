"use client";

/**
 * FormDialog — wrapper Dialog + react-hook-form + Zod au style Broadcast Hub.
 *
 * Layout issu des captures `CAPTURES/modal_add_edit.png` :
 *  - Header : badge icône accent + titre + eyebrow ALL CAPS accent + bouton X
 *  - Séparateur header / body
 *  - Body : padding généreux, slots `FormSection` pour les labels caps
 *  - Footer : grid 2 colonnes (Annuler / action), boutons pleine largeur
 *
 * Factorise le boilerplate de tous les formulaires en modale :
 *  - useForm + zodResolver
 *  - reset automatique à l'ouverture / quand defaultValues change
 *  - gestion de l'état de soumission (bouton disabled + label "…")
 *  - fermeture automatique en cas de succès
 *  - rétention de l'ouverture + message d'erreur inline si onSubmit throw
 *
 * Usage :
 *
 *   <FormDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     icon={<Waveform />}
 *     eyebrow="AUDIO"
 *     title="Nouveau signal"
 *     schema={schema}
 *     defaultValues={{ name: "" }}
 *     onSubmit={async (values) => { await api.post("/api/signals", values); }}
 *     submitLabel="Créer le signal"
 *     trigger={<Button>Nouveau signal</Button>}
 *   >
 *     {(form) => (
 *       <FormSection title="Nom *">
 *         <Input {...form.register("name")} />
 *       </FormSection>
 *     )}
 *   </FormDialog>
 *
 * L'erreur serveur (ApiError ou autre throw) est exposée via
 * `form.formState.errors.root?.serverError?.message` et automatiquement
 * rendue au-dessus des boutons d'action.
 */

import * as React from "react";
import {
  useForm,
  type UseFormReturn,
  type FieldValues,
  type DefaultValues,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny } from "zod";
import { HelpCircle, Loader2 } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";

// ── Types ────────────────────────────────────────────────────────────────────

type FormDialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

const SIZE_CLASSES: Record<FormDialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  "2xl": "max-w-6xl",
  "3xl": "max-w-7xl",
};

export type FormDialogProps<TValues extends FieldValues> = {
  /** Ouverture contrôlée. */
  open: boolean;
  /** Callback de changement d'ouverture (Radix). */
  onOpenChange: (open: boolean) => void;
  /** Titre affiché dans le header (bold, taille base). */
  title: string;
  /**
   * Eyebrow ALL CAPS rendu sous le titre en couleur d'accent — utile pour
   * indiquer une catégorie ou un type (ex. "AUDIO", "PROJET", "ÉQUIPEMENT").
   */
  eyebrow?: string;
  /**
   * Icône affichée dans le badge coloré à gauche du titre. Passer un élément
   * lucide-react ou tout autre ReactNode — la taille est forcée à 20px.
   */
  icon?: React.ReactNode;
  /** Description optionnelle sous le titre (petite, mutée). */
  description?: string;
  /** Schéma Zod de validation. Son `output` doit matcher `TValues`. */
  schema: ZodTypeAny;
  /** Valeurs par défaut. Le form est reseté à chaque passage de closed → open. */
  defaultValues: DefaultValues<TValues>;
  /**
   * Handler de soumission. Si throw (ApiError ou autre Error), le dialog
   * reste ouvert et le message est affiché en bas du formulaire via
   * `form.setError("root.serverError", …)`.
   * Si résout, le dialog se ferme automatiquement.
   */
  onSubmit: (values: TValues) => Promise<void> | void;
  /** Render prop qui reçoit l'instance `useFormReturn`. */
  children: (form: UseFormReturn<TValues>) => React.ReactNode;
  /** Libellé du bouton de soumission. Défaut: "Enregistrer". */
  submitLabel?: string;
  /** Libellé affiché pendant la soumission. Défaut: `${submitLabel}…`. */
  submitLoadingLabel?: string;
  /** Libellé du bouton d'annulation. Défaut: "Annuler". */
  cancelLabel?: string;
  /** Variante visuelle du bouton submit. Défaut: "accent". */
  submitVariant?: React.ComponentProps<typeof Button>["variant"];
  /**
   * Force la désactivation du bouton submit (en plus de `isSubmitting`).
   * Utile pour bloquer la soumission tant qu'une validation custom (anti-
   * doublon temps réel, par exemple) n'est pas résolue.
   */
  submitDisabled?: boolean;
  /** Taille max-width. Défaut: "md" (= max-w-lg). */
  size?: FormDialogSize;
  /** Déclencheur optionnel (ex. <Button>Nouveau…</Button>). */
  trigger?: React.ReactNode;
  /** Classes CSS additionnelles sur le DialogContent. */
  className?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrait un message utilisateur à partir d'une erreur levée par `onSubmit`.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.body && typeof error.body === "object") {
      const body = error.body as { error?: unknown; message?: unknown };
      if (typeof body.error === "string" && body.error.length > 0) return body.error;
      if (typeof body.message === "string" && body.message.length > 0) return body.message;
    }
    if (typeof error.body === "string" && error.body.length > 0) return error.body;
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Une erreur est survenue. Merci de réessayer.";
}

// ── FormSection (helper public) ──────────────────────────────────────────────

/**
 * Section à l'intérieur d'un FormDialog : label en ALL CAPS tracking wide
 * suivi de son contenu. Cohérent avec la capture `modal_add_edit.png`.
 *
 *   <FormSection title="Connecteurs compatibles">
 *     <ConnectorPicker ... />
 *   </FormSection>
 */
export function FormSection({
  title,
  tooltip,
  children,
  className,
}: {
  title?: React.ReactNode;
  /** Petit icône `?` accolé au titre. Tooltip visuel custom (CSS group-hover,
   *  fond card + bordure + shadow) apparaissant immédiatement au survol. */
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {title ? (
        <h3 className="flex items-center gap-1 text-[0.7rem] font-semibold tracking-wider text-[var(--foreground)]/80 uppercase">
          <span>{title}</span>
          {tooltip ? <HelpTooltip text={tooltip} /> : null}
        </h3>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Petit picto `?` + tooltip visuel custom. Apparait immédiatement au hover
 * (pas le délai navigateur du `title` attribute), positionné en absolute
 * au-dessus de l'icône, fond `var(--popover)` / bordure / shadow.
 *
 * Pattern CSS-only via `group` Tailwind — pas de JS, pas de dépendance.
 */
export function HelpTooltip({ text }: { text: string }) {
  return (
    <span
      className="group relative inline-flex cursor-help items-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      aria-label={text}
    >
      <HelpCircle className="h-3 w-3" strokeWidth={1.75} />
      <span
        role="tooltip"
        className={cn(
          // positionnement : juste au-dessus du ?, centré horizontalement
          "absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2",
          // contenu : box card sombre/clair avec bordure et shadow
          "pointer-events-none w-max max-w-[280px] rounded-md border border-[var(--border)] bg-[var(--popover,var(--card))] px-2.5 py-1.5",
          // typographie : tracking normal, casse normale, lisible
          "text-[10.5px] leading-snug font-medium normal-case tracking-normal text-[var(--popover-foreground,var(--foreground))]",
          // shadow + transition apparition immédiate
          "shadow-md transition-opacity duration-100",
          "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      >
        {text}
      </span>
    </span>
  );
}

// ── FormDialog ───────────────────────────────────────────────────────────────

// arkyo-server: habillage Strata
export function FormDialog<TValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  eyebrow,
  icon,
  description,
  schema,
  defaultValues,
  onSubmit,
  children,
  submitLabel = "Enregistrer",
  submitLoadingLabel,
  cancelLabel = "Annuler",
  submitVariant = "accent",
  submitDisabled = false,
  size = "md",
  trigger,
  className,
}: FormDialogProps<TValues>) {
  // zodResolver est typé avec des surcharges qui contraignent fortement
  // `_input extends FieldValues`. Comme `TValues` est déterminé côté appelant
  // par l'annotation de `onSubmit` / `defaultValues`, on normalise explicitement
  // le schéma vers la forme attendue par zodResolver. Le cast est purement TS.
  const resolver = zodResolver(
    schema as unknown as Parameters<typeof zodResolver>[0],
  ) as unknown as Resolver<TValues>;

  const form = useForm<TValues>({
    resolver,
    defaultValues,
  });

  const {
    handleSubmit,
    reset,
    clearErrors,
    setError,
    formState: { isSubmitting, errors },
  } = form;

  // Reset à chaque passage de closed → open, ou quand defaultValues change
  // pendant que le dialog est ouvert (ex. bascule entre édition et création).
  const lastDefaultsRef = React.useRef<DefaultValues<TValues> | null>(null);

  React.useEffect(() => {
    if (!open) {
      lastDefaultsRef.current = null;
      return;
    }
    if (lastDefaultsRef.current !== defaultValues) {
      reset(defaultValues);
      clearErrors();
      lastDefaultsRef.current = defaultValues;
    }
  }, [open, defaultValues, reset, clearErrors]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && isSubmitting) return;
      onOpenChange(next);
    },
    [isSubmitting, onOpenChange],
  );

  const submit = handleSubmit(async (values) => {
    clearErrors("root.serverError");
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message: extractErrorMessage(error),
      });
    }
  });

  const rootError = errors.root?.serverError?.message;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className={cn("p-0", SIZE_CLASSES[size], className)}>
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5 pr-14">
          {icon ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base leading-tight font-semibold">{title}</DialogTitle>
            {eyebrow ? (
              <p className="mt-1 text-[0.7rem] font-semibold tracking-wider text-[var(--accent)] uppercase">
                {eyebrow}
              </p>
            ) : null}
            {description ? (
              <DialogDescription className="mt-1.5 text-sm text-[var(--muted-foreground)]">
                {description}
              </DialogDescription>
            ) : null}
          </div>
        </div>

        <form onSubmit={submit} method="post" noValidate className="flex flex-col">
          {/* Body */}
          <div className="space-y-5 px-6 py-5">
            {children(form)}

            {rootError ? (
              <p
                role="alert"
                className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]"
              >
                {rootError}
              </p>
            ) : null}
          </div>

          {/* Footer */}
          <div className="grid grid-cols-2 gap-3 px-6 pb-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={submitVariant}
              disabled={isSubmitting || submitDisabled}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  {submitLoadingLabel ?? `${submitLabel}…`}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
