import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// arkyo-server: habillage Strata
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--muted)] text-[var(--text-tertiary)]",
        accent: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
        success: "bg-[var(--success)]/15 text-[var(--success-text)]",
        warning: "bg-[var(--warning)]/15 text-[var(--warning-text)]",
        destructive: "bg-[var(--danger)]/15 text-[var(--danger)]",
        outline: "border border-[var(--border)] text-[var(--foreground)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
