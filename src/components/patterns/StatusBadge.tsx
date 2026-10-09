import type * as React from "react";

export type StatusTone = "neutral" | "success" | "info" | "warning" | "error";

export interface StatusBadgeProps {
  tone?: StatusTone;
  children: string;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-[var(--color-surface-pressed)] text-[var(--color-text-default)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  error: "bg-[var(--color-error-soft)] text-[var(--color-error)]",
};

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-full)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] font-[number:var(--font-weight-control)] ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
