import * as React from "react";
import { cn } from "@/lib/utils";

export const UnstyledButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
UnstyledButton.displayName = "UnstyledButton";
