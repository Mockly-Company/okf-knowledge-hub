import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusFeedbackVariant = "field" | "toast" | "banner" | "content";
type StatusFeedbackTone = "success" | "info" | "warning" | "error";

const toneClasses: Record<StatusFeedbackTone, string> = {
  success: "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
  info: "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  warning: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  error: "border-[var(--color-error)] bg-[var(--color-error-soft)] text-[var(--color-error)]",
};

const icons = {
  success: CircleCheck,
  info: Info,
  warning: CircleAlert,
  error: CircleAlert,
} satisfies Record<StatusFeedbackTone, typeof CircleAlert>;

export interface StatusFeedbackProps {
  variant: StatusFeedbackVariant;
  tone: StatusFeedbackTone;
  children: ReactNode;
  action?: ReactNode;
  actionPlacement?: "stacked" | "end";
  className?: string;
}

export function StatusFeedback({
  variant,
  tone,
  children,
  action,
  actionPlacement = "stacked",
  className,
}: StatusFeedbackProps) {
  if (variant === "field") {
    return (
      <p role="alert" className={cn("m-0 text-[var(--color-error)]", className)}>
        {children}
      </p>
    );
  }

  const Icon = icons[tone];
  const role = variant === "toast" ? "status" : tone === "error" ? "alert" : "status";
  const inlineBannerAction = variant === "banner" && actionPlacement === "end";

  return (
    <section
      role={role}
      data-feedback-variant={variant}
      data-feedback-tone={tone}
      data-feedback-action-placement={inlineBannerAction ? "end" : undefined}
      aria-live={variant === "toast" ? "polite" : undefined}
      aria-atomic={variant === "toast" ? "true" : undefined}
      className={cn(
        "flex items-start gap-[var(--space-3)] border",
        variant === "toast" && "rounded-[var(--radius-md)] p-[var(--space-3)] shadow-[var(--shadow-popover)]",
        variant === "banner" && "rounded-[var(--radius-lg)] p-[var(--space-4)]",
        variant === "content" && "rounded-[var(--radius-lg)] p-[var(--space-6)]",
        toneClasses[tone],
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-full)] bg-[var(--color-surface)]/70">
        <Icon aria-hidden="true" className="size-[var(--icon-size)]" strokeWidth={1.75} />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 gap-[var(--space-3)]",
          inlineBannerAction
            ? "flex flex-col md:flex-row md:items-center md:justify-between"
            : "grid",
        )}
      >
        <div className="text-[var(--color-text-default)]">{children}</div>
        {action ? (
          <div
            className={cn(
              "flex flex-wrap gap-[var(--space-2)]",
              inlineBannerAction && "shrink-0",
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
    </section>
  );
}
