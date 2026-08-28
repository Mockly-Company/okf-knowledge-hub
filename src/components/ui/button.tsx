import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export const buttonVariants = cva(
  "inline-flex h-[var(--control-height)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border px-3 font-[number:var(--font-weight-control)] transition-[border-color,background-color,color] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] focus-visible:border-[var(--color-primary)] disabled:cursor-not-allowed [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--color-primary-action)] text-[var(--color-on-primary)] data-[loading=false]:hover:bg-[var(--color-primary-action-hover)] data-[loading=false]:active:bg-[var(--color-primary-action-pressed)] disabled:data-[loading=false]:bg-[var(--color-control-disabled)] disabled:data-[loading=false]:text-[var(--color-text-disabled)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-strong)] data-[loading=false]:hover:border-[var(--color-border-hover)] data-[loading=false]:hover:bg-[var(--color-canvas)] data-[loading=false]:active:border-[var(--color-border-strong)] data-[loading=false]:active:bg-[var(--color-surface-pressed)] disabled:data-[loading=false]:border-[var(--color-border)] disabled:data-[loading=false]:bg-[var(--color-control-disabled)] disabled:data-[loading=false]:text-[var(--color-text-disabled)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-default)] data-[loading=false]:hover:bg-[var(--color-primary-soft)] data-[loading=false]:hover:text-[var(--color-primary-text)] data-[loading=false]:active:bg-[var(--color-primary-soft-pressed)] disabled:data-[loading=false]:bg-transparent disabled:data-[loading=false]:text-[var(--color-text-disabled)]",
        destructive:
          "border-transparent bg-[var(--color-error-soft)] text-[var(--color-error)] data-[loading=false]:hover:bg-[var(--color-error-hover)] data-[loading=false]:active:bg-[var(--color-error-pressed)] disabled:data-[loading=false]:bg-[var(--color-control-disabled)] disabled:data-[loading=false]:text-[var(--color-text-disabled)]",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

type ButtonSharedProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> &
  VariantProps<typeof buttonVariants> & {
  "data-variant"?: string;
};

export type ButtonProps = ButtonSharedProps & (
  | { asChild?: false; loading?: boolean; disabled?: boolean }
  | { asChild: true; loading?: false; disabled?: never }
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className,
    variant = "primary",
    asChild = false,
    loading = false,
    disabled,
    onClick,
    children,
    "data-variant": dataVariant,
    ...props
  }, ref) => {
    if (asChild && loading) {
      throw new Error("Button does not support loading when asChild is true");
    }

    if (asChild && disabled) {
      throw new Error("Button does not support disabled when asChild is true");
    }

    const Component = asChild ? Slot : "button";
    return (
      <Component
        {...props}
        ref={ref}
        data-variant={dataVariant ?? variant}
        data-loading={loading}
        aria-busy={loading || undefined}
        aria-disabled={asChild && (disabled || loading) ? true : undefined}
        disabled={asChild ? undefined : disabled || loading}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (loading) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClick?.(event);
        }}
        className={cn(buttonVariants({ variant }), className)}
      >
        {loading ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} />
        ) : null}
        <Slottable>{children}</Slottable>
      </Component>
    );
  },
);
Button.displayName = "Button";

const iconButtonClassName =
  "w-[var(--control-height)] border-transparent bg-[var(--color-surface)] p-0 text-[var(--color-text-default)] data-[loading=false]:hover:!bg-[var(--color-canvas)] data-[loading=false]:hover:!text-[var(--color-text-strong)] data-[loading=false]:active:!bg-[var(--color-surface-pressed)] focus-visible:!border-transparent disabled:bg-transparent disabled:text-[var(--color-text-disabled)]";

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  tooltip?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, tooltip = true, children, ...props }, ref) => {
    if (!label.trim()) {
      throw new Error("IconButton requires a nonempty label");
    }

    const button = (
      <Button
        ref={ref}
        variant="ghost"
        data-variant="icon"
        aria-label={label}
        className={cn(iconButtonClassName, className)}
        {...props}
      >
        {children}
      </Button>
    );

    return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
  },
);
IconButton.displayName = "IconButton";
