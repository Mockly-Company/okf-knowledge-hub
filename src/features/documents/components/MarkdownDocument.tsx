import {
  useEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useDocuments } from "../DocumentsProvider";
import type { DocumentContent, TableOfContentsItem } from "../model";
import { remarkLiteralHtml } from "../remark-literal-html";
import { remarkOkfFrontmatter } from "../remark-okf-frontmatter";
import {
  remarkOkhubBlocks,
  type MarkdownAlertKind,
} from "../remark-okhub-blocks";
import { MarkdownAlert } from "./MarkdownAlert";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownTable } from "./MarkdownTable";
import { MermaidBlock } from "./MermaidBlock";

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    mark: ["dataSearchMatch"],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataOkhubAlert"],
    code: [...(defaultSchema.attributes?.code ?? []), "dataOkhubBlockId"],
    table: [...(defaultSchema.attributes?.table ?? []), "dataOkhubBlockId"],
    input: [...(defaultSchema.attributes?.input ?? []), "ariaLabel"],
    h1: [...(defaultSchema.attributes?.h1 ?? []), "dataOkhubHeadingId"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "dataOkhubHeadingId"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "dataOkhubHeadingId"],
    h4: [...(defaultSchema.attributes?.h4 ?? []), "dataOkhubHeadingId"],
    h5: [...(defaultSchema.attributes?.h5 ?? []), "dataOkhubHeadingId"],
    h6: [...(defaultSchema.attributes?.h6 ?? []), "dataOkhubHeadingId"],
  },
};

interface MarkdownNode {
  type?: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hProperties?: Record<string, string>;
    sourceTitleSuppressed?: boolean;
  };
}

interface RehypeNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: RehypeNode[];
}

function isVisuallyHidden(node: RehypeNode): boolean {
  if (
    ["script", "style", "template", "noscript"].includes(node.tagName ?? "")
  ) {
    return true;
  }
  const properties = node.properties;
  if (!properties) return false;
  const ariaHidden = properties.ariaHidden ?? properties["aria-hidden"];
  if (ariaHidden === true || ariaHidden === "true") return true;
  if (properties.hidden === true || properties.hidden === "") return true;
  const classNames = Array.isArray(properties.className)
    ? properties.className
    : String(properties.className ?? "").split(/\s+/);
  return classNames.some(
    (className) => className === "sr-only" || className === "visually-hidden",
  );
}

function visitMarkdown(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) visitMarkdown(child, callback);
}

function markdownText(node: MarkdownNode): string {
  return node.value ?? (node.children ?? []).map(markdownText).join("");
}

function remarkSuppressSourceTitle(title: string) {
  return () => (tree: MarkdownNode) => {
    let first: { heading: MarkdownNode; parent: MarkdownNode; index: number } | undefined;
    const findFirstHeading = (parent: MarkdownNode) => {
      for (const [index, child] of (parent.children ?? []).entries()) {
        if (first) return;
        if (child.type === "heading") first = { heading: child, parent, index };
        else findFirstHeading(child);
      }
    };
    findFirstHeading(tree);
    const heading = first?.heading;
    if (
      heading?.depth !== 1 ||
      markdownText(heading).trim() !== title.trim()
    ) {
      return;
    }
    first?.parent.children?.splice(first.index, 1);
    tree.data = { ...tree.data, sourceTitleSuppressed: true };
  };
}

function remarkHeadingIds(items: TableOfContentsItem[]) {
  return () => (tree: MarkdownNode) => {
    let index = tree.data?.sourceTitleSuppressed ? 1 : 0;
    visitMarkdown(tree, (node) => {
      if (node.type !== "heading") return;
      const item = items[index++];
      if (!item || item.level !== node.depth) return;
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id: item.id,
          dataOkhubHeadingId: item.id,
        },
      };
    });
  };
}

