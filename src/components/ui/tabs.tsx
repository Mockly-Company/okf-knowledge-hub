import * as React from "react";
import { cn } from "@/lib/utils";

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

interface TabsTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  selected: boolean;
}

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  TabsTriggerProps
>(({ className, selected, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="tab"
    aria-selected={selected}
    className={cn(
      "cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-3 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-canvas)] disabled:cursor-not-allowed disabled:text-[var(--color-text-disabled)]",
      selected &&
        "bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-text)]",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";
