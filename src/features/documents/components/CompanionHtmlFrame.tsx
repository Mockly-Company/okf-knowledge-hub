import { useEffect, useId, useMemo, useRef } from "react";
import { normalizeDocumentPath } from "../model";

export interface CompanionHtmlFrameProps {
  html: string;
  title: string;
  documentPath: string;
  className?: string;
  initialFragment?: string | null;
  onNavigateDocument?: (target: {
    path: string;
    view: "html" | "markdown";
    fragment?: string;
  }) => void;
  onOpenExternal?: (url: string) => void;
}

export interface ResolvedCompanionLink {
  path: string;
  view: "html" | "markdown";
  fragment?: string;
}

function stripFragmentAndQuery(href: string): {
  base: string;
  fragment?: string;
} {
  const hashIndex = href.indexOf("#");
  const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : undefined;
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = beforeHash.indexOf("?");
  const base = (queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash).trim();
  return { base, fragment: fragment || undefined };
}

export function resolveCompanionDocumentLink(
  currentDocPath: string,
  rawHref: string,
): ResolvedCompanionLink | null {
  const trimmed = rawHref.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^(https?:|mailto:|tel:|javascript:|vbscript:|data:|blob:)/i.test(trimmed)
  ) {
    return null;
  }

  const { base, fragment } = stripFragmentAndQuery(trimmed);
  if (!base) return null;

  let candidate: string;
  if (base.startsWith("/")) {
    candidate = base.slice(1);
  } else {
    const cleanDoc = normalizeDocumentPath(currentDocPath);
    const lastSlash = cleanDoc.lastIndexOf("/");
    const parentDir = lastSlash >= 0 ? cleanDoc.slice(0, lastSlash) : "";
    candidate = parentDir ? `${parentDir}/${base}` : base;
  }

  const normalized = normalizeDocumentPath(candidate);
  if (!normalized) return null;

  if (/\.html$/i.test(normalized)) {
    return {
      path: normalized.replace(/\.html$/i, ".md"),
      view: "html",
      fragment,
    };
  }
  if (/\.md$/i.test(normalized)) {
    return {
      path: normalized,
      view: "markdown",
      fragment,
    };
  }
  return null;
}

function createScriptNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

const DANGEROUS_HTML_TAGS =
  "script, object, embed, applet, base, iframe, frame, frameset";

const URL_ATTR_NAMES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "data",
  "background",
]);

const SAFE_DATA_IMAGE_URL =
  /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;|,)/i;

function isSafeAttributeUrl(attrName: string, rawValue: string): boolean {
  // Strip ASCII whitespace and control chars before scheme check (`java\tscript:` etc.).
  // eslint-disable-next-line no-control-regex
  const compact = rawValue.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (!compact) return true;
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) {
    return false;
  }
  if (compact.startsWith("data:")) {
    if (
      attrName === "src" ||
      attrName === "poster" ||
      attrName === "xlink:href"
    ) {
      return SAFE_DATA_IMAGE_URL.test(compact);
    }
    return false;
  }
  return true;
}

