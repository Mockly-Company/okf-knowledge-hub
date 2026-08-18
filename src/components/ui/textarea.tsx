import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[length:var(--font-document-size)] leading-[var(--font-document-line)] text-[var(--color-text-default)] transition-colors duration-150 hover:border-[var(--color-border-hover)] disabled:cursor-not-allowed disabled:bg-[var(--color-control-disabled)] disabled:text-[var(--color-text-disabled)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
