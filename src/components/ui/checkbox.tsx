import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-4 cursor-pointer accent-[var(--color-primary)] transition-[accent-color,outline-color] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] disabled:cursor-not-allowed disabled:accent-[var(--color-text-disabled)]",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
