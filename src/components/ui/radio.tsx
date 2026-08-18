import * as React from "react";
import { cn } from "@/lib/utils";

export const Radio = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="radio"
    className={cn(
      "size-4 cursor-pointer accent-[var(--color-primary)] disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
Radio.displayName = "Radio";
