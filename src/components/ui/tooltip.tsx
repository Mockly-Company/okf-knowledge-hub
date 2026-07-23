import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { PropsWithChildren, ReactNode } from "react";

interface TooltipProps extends PropsWithChildren {
  content: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 rounded-[var(--radius-sm)] bg-[var(--color-text-strong)] px-2 py-1 text-xs text-white shadow-[var(--shadow-overlay)]"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--color-text-strong)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
