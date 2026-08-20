import type * as React from "react";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  titleId?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  titleId,
}: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-[var(--space-4)]">
      <div className="min-w-0">
        <h1
          id={titleId}
          className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)]"
        >
          {title}
        </h1>
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