function sanitizeInlineCss(cssText: string): string {
  return cssText
    .replace(/@import\b[^;\n]*(?:;|$)/gi, "")
    .replace(/expression\s*\(/gi, "/* blocked */(")
    .replace(
      /url\s*\(\s*(['"]?)\s*(?:javascript|vbscript):[\s\S]*?\)/gi,
      "url(about:blank)",
    );
}

const BASIC_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  tab: "\t",
  newline: "\n",
};

function decodeBasicHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi,
    (match, token: string) => {
      const lower = token.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return BASIC_HTML_ENTITIES[lower] ?? match;
    },
  );
}

export function sanitizeCompanionHtmlFallback(rawHtml: string): string {
  return rawHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(
      /<(?:iframe|object|embed|applet|frame|frameset)\b[\s\S]*?<\/(?:iframe|object|embed|applet|frame|frameset)>/gi,
      "",
    )
    .replace(
      /<(?:iframe|object|embed|applet|base|frame|frameset)\b[^>]*\/?>/gi,
      "",
    )
    .replace(
      /<meta\b[^>]*http-equiv\s*=\s*(?:"(?:content-security-policy|refresh)"|'(?:content-security-policy|refresh)'|content-security-policy|refresh)[^>]*>/gi,
      "",
    )
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_, open: string, css: string, close: string) =>
        `${open}${sanitizeInlineCss(css)}${close}`,
    )
    .replace(
      /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi,
      "",
    )
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, "")
    .replace(
      /\s+(style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (_, attr: string, dq?: string, sq?: string, uq?: string) => {
        const raw = dq ?? sq ?? uq ?? "";
        return ` ${attr}="${sanitizeInlineCss(raw).replace(/"/g, "&quot;")}"`;
      },
    )
    .replace(
      /\s+(href|src|xlink:href|action|formaction|poster|data|background|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (
        match: string,
        attr: string,
        dq?: string,
        sq?: string,
        uq?: string,
      ) => {
        const attrName = attr.toLowerCase();
        const raw = dq ?? sq ?? uq ?? "";
        const decoded = decodeBasicHtmlEntities(raw);
        if (attrName === "srcset") {
          const safeParts = decoded
            .split(",")
            .map((part) => part.trim())
            .filter((part) => {
              const urlPart = part.split(/\s+/)[0] ?? "";
              return urlPart.length > 0 && isSafeAttributeUrl("src", urlPart);
            });
          return safeParts.length > 0 ? ` srcset="${safeParts.join(", ")}"` : "";
        }
        return isSafeAttributeUrl(attrName, decoded) ? match : "";
      },
    );
}

function sanitizeCompanionHtmlDocument(rawHtml: string): string {
  if (typeof DOMParser === "undefined") {
    return sanitizeCompanionHtmlFallback(rawHtml);
  }
  const hasDoctype = /^\s*<!doctype\b/i.test(rawHtml);
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  for (const el of parsed.querySelectorAll(DANGEROUS_HTML_TAGS)) {
    el.remove();
  }
  for (const meta of parsed.querySelectorAll("meta[http-equiv]")) {
    const equiv = meta.getAttribute("http-equiv")?.trim().toLowerCase();
    if (equiv === "content-security-policy" || equiv === "refresh") {
      meta.remove();
    }
  }
  for (const styleEl of parsed.querySelectorAll("style")) {
    if (styleEl.textContent) {
      styleEl.textContent = sanitizeInlineCss(styleEl.textContent);
    }
  }
  for (const el of parsed.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const lower = attr.name.toLowerCase();
      if (lower.startsWith("on") || lower === "srcdoc") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (lower === "style") {
        el.setAttribute(attr.name, sanitizeInlineCss(attr.value));
        continue;
      }
      if (lower === "srcset") {
        const safeParts = attr.value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => {
            const urlPart = part.split(/\s+/)[0] ?? "";
            return urlPart.length > 0 && isSafeAttributeUrl("src", urlPart);
          });
        if (safeParts.length === 0) {
          el.removeAttribute(attr.name);
        } else {
          el.setAttribute(attr.name, safeParts.join(", "));
        }
        continue;
      }
      if (URL_ATTR_NAMES.has(lower) && !isSafeAttributeUrl(lower, attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  const serialized = parsed.documentElement.outerHTML;
  return hasDoctype ? `<!DOCTYPE html>${serialized}` : serialized;
}

export function prepareInteractiveCompanionHtml(
  rawHtml: string,
  channelId: string,
  nonce: string = createScriptNonce(),
): string {
  const sanitized = sanitizeCompanionHtmlDocument(rawHtml);

  // 의도적 결정: 원격 이미지(https:)는 허용하지 않는다. srcdoc iframe은 앱 CSP(tauri.conf.json img-src)를
  // 상속하므로 여기서 https:를 열어도 실제로는 차단되며, 외부 추적 픽셀도 막는다. 로컬 이미지는
  // reader.rs가 data: URI로 인라인하므로 문서 저장소 안의 시안/스크린샷은 정상 표시된다.
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}';" />`;
  const bridgeScript = `<script nonce="${nonce}">(function(){var ch=${JSON.stringify(channelId)};function scrollToFrag(frag){if(!frag){window.scrollTo(0,0);return;}var decoded=frag;try{decoded=decodeURIComponent(frag);}catch(_){}var el=document.getElementById(decoded)||document.getElementsByName(decoded)[0];if(el&&typeof el.scrollIntoView==="function"){el.scrollIntoView({behavior:"smooth",block:"start"});}}document.addEventListener("click",function(ev){var t=ev.target;if(!t||typeof t.closest!=="function")return;var a=t.closest("a[href]");if(!a)return;var href=a.getAttribute("href");if(!href)return;ev.preventDefault();var compact=href.replace(/[\\u0000-\\u0020]+/g,"");if(/^(javascript|vbscript|data):/i.test(compact))return;if(href.charAt(0)==="#"){scrollToFrag(href.slice(1));return;}var kind=/^(https?:|mailto:|tel:)/i.test(href)?"external":"document";if(window.parent&&window.parent!==window){window.parent.postMessage({type:"okhub:companion-link",channel:ch,kind:kind,href:href},"*");}},true);window.addEventListener("message",function(ev){if(!ev.data||ev.data.channel!==ch)return;if(ev.data.type==="okhub:scroll-to"){scrollToFrag(ev.data.fragment||"");}});})();</script>`;

  let withCsp: string;
  const headMatch = /<head\b[^>]*>/i.exec(sanitized);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    withCsp = `${sanitized.slice(0, insertAt)}${cspMeta}${sanitized.slice(insertAt)}`;
  } else {
    withCsp = `${cspMeta}${sanitized}`;
  }

  const bodyCloseIndex = withCsp.toLowerCase().lastIndexOf("</body>");
  if (bodyCloseIndex >= 0) {
    return `${withCsp.slice(0, bodyCloseIndex)}${bridgeScript}${withCsp.slice(bodyCloseIndex)}`;
  }
  return `${withCsp}${bridgeScript}`;
}

export function CompanionHtmlFrame({
  html,
  title,
  documentPath,
  className = "document-reader__html-frame",
  initialFragment,
  onNavigateDocument,
  onOpenExternal,
}: CompanionHtmlFrameProps) {
  const reactId = useId();
  const channelId = useMemo(
    () => `okhub-html-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId],
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const preparedHtml = useMemo(
    () => prepareInteractiveCompanionHtml(html, channelId),
    [html, channelId],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;
      const data = event.data as
        | {
            type?: unknown;
            channel?: unknown;
            kind?: unknown;
            href?: unknown;
          }
        | null
        | undefined;
      if (
        !data ||
        data.type !== "okhub:companion-link" ||
        data.channel !== channelId ||
        typeof data.href !== "string"
      ) {
        return;
      }
      if (data.kind === "external") {
        if (/^(https?|mailto|tel):/i.test(data.href.trim())) {
          onOpenExternal?.(data.href.trim());
        }
        return;
      }
      if (data.kind === "document") {
        const resolved = resolveCompanionDocumentLink(documentPath, data.href);
        if (resolved) {
          onNavigateDocument?.(resolved);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channelId, documentPath, onNavigateDocument, onOpenExternal]);

  useEffect(() => {
    if (!initialFragment) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "okhub:scroll-to",
        channel: channelId,
        fragment: initialFragment,
      },
      "*",
    );
  }, [channelId, initialFragment]);

  const handleLoad = () => {
    if (!initialFragment) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "okhub:scroll-to",
        channel: channelId,
        fragment: initialFragment,
      },
      "*",
    );
  };

  return (
    <iframe
      ref={iframeRef}
      className={className}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={preparedHtml}
      title={title}
      onLoad={handleLoad}
    />
  );
}
