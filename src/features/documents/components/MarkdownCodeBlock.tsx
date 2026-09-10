import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";
import { Button } from "@/components/ui/button";

const lowlight = createLowlight(common);

interface HighlightNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string | string[] };
  children?: HighlightNode[];
}

export interface MarkdownCodeBlockProps {
  language?: string;
  source: string;
  searchMatch?: { start: number; end: number };
  onCopy(value: string): Promise<void>;
  id?: string;
  "data-okhub-block-id"?: string;
}

interface HighlightContext {
  offset: number;
  searchMatch: MarkdownCodeBlockProps["searchMatch"];
  markedTarget: boolean;
}

function highlightedNode(node: HighlightNode, key: string, context: HighlightContext): ReactNode {
  if (node.type === "text") {
    const value = node.value ?? "";
    const offset = context.offset;
    context.offset += value.length;
    const match = context.searchMatch;
    if (!match || match.end <= offset || match.start >= context.offset) return value;
    const start = Math.max(0, match.start - offset);
    const end = Math.min(value.length, match.end - offset);
    const isTarget = !context.markedTarget;
    context.markedTarget = true;
    return (
      <Fragment key={key}>
        {value.slice(0, start)}
        <mark className="markdown-code-block__search-match" data-search-match={isTarget ? "" : undefined}>{value.slice(start, end)}</mark>
        {value.slice(end)}
      </Fragment>
    );
  }
  if (node.type !== "element" || node.tagName !== "span") return null;

  const className = Array.isArray(node.properties?.className)
    ? node.properties.className.join(" ")
    : node.properties?.className;
  return (
    <span key={key} className={className}>
      {(node.children ?? []).map((child, index) => highlightedNode(child, `${key}-${index}`, context))}
    </span>
  );
}

function highlightedSource(source: string, language?: string, searchMatch?: MarkdownCodeBlockProps["searchMatch"]): ReactNode {
  let nodes: HighlightNode[] = [{ type: "text", value: source }];
  try {
    if (language && lowlight.registered(language)) {
      nodes = lowlight.highlight(language, source).children as HighlightNode[];
    }
  } catch {
    // Unknown or rejected syntax remains selectable, searchable plain text.
  }
  const context: HighlightContext = { offset: 0, searchMatch, markedTarget: false };
  return nodes.map((node, index) => highlightedNode(node, String(index), context));
}

export function MarkdownCodeBlock({
  language,
  source,
  searchMatch,
  onCopy,
  id,
  "data-okhub-block-id": blockId,
}: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    window.clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    try {
      await onCopy(source);
      window.clearTimeout(resetTimer.current);
      setCopied(true);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="markdown-code-block" id={id} data-okhub-block-id={blockId}>
      <header className="markdown-code-block__header">
        <span className="markdown-code-block__language">{language ?? "text"}</span>
        <Button variant="ghost" className="h-auto font-normal" type="button" onClick={() => void copy()}>
          {copied ? "복사됨" : "코드 복사"}
        </Button>
      </header>
      <div className="markdown-code-block__scroll" tabIndex={0} role="region" aria-label="코드 가로 스크롤">
        <pre><code className="markdown-code-block__code">{highlightedSource(source, language, searchMatch)}</code></pre>
      </div>
    </section>
  );
}
