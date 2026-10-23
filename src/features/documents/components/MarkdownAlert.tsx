import {
  BadgeAlert,
  Info as CircleInfo,
  Lightbulb,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MarkdownAlertKind } from "../remark-okhub-blocks";

const alertIcons: Record<MarkdownAlertKind, LucideIcon> = {
  note: CircleInfo,
  tip: Lightbulb,
  important: BadgeAlert,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

export interface MarkdownAlertProps {
  kind: MarkdownAlertKind;
  children: ReactNode;
}

export function MarkdownAlert({ kind, children }: MarkdownAlertProps) {
  const Icon = alertIcons[kind];

  return (
    <aside className={`markdown-alert markdown-alert--${kind}`} role="note">
      <span className="markdown-alert__icon" aria-hidden="true">
        <Icon aria-hidden="true" strokeWidth={1.75} />
      </span>
      <div className="markdown-alert__content">
        <span className="markdown-alert__label">{kind.toUpperCase()}</span>
        {children}
      </div>
    </aside>
  );
}
