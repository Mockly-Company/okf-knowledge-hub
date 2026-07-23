import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex h-[var(--control-height)] items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-hover)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-strong)] hover:bg-[var(--color-canvas)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-default)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary-text)]",
        destructive:
          "border-transparent bg-[var(--color-error-soft)] text-[var(--color-error)] hover:bg-[var(--color-error-hover)]",
        icon:
          "w-[var(--control-height)] border-transparent bg-transparent p-0 text-[var(--color-text-default)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary-text)]",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        data-variant={variant}
        className={cn(buttonVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
