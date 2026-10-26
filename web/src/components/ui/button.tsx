"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// arkyo-server: habillage Strata
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-all duration-150 outline-none focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-strong)]",
        destructive:
          "bg-[#e11d48] text-white hover:opacity-90",
        outline:
          "border border-[var(--border-strong)] bg-[var(--surface-raised)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
        secondary: "border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--muted)]",
        ghost: "hover:bg-[var(--secondary)] hover:text-[var(--secondary-foreground)]",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
        accent: "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-strong)]",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-lg px-2.5 text-xs",
        lg: "h-11 rounded-lg px-8 text-base",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
