import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-w-0 cursor-text rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-[number:var(--font-weight-description)] text-[length:var(--font-document-size)] leading-[var(--font-document-line)] text-[var(--color-text-default)] transition-[border-color,background-color,color] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] hover:border-[var(--color-border-hover)] focus-visible:border-[var(--color-primary)] aria-[invalid=true]:border-[var(--color-error)] aria-[invalid=true]:focus-visible:border-[var(--color-error)] disabled:cursor-not-allowed disabled:bg-[var(--color-control-disabled)] disabled:text-[var(--color-text-disabled)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
