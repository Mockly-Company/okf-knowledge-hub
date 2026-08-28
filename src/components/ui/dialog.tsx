import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { X } from "lucide-react";
import { IconButton, type IconButtonProps } from "./button";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogCloseButtonProps = Omit<IconButtonProps, "children">;

export function DialogCloseButton({
  className,
  label,
  ...props
}: DialogCloseButtonProps) {
  return (
    <DialogClose asChild>
      <IconButton
        {...props}
        label={label}
        tooltip={false}
        className={cn(
          "!size-[var(--font-section-line)] hover:!bg-[var(--color-canvas)] hover:!text-[var(--color-text-strong)] active:!bg-[var(--color-surface-pressed)] focus-visible:!border-transparent",
          className,
        )}
      >
        <X aria-hidden="true" strokeWidth={1.75} />
      </IconButton>
    </DialogClose>
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "m-0 font-[number:var(--font-weight-section-title)] text-[length:var(--font-section-size)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      "m-0 mt-[var(--space-1)] font-[number:var(--font-weight-description)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]",
      className,
    )}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export function DialogHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"header">) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-start justify-between gap-[var(--space-3)]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"footer">) {
  return (
    <footer
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-[var(--space-2)]",
        className,
      )}
      {...props}
    />
  );
}

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: "default" | "wide";
};

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "default", "aria-label": ariaLabel = "Dialog", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="okhub-dialog-overlay-motion fixed inset-0 z-50 bg-[var(--color-overlay)] transition-opacity duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none" />
    <DialogPrimitive.Content
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        "okhub-dialog-content-motion fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--dialog-padding)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none",
        size === "wide"
          ? "w-[min(calc(100vw-3rem),47.5rem)]"
          : "w-[min(calc(100vw-3rem),35rem)]",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
