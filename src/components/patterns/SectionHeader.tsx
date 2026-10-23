import type * as React from "react";

export interface SectionHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  titleId?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  titleId,
}: SectionHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-[var(--space-4)]">
      <div className="min-w-0">
        <h2
          id={titleId}
          className="m-0 text-[length:var(--font-section-size)] leading-[var(--font-section-line)] font-[number:var(--font-weight-section-title)] text-[var(--color-text-strong)]"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-[var(--space-1)] font-[number:var(--font-weight-description)] text-[var(--color-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex gap-[var(--space-2)]">{actions}</div>
      ) : null}
    </header>
  );
}
