import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "okhub-popover-motion z-50 min-w-48 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-1)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    size?: "default" | "compact";
    variant?: "default" | "destructive";
  }
>(({ className, size = "default", variant = "default", ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "flex cursor-pointer select-none items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-3)] outline-none transition-colors duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] data-[disabled]:cursor-not-allowed data-[disabled]:text-[var(--color-text-disabled)] [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
      size === "compact" ? "min-h-[var(--space-8)]" : "min-h-[var(--control-height)]",
      variant === "destructive"
        ? "text-[var(--color-error)] data-[highlighted]:bg-[var(--color-error-soft)] data-[highlighted]:text-[var(--color-error)]"
        : "data-[highlighted]:bg-[var(--color-canvas)] data-[highlighted]:text-[var(--color-text-strong)]",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-[var(--space-1)] h-px bg-[var(--color-border)]", className)}
      {...props}
    />
  );
}
