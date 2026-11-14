import { formatAssigneeBadgeLabel } from "./assigneeFilter";
import type { BoardAssignee } from "./model";

export function IssueAssigneeBadge({
  assignees,
}: {
  assignees?: ReadonlyArray<BoardAssignee>;
}) {
  const list = assignees ?? [];
  const label = formatAssigneeBadgeLabel(list);
  return (
    <span
      className={
        list.length > 0
          ? "inline-flex items-center rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] font-[number:var(--font-weight-control)] text-[var(--color-text-default)]"
          : "inline-flex items-center rounded-[var(--radius-full)] bg-[var(--color-surface-pressed)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]"
      }
    >
      {label}
    </span>
  );
}
