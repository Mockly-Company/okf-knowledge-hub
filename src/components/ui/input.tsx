import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-[var(--control-height)] min-w-0 cursor-text rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-[number:var(--font-weight-description)] text-[var(--color-text-strong)] transition-[border-color,background-color,color] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] hover:border-[var(--color-border-hover)] focus-visible:border-[var(--color-primary)] aria-[invalid=true]:border-[var(--color-error)] aria-[invalid=true]:focus-visible:border-[var(--color-error)] disabled:cursor-not-allowed disabled:bg-[var(--color-control-disabled)] disabled:text-[var(--color-text-disabled)]",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
