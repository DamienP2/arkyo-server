import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        accent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        success: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
        warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        destructive: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
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
