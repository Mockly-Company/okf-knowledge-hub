import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useLayoutEffect, useState, type PropsWithChildren, type ReactNode } from "react";

interface TooltipProps extends PropsWithChildren {
  content: ReactNode;
  followCursor?: boolean;
}

export function Tooltip({ content, children, followCursor = false }: TooltipProps) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!bubble) return;
    if (!followCursor || !pointer) {
      bubble.style.position = "";
      bubble.style.left = "";
      bubble.style.top = "";
      return;
    }
    const place = () => {
      const wrapper = bubble.parentElement;
      if (!wrapper) return;
      const margin = 8;
      const gap = 12;
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, pointer.x + gap + width > window.innerWidth - margin ? pointer.x - width - gap : pointer.x + gap));
      const top = Math.max(margin, Math.min(window.innerHeight - height - margin, pointer.y + gap + height > window.innerHeight - margin ? pointer.y - height - gap : pointer.y + gap));
      const origin = wrapper.getBoundingClientRect();
      // Keep Radix's accessibility/lifecycle and offset only the visible bubble
      // inside its positioned wrapper. Keyboard focus uses the normal anchor.
      bubble.style.position = "relative";
      bubble.style.left = `${left - origin.left}px`;
      bubble.style.top = `${top - origin.top}px`;
    };
    place();
    // Radix may finish placing its wrapper after this layout effect. Track the
    // wrapper while visible so initial placement, scrolling and resizing agree.
    let frame = 0;
    const track = () => { place(); frame = requestAnimationFrame(track); };
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [bubble, pointer, followCursor]);
  const trigger = <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>;
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <TooltipPrimitive.Root>
        {followCursor ? <span style={{ display: "contents" }} onPointerMoveCapture={event => { if (event.pointerType === "mouse") setPointer({ x: event.clientX, y: event.clientY }); }} onFocusCapture={() => setPointer(null)}>{trigger}</span> : trigger}
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            ref={setBubble}
            sideOffset={6}
            collisionPadding={followCursor ? 8 : undefined}
            style={followCursor ? { maxWidth: "calc(100vw - 16px)" } : undefined}
            className="okhub-popover-motion z-50 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-default)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none"
          >
            {content}
            {(!followCursor || !pointer) && <TooltipPrimitive.Arrow className="fill-[var(--color-surface)] stroke-[var(--color-border)]" />}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
