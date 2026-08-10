import { useEffect, useId, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

let mermaidInitialized = false;

function initializeMermaid(): void {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
  });
  mermaidInitialized = true;
}

function isSafeSvgReference(value: string | null): boolean {
  return value !== null && value.trim().startsWith("#");
}

function hasUnsafeSvgUrl(value: string): boolean {
  const references = value.match(/url\(\s*[^)]*?\s*\)/gi) ?? [];
  return references.some((reference) => {
    const target = reference
      .replace(/^url\(\s*|\s*\)$/gi, "")
      .replace(/^['"]|['"]$/g, "")
      .trim();
    return !target.startsWith("#");
  });
}

const URL_BEARING_ATTRIBUTES = new Set([
  "clip-path",
  "color-profile",
  "cursor",
  "fill",
  "filter",
  "marker",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
  "stroke",
]);

/** Sanitizes SVG before it crosses the DOM boundary, including SVG URLs. */
export function sanitizeSvg(source: string): string {
  const purified = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
  const parsed = new DOMParser().parseFromString(purified, "image/svg+xml");

  for (const style of parsed.querySelectorAll("style")) style.remove();
  for (const element of parsed.querySelectorAll("*")) {
    const href = element.getAttribute("href") ?? element.getAttribute("xlink:href");
    if (!isSafeSvgReference(href)) {
      element.removeAttribute("href");
      element.removeAttribute("xlink:href");
    }
    element.removeAttribute("src");
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      if (
        name === "style" ||
        (URL_BEARING_ATTRIBUTES.has(name) &&
          (hasUnsafeSvgUrl(attribute.value) ||
            /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attribute.value.trim())))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return new XMLSerializer().serializeToString(parsed.documentElement);
}

export interface MermaidBlockProps {
  source: string;
}

export function MermaidBlock({ source }: MermaidBlockProps) {
  const id = `okhub-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSvg(null);
    setFailed(false);
    initializeMermaid();

    void mermaid.render(id, source).then(
      ({ svg: rendered }) => {
        if (active) setSvg(sanitizeSvg(rendered));
      },
      () => {
        if (active) setFailed(true);
      },
    );

    return () => {
      active = false;
    };
  }, [id, source]);

  if (failed) {
    return (
      <div className="mermaid-block mermaid-block--failed">
        <pre>
          <code>{source}</code>
        </pre>
        <p role="alert">다이어그램을 표시할 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mermaid-block" aria-busy={svg === null}>
      {svg === null ? <p>다이어그램을 렌더링하는 중…</p> : null}
      {svg !== null ? (
        <div
          className="mermaid-block__svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
    </div>
  );
}
