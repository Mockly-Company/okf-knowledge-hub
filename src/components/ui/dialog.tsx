import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { X } from "lucide-react";
import { IconButton, type IconButtonProps } from "./button";
import { cn } from "@/lib/utils";
import { dialogOverlayClassName, dialogSurfaceClassName, dialogPositionClassName, dialogDefaultWidthClassName, dialogTitleClassName, dialogDescriptionClassName } from "./dialog-styles";

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
      dialogTitleClassName,
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
      dialogDescriptionClassName,
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
  size?: "default" | "wide" | "fullscreen";
};

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "default", "aria-label": ariaLabel = "Dialog", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={dialogOverlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        dialogSurfaceClassName,
        size === "fullscreen"
          ? "inset-[var(--space-6)] overflow-hidden"
          : dialogPositionClassName,
        size === "fullscreen"
          ? undefined
          : size === "wide"
          ? "w-[min(calc(100vw-3rem),47.5rem)]"
          : dialogDefaultWidthClassName,
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
