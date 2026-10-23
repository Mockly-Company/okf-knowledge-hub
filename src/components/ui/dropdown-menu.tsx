import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
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

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex min-h-[var(--control-height)] cursor-pointer select-none items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-3)] outline-none transition-colors duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] data-[highlighted]:bg-[var(--color-canvas)] data-[highlighted]:text-[var(--color-text-strong)] data-[state=open]:bg-[var(--color-canvas)] data-[state=open]:text-[var(--color-text-strong)] [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" aria-hidden="true" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
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
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "flex min-h-[var(--control-height)] cursor-pointer select-none items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-3)] outline-none transition-colors duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] data-[highlighted]:bg-[var(--color-canvas)] data-[highlighted]:text-[var(--color-text-strong)] [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
      className,
    )}
    {...props}
  >
    {children}
    <DropdownMenuPrimitive.ItemIndicator className="ml-auto">
      <Check aria-hidden="true" />
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

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
