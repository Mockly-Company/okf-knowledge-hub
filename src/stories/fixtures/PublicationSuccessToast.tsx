import { useEffect, useState, type ReactNode } from "react";
import { StatusFeedback } from "@/components/ui/status-feedback";

export function PublicationSuccessToast({ message, action, className = "" }: { message: string; action?: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(Boolean(message));
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setVisible(Boolean(message));
    if (!message || paused) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [message, paused]);
  if (!message || !visible) return null;
  return <div className={`fixed right-[var(--space-4)] bottom-[var(--space-4)] z-50 w-max max-w-[min(420px,calc(100vw-32px))] ${className}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}><StatusFeedback variant="toast" tone="success" action={action}>{message}</StatusFeedback></div>;
}