function rehypeSearchMatch(query: string) {
  return () => (tree: RehypeNode) => {
    if (!query.trim()) return;
    const normalized = query.toLocaleLowerCase();
    let matched = false;

    const visit = (node: RehypeNode) => {
      if (matched || isVisuallyHidden(node)) return;
      const children = node.children;
      if (!children) return;
      for (let index = 0; index < children.length && !matched; index += 1) {
        const child = children[index];
        if (child.type === "text" && child.value) {
          const foundAt = child.value.toLocaleLowerCase().indexOf(normalized);
          if (foundAt < 0) continue;
          const before = child.value.slice(0, foundAt);
          const value = child.value.slice(foundAt, foundAt + query.length);
          const after = child.value.slice(foundAt + query.length);
          children.splice(
            index,
            1,
            ...(before ? [{ type: "text", value: before }] : []),
            {
              type: "element",
              tagName: "mark",
              properties: { dataSearchMatch: "" },
              children: [{ type: "text", value }],
            },
            ...(after ? [{ type: "text", value: after }] : []),
          );
          matched = true;
          return;
        }
        visit(child);
      }
    };

    visit(tree);
  };
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function splitSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return { path: match?.[1] ?? value, suffix: match?.[2] ?? "" };
}

function resolveRepositoryPath(documentPath: string, value: string): string | null {
  const { path } = splitSuffix(value.trim());
  if (!path || isAbsoluteUrl(path) || path.startsWith("/") || path.includes("\\")) {
    return null;
  }
  const segments = documentPath.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (segment.includes(":")) return null;
    segments.push(segment);
  }
  return segments.join("/") || null;
}

function safeMarkdownUrl(documentPath: string, url: string): string {
  const value = url.trim();
  if (!value) return "#";
  if (value.startsWith("#")) return value;
  if (/^(https?|mailto):/i.test(value)) return value;
  return resolveRepositoryPath(documentPath, value) ? value : "#";
}

