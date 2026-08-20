import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-[var(--control-height)] min-w-0 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-[number:var(--font-weight-description)] text-[var(--color-text-strong)] transition-colors duration-150 hover:border-[var(--color-border-hover)] disabled:cursor-not-allowed disabled:bg-[var(--color-control-disabled)] disabled:text-[var(--color-text-disabled)]",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";
