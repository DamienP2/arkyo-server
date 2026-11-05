"use client";

/**
 * WizardBackdrop / ProgressBar / WizardKeyframes — primitives partagées
 * pour les wizards multi-étapes design (ex. NewProjectDialog, AddContainerWizard).
 *
 * Extrait depuis `components/projects/new-project-dialog.tsx` pour pouvoir
 * être réutilisé sur d'autres wizards (contenants, panels…) sans dupliquer
 * les blobs flous + grille de dots + animations.
 *
 * Composants exportés :
 *   - <WizardBackdrop variant="intense|discreet"> — blobs flous + grille
 *   - <ProgressBar progressIndex total>          — barre h-1 + "Étape X sur N"
 *   - <WizardKeyframes />                         — <style> avec blob-pulse,
 *                                                   mockup-float, sparkle-twinkle
 */

import { cn } from "@/lib/utils";

// ─── WizardBackdrop ─────────────────────────────────────────────────────────

/**
 * Calque décoratif persistant derrière toutes les étapes d'un wizard.
 *
 * Variants :
 *  - "intense"  → blobs très visibles + grille de dots + animation pulse.
 *                 À utiliser sur l'étape 0 (intro) pour l'effet "wow".
 *  - "discreet" → blobs très atténués (opacité divisée par ~3-4), pas d'animation.
 *                 Maintient la signature visuelle de l'intro sur les autres
 *                 étapes sans détourner l'attention du formulaire.
 */
export function WizardBackdrop({
  variant,
}: {
  variant: "intense" | "discreet";
}) {
  const intense = variant === "intense";
  // Opacités selon variant
  const op1 = intense ? 0.55 : 0.16;
  const op2 = intense ? 0.55 : 0.16;
  const op3 = intense ? 0.5 : 0.14;
  const dotsOp = intense ? 0.3 : 0.18;
  const blobMax = intense ? 0.7 : 0.22;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {/* Blob 1 — violet, haut-gauche */}
      <div
        className="absolute -top-20 -left-16 h-72 w-72 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, rgb(139 92 246 / ${op1}), transparent 70%)`,
          opacity: op1,
          ...(intense
            ? {
                animation: "blob-pulse 8s ease-in-out infinite",
                ["--blob-op" as string]: op1,
                ["--blob-op-max" as string]: blobMax,
              }
            : null),
        }}
      />
      {/* Blob 2 — bleu accent, droite */}
      <div
        className="absolute top-10 -right-20 h-80 w-80 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, rgb(59 130 246 / ${op2}), transparent 70%)`,
          opacity: op2,
          ...(intense
            ? {
                animation: "blob-pulse 10s ease-in-out infinite",
                animationDelay: "1.5s",
                ["--blob-op" as string]: op2,
                ["--blob-op-max" as string]: blobMax,
              }
            : null),
        }}
      />
      {/* Blob 3 — emerald, bas */}
      <div
        className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, rgb(16 185 129 / ${op3}), transparent 70%)`,
          opacity: op3,
          ...(intense
            ? {
                animation: "blob-pulse 12s ease-in-out infinite",
                animationDelay: "3s",
                ["--blob-op" as string]: op3,
                ["--blob-op-max" as string]: blobMax,
              }
            : null),
        }}
      />

      {/* Grille de dots subtile (toujours présente, plus prononcée intense) */}
      <div
        className="absolute inset-0"
        style={{
          opacity: dotsOp,
          backgroundImage:
            "radial-gradient(circle, rgb(0 0 0 / 0.08) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
    </div>
  );
}

// ─── WizardKeyframes ────────────────────────────────────────────────────────

/**
 * Bloc <style> avec les keyframes utilisées par WizardBackdrop + mockups
 * IntroStep + sparkle des badges. À monter dans le DialogContent d'un wizard.
 */
export function WizardKeyframes() {
  return (
    <style>{`
      @keyframes blob-pulse {
        0%, 100% { transform: translate(0, 0) scale(1); opacity: var(--blob-op, 0.5); }
        50% { transform: translate(15px, -10px) scale(1.08); opacity: var(--blob-op-max, 0.7); }
      }
      @keyframes mockup-float {
        0%, 100% { transform: translateY(0) rotate(var(--rot, 0deg)); }
        50% { transform: translateY(-8px) rotate(var(--rot, 0deg)); }
      }
      @keyframes sparkle-twinkle {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.85); }
      }
    `}</style>
  );
}

// ─── ProgressBar ────────────────────────────────────────────────────────────

/**
 * Barre de progression linéaire (h-1) + libellé "Étape X sur N" discret.
 * Le wizard pilote `progressIndex` et `total` selon ses étapes (intro non
 * comptée).
 */
export function ProgressBar({
  progressIndex,
  total,
  className,
}: {
  progressIndex: number;
  total: number;
  className?: string;
}) {
  const pct = Math.round((progressIndex / total) * 100);
  return (
    <div className={cn("mx-auto max-w-md", className)}>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--secondary)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-center text-[10px] font-medium tracking-wider text-[var(--muted-foreground)] uppercase">
        Étape {progressIndex} sur {total}
      </p>
    </div>
  );
}

// ─── StepHeader ─────────────────────────────────────────────────────────────

/**
 * Header standard d'étape : titre H3 centré + sous-texte muted facultatif.
 * Utilisé en haut du body de chaque étape pour homogénéiser l'aspect du wizard.
 */
export function WizardStepHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6 text-center">
      <h3 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
        {title}
      </h3>
      {subtitle && (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-snug text-[var(--muted-foreground)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
