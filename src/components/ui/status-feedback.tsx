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

const iconDiscClasses: Record<StatusFeedbackTone, string> = {
  success: "bg-[var(--color-success-icon-surface)] text-[var(--color-success)]",
  info: "bg-[var(--color-info-icon-surface)] text-[var(--color-info)]",
  warning: "bg-[var(--color-warning-icon-surface)] text-[var(--color-warning)]",
  error: "bg-[var(--color-error-icon-surface)] text-[var(--color-error)]",
};

const actionClasses: Partial<Record<StatusFeedbackTone, string>> = {
  warning:
    "[&_[data-variant]]:border [&_[data-variant]]:border-[var(--color-warning-action-border)] [&_[data-variant]]:bg-[var(--color-surface)] [&_[data-variant]]:text-[var(--color-warning-action-text)] [&_[data-variant]:hover]:bg-[var(--color-warning-soft)]",
  error:
    "[&_[data-variant]]:border [&_[data-variant]]:border-[var(--color-error-action-border)] [&_[data-variant]]:bg-[var(--color-surface)] [&_[data-variant]]:text-[var(--color-error)] [&_[data-variant]:hover]:bg-[var(--color-error-soft)]",
};

export interface StatusFeedbackProps {
  variant: StatusFeedbackVariant;
  tone: StatusFeedbackTone;
  children: ReactNode;
  action?: ReactNode;
  actionPlacement?: "stacked" | "end";
  className?: string;
}

export function StatusFeedbackTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"strong">) {
  return (
    <strong
      className={cn(
        "block font-[number:var(--font-weight-section-title)] text-[length:var(--font-group-size)] leading-[var(--font-group-line)] text-[var(--color-text-strong)]",
        className,
      )}
      {...props}
    />
  );
}

export function StatusFeedbackDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cn(
        "m-0 mt-[var(--space-1)] font-[number:var(--font-weight-description)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-default)]",
        className,
      )}
      {...props}
    />
  );
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
  const inlineAction = actionPlacement === "end" && (variant === "banner" || variant === "content");
  const usesToastDensity = variant === "toast" || Boolean(action);
  const actionElement = action ? (
    <div
      data-feedback-action
      className={cn(
        "flex flex-wrap gap-[var(--space-2)]",
        inlineAction && "col-span-2 row-start-2 justify-self-end sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-self-auto",
        !inlineAction && "mt-[var(--space-3)]",
        actionClasses[tone],
      )}
    >
      {action}
    </div>
  ) : null;

  return (
    <section
      role={role}
      data-feedback-variant={variant}
      data-feedback-tone={tone}
      data-feedback-action-placement={inlineAction ? "end" : undefined}
      aria-live={variant === "toast" ? "polite" : undefined}
      aria-atomic={variant === "toast" ? "true" : undefined}
      className={cn(
        inlineAction
          ? "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-[var(--space-3)] border sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          : "flex items-center gap-[var(--space-3)] border",
        usesToastDensity && "min-h-[68px] rounded-[var(--radius-md)] p-[var(--space-3)] shadow-[var(--shadow-feedback)]",
        variant === "banner" && !usesToastDensity && "rounded-[var(--radius-lg)] p-[var(--space-4)]",
        variant === "content" && !usesToastDensity && "rounded-[var(--radius-lg)] p-[var(--space-6)]",
        toneClasses[tone],
        className,
      )}
    >
      <span
        data-feedback-icon
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[var(--radius-full)]",
          iconDiscClasses[tone],
        )}
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1",
        )}
      >
        <div className="text-[var(--color-text-default)]">{children}</div>
        {!inlineAction && actionElement}
      </div>
      {inlineAction ? actionElement : null}
    </section>
  );
}
