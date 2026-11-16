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
    /^(https?:|mailto:|tel:|javascript:|data:|blob:)/i.test(trimmed)
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

export function prepareInteractiveCompanionHtml(
  rawHtml: string,
  channelId: string,
  nonce: string = createScriptNonce(),
): string {
  const sanitized = rawHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(
      /<meta\b[^>]*http-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy)[^>]*>/gi,
      "",
    );

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}';" />`;
  const bridgeScript = `<script nonce="${nonce}">(function(){var ch=${JSON.stringify(channelId)};function scrollToFrag(frag){if(!frag){window.scrollTo(0,0);return;}var decoded=frag;try{decoded=decodeURIComponent(frag);}catch(_){}var el=document.getElementById(decoded)||document.getElementsByName(decoded)[0];if(el&&typeof el.scrollIntoView==="function"){el.scrollIntoView({behavior:"smooth",block:"start"});}}document.addEventListener("click",function(ev){var t=ev.target;if(!t||typeof t.closest!=="function")return;var a=t.closest("a[href]");if(!a)return;var href=a.getAttribute("href");if(!href)return;ev.preventDefault();if(href.charAt(0)==="#"){scrollToFrag(href.slice(1));return;}var kind=/^(https?:|mailto:|tel:)/i.test(href)?"external":"document";if(window.parent&&window.parent!==window){window.parent.postMessage({type:"okhub:companion-link",channel:ch,kind:kind,href:href},"*");}},true);window.addEventListener("message",function(ev){if(!ev.data||ev.data.channel!==ch)return;if(ev.data.type==="okhub:scroll-to"){scrollToFrag(ev.data.fragment||"");}});})();</script>`;

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
