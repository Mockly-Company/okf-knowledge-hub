import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useDocuments } from "../DocumentsProvider";
import type { DocumentAsset, DocumentContent, TableOfContentsItem } from "../model";
import { remarkLiteralHtml } from "../remark-literal-html";
import { remarkOkfFrontmatter } from "../remark-okf-frontmatter";
import { MermaidBlock, sanitizeSvg } from "./MermaidBlock";

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    mark: ["dataSearchMatch"],
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
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, string> };
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

function remarkHeadingIds(items: TableOfContentsItem[]) {
  return () => (tree: MarkdownNode) => {
    let index = 0;
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

function dataUrlForRaster(asset: Extract<DocumentAsset, { kind: "raster" }>): string | null {
  return /^image\/(avif|bmp|gif|jpeg|png|webp)$/i.test(asset.mimeType)
    ? `data:${asset.mimeType};base64,${asset.base64}`
    : null;
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

function RepositoryImage({
  src,
  alt = "",
  documentPath,
  readAsset,
}: {
  src?: string;
  alt?: string;
  documentPath: string;
  readAsset: (documentPath: string, assetPath: string) => Promise<DocumentAsset>;
}) {
  const assetPath =
    src && resolveRepositoryPath(documentPath, src)
      ? splitSuffix(src).path
      : null;
  const [asset, setAsset] = useState<DocumentAsset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setAsset(null);
    setFailed(false);
    if (!assetPath) return () => {
      active = false;
    };
    void readAsset(documentPath, assetPath).then(
      (next) => {
        if (active) setAsset(next);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [assetPath, documentPath, readAsset]);

  if (!assetPath || failed) {
    return <span className="markdown-document__asset-error">이미지를 표시할 수 없습니다.</span>;
  }
  if (asset === null) return <span className="markdown-document__asset-loading">이미지를 불러오는 중…</span>;
  if (asset.kind === "svg") {
    return (
      <span
        className="markdown-document__svg-asset"
        role="img"
        aria-label={alt}
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(asset.source) }}
      />
    );
  }
  const dataUrl = dataUrlForRaster(asset);
  return dataUrl ? <img src={dataUrl} alt={alt} /> : <span>이미지를 표시할 수 없습니다.</span>;
}

export interface MarkdownDocumentProps {
  document: DocumentContent;
  hideHeader?: boolean;
}

export function MarkdownDocument({ document, hideHeader = false }: MarkdownDocumentProps) {
  const { selectDocument, readAsset, openExternal, state } = useDocuments();
  const headerRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const searchMatch = state.selectedSearchMatch;
  const bodySearchQuery = searchMatch?.matchField === "body" ? searchMatch.matchText : "";
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkOkfFrontmatter(document.markdown),
      remarkLiteralHtml,
      remarkHeadingIds(document.tableOfContents),
    ],
    [document.markdown, document.tableOfContents],
  );
  const rehypePlugins = useMemo<
    NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>
  >(
    () => [
      ...(bodySearchQuery ? [rehypeSearchMatch(bodySearchQuery)] : []),
      [rehypeSanitize, markdownSanitizeSchema],
    ] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>,
    [bodySearchQuery],
  );

  useEffect(() => {
    if (!searchMatch) return;
    const frame = window.requestAnimationFrame(() => {
      const target =
        searchMatch.matchField === "body"
          ? articleRef.current?.querySelector<HTMLElement>("mark[data-search-match]")
          : headerRef.current;
      target?.scrollIntoView?.({ block: "center" });
      if (target === headerRef.current) headerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [document.markdown, searchMatch]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps & { children?: ReactNode }) => {
        const value = href ?? "#";
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
      img: ({ src, alt }: ComponentPropsWithoutRef<"img"> & ExtraProps) => (
        <RepositoryImage
          src={src}
          alt={alt}
          documentPath={document.summary.path}
          readAsset={readAsset}
        />
      ),
      code: ({ className, children, node: _node, ...props }: ComponentPropsWithoutRef<"code"> & ExtraProps & { children?: ReactNode }) => {
        const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
        if (language === "mermaid") {
          return <MermaidBlock source={String(children).replace(/\n$/, "")} />;
        }
        return <code {...props} className={className}>{children}</code>;
      },
      h1: documentHeading("h1"),
      h2: documentHeading("h2"),
      h3: documentHeading("h3"),
      h4: documentHeading("h4"),
      h5: documentHeading("h5"),
      h6: documentHeading("h6"),
    }),
    [document.summary.path, openExternal, readAsset, selectDocument],
  );

  return (
    <article className="markdown-document" ref={articleRef}>
      {hideHeader ? null : (
        <header className="markdown-document__header" ref={headerRef} tabIndex={-1}>
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
