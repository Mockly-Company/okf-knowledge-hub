import type { ComponentPropsWithoutRef } from "react";

export interface MarkdownTableProps extends ComponentPropsWithoutRef<"table"> {
  "data-okhub-block-id"?: string;
}

export function MarkdownTable({
  id,
  className,
  children,
  "data-okhub-block-id": blockId,
  ...props
}: MarkdownTableProps) {
  return (
    <div
      className="markdown-table-scroll"
      id={id}
      data-okhub-block-id={blockId}
      tabIndex={0}
      aria-label="표 가로 스크롤"
    >
      <table {...props} className={className}>{children}</table>
    </div>
  );
}
