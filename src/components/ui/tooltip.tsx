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
            className="okhub-popover-motion z-50 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-default)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--color-surface)] stroke-[var(--color-border)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