function isMarkdownLink(path: string): boolean {
  return splitSuffix(path).path.toLocaleLowerCase().endsWith(".md");
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type HeadingProps = ComponentPropsWithoutRef<"h1"> & ExtraProps;

function documentHeading(tag: HeadingTag) {
  return ({ id: _sanitizedId, node, children, ...props }: HeadingProps) => {
    const candidate = node?.properties?.dataOkhubHeadingId;
    const rustId = typeof candidate === "string" ? candidate : undefined;
    const Tag = tag;
    return (
      <Tag
        {...props}
        id={rustId ?? _sanitizedId}
        data-okhub-heading-id={rustId}
      >
        {children}
      </Tag>
    );
  };
}

function documentTableBlock({
  id: sanitizedId,
  node,
  ...props
}: ComponentPropsWithoutRef<"table"> & ExtraProps) {
  const candidate = node?.properties?.dataOkhubBlockId;
  const blockId = typeof candidate === "string" ? candidate : undefined;
  return (
    <MarkdownTable
      {...props}
      id={blockId ?? sanitizedId}
      data-okhub-block-id={blockId}
    />
  );
}

function rehypeText(node: RehypeNode): string {
  return node.value ?? (node.children ?? []).map(rehypeText).join("");
}

function codeSearchMatch(node: RehypeNode): { start: number; end: number } | undefined {
  let offset = 0;
  let match: { start: number; end: number } | undefined;
  const visit = (child: RehypeNode) => {
    if (child.tagName === "mark" && child.properties?.dataSearchMatch !== undefined) {
      match = { start: offset, end: offset + rehypeText(child).length };
    }
    if (child.type === "text") offset += child.value?.length ?? 0;
    else for (const descendant of child.children ?? []) visit(descendant);
  };
  visit(node);
  return match;
}

function containsCaptionedImage(node: RehypeNode | undefined): boolean {
  return Boolean(node && (
    (node.tagName === "img" && node.properties?.title) ||
    node.children?.some(containsCaptionedImage)
  ));
}

function rehypeTaskListLabels() {
  return (tree: RehypeNode) => {
    const ownText = (node: RehypeNode): string =>
      ["ul", "ol", "input"].includes(node.tagName ?? "")
        ? ""
        : node.value ?? (node.children ?? []).map(ownText).join("");
    const labelCheckboxes = (node: RehypeNode, label: string) => {
      if (["ul", "ol"].includes(node.tagName ?? "")) return;
      if (node.tagName === "input" && node.properties?.type === "checkbox") {
        node.properties.ariaLabel = label;
      }
      for (const child of node.children ?? []) labelCheckboxes(child, label);
    };
    const visit = (node: RehypeNode) => {
      if (node.tagName === "li") {
        labelCheckboxes(node, ownText(node).replace(/\s+/g, " ").trim() || "완료 상태");
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

function codeBlockNode(node: RehypeNode | undefined): RehypeNode | undefined {
  return node?.children?.find((child) => child.tagName === "code");
}

function isMarkdownAlertKind(value: unknown): value is MarkdownAlertKind {
  return ["note", "tip", "important", "warning", "caution"].includes(
    String(value),
  );
}

function documentClassName(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export interface MarkdownDocumentProps {
  document: DocumentContent;
  hideHeader?: boolean;
  suppressSourceTitle?: boolean;
}

export function MarkdownDocument({
  document,
  hideHeader = false,
  suppressSourceTitle = false,
}: MarkdownDocumentProps) {
  const { selectDocument, readAsset, openExternal, copyText, state } = useDocuments();
  const articleRef = useRef<HTMLElement>(null);
  const searchMatch = state.selectedSearchMatch;
  const bodySearchQuery = searchMatch?.matchField === "body" ? searchMatch.matchText : "";
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkOkfFrontmatter(document.markdown),
      remarkLiteralHtml({ allowedTags: ["details", "summary"] }),
      remarkOkhubBlocks({
        markdown: document.markdown,
        documentId: document.summary.documentId ?? document.summary.path,
      }),
      ...(suppressSourceTitle
        ? [remarkSuppressSourceTitle(document.summary.title)]
        : []),
      remarkHeadingIds(document.tableOfContents),
    ],
    [
      document.markdown,
      document.summary.documentId,
      document.summary.path,
      document.summary.title,
      document.tableOfContents,
      suppressSourceTitle,
    ],
  );
  const rehypePlugins = useMemo<
    NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>
  >(
    () => [
      ...(bodySearchQuery ? [rehypeSearchMatch(bodySearchQuery)] : []),
      [rehypeRaw, { tagfilter: true }],
      rehypeTaskListLabels,
      [rehypeSanitize, markdownSanitizeSchema],
    ] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>,
    [bodySearchQuery],
  );

  useEffect(() => {
    if (!searchMatch || searchMatch.matchField !== "body") return;
    const frame = window.requestAnimationFrame(() => {
      const target = articleRef.current?.querySelector<HTMLElement>(
        "mark[data-search-match]",
      );
      target?.scrollIntoView?.({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [document.markdown, searchMatch]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps & { children?: ReactNode }) => {
        const isFootnote = node?.properties?.dataFootnoteRef !== undefined ||
          node?.properties?.dataFootnoteBackref !== undefined;
        // Sanitization prefixes generated IDs too; keep both GFM directions in sync.
        const value = isFootnote && href?.startsWith("#")
          ? `#${defaultSchema.clobberPrefix}${href.slice(1)}`
          : href ?? "#";
        const target = resolveRepositoryPath(document.summary.path, value);
        if (target) {
          if (!isMarkdownLink(value)) {
            return <span className="markdown-document__unsupported-link">지원하지 않는 파일 링크입니다: {children}</span>;
          }
          return (
            <a
              {...props}
              href={value}
              onClick={(event) => {
                event.preventDefault();
                selectDocument(target);
              }}
            >
              {children}
            </a>
          );
        }
        if (/^https?:/i.test(value)) {
          return (
            <a
              {...props}
              href={value}
              onClick={(event) => {
                event.preventDefault();
                void openExternal(value);
              }}
            >
              {children}
            </a>
          );
        }
        return <a {...props} href={value}>{children}</a>;
      },
      img: ({ src, alt, title }: ComponentPropsWithoutRef<"img"> & ExtraProps) => (
        <MarkdownImage
          src={src}
          alt={alt ?? ""}
          title={title}
          documentPath={document.summary.path}
          readAsset={readAsset}
        />
      ),
      p: ({ node, children, ...props }: ComponentPropsWithoutRef<"p"> & ExtraProps) =>
        containsCaptionedImage(node)
          ? <div {...props} className="markdown-document__image-paragraph">{children}</div>
          : <p {...props}>{children}</p>,
      code: ({ id: sanitizedId, className, children, node, ...props }: ComponentPropsWithoutRef<"code"> & ExtraProps & { children?: ReactNode }) => {
        const candidate = node?.properties?.dataOkhubBlockId;
        const blockId = typeof candidate === "string" ? candidate : undefined;
        return <code {...props} id={blockId ?? sanitizedId} className={className}>{children}</code>;
      },
      pre: ({ id: sanitizedId, node, children, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps & { children?: ReactNode }) => {
        const codeNode = codeBlockNode(node);
        if (!codeNode) return <pre {...props} id={sanitizedId}>{children}</pre>;

        const classNames = codeNode.properties?.className;
        const className = Array.isArray(classNames)
          ? classNames.join(" ")
          : String(classNames ?? "");
        const language = /language-([^\s]+)/.exec(className)?.[1];
        const candidate = codeNode.properties?.dataOkhubBlockId;
        const blockId = typeof candidate === "string" ? candidate : undefined;
        const id = blockId ?? sanitizedId;
        const source = rehypeText(codeNode).replace(/\n$/, "");

        if (language === "mermaid") {
          return (
            <span id={id} data-okhub-block-id={blockId}>
              <MermaidBlock source={source} />
            </span>
          );
        }
        return (
          <MarkdownCodeBlock
            id={id}
            data-okhub-block-id={blockId}
            language={language}
            source={source}
            searchMatch={codeSearchMatch(codeNode)}
            onCopy={copyText}
          />
        );
      },
      h1: documentHeading("h1"),
      h2: documentHeading("h2"),
      h3: documentHeading("h3"),
      h4: documentHeading("h4"),
      h5: documentHeading("h5"),
      h6: documentHeading("h6"),
      table: documentTableBlock,
      blockquote: ({ children, node, ...props }: ComponentPropsWithoutRef<"blockquote"> & ExtraProps & { children?: ReactNode }) => {
        const kind = node?.properties?.dataOkhubAlert;
        if (isMarkdownAlertKind(kind)) {
          return <MarkdownAlert kind={kind}>{children}</MarkdownAlert>;
        }
        return <blockquote {...props}>{children}</blockquote>;
      },
      details: ({ className, children, node: _node, ...props }: ComponentPropsWithoutRef<"details"> & ExtraProps & { children?: ReactNode }) => (
        <details
          {...props}
          className={documentClassName("markdown-document__details", className)}
        >
          {children}
        </details>
      ),
      summary: ({ className, children, node: _node, ...props }: ComponentPropsWithoutRef<"summary"> & ExtraProps & { children?: ReactNode }) => (
        <summary
          {...props}
          className={documentClassName("markdown-document__details-summary", className)}
        >
          <ChevronRight
            aria-hidden="true"
            className="markdown-document__details-chevron"
            strokeWidth={1.75}
          />
          <span className="markdown-document__details-summary-text">{children}</span>
        </summary>
      ),
    }),
    [copyText, document.summary.path, openExternal, readAsset, selectDocument],
  );

  return (
    <article className="markdown-document" ref={articleRef}>
      {hideHeader ? null : (
        <header className="markdown-document__header">
          <h1>{document.summary.title}</h1>
          <p>{document.summary.path}</p>
        </header>
      )}
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={(url) => safeMarkdownUrl(document.summary.path, url)}
        components={components}
      >
        {document.markdown}
      </ReactMarkdown>
    </article>
  );
}
