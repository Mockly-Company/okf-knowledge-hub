import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompanionHtmlFrame,
  prepareInteractiveCompanionHtml,
  resolveCompanionDocumentLink,
  sanitizeCompanionHtmlFallback,
} from "./CompanionHtmlFrame";

afterEach(cleanup);

describe("CompanionHtmlFrame", () => {
  it("resolves relative .html and .md links to .md canonical paths while skipping anchors and external URLs", () => {
    expect(
      resolveCompanionDocumentLink(
        "docs/domains/documents/screen-spec.md",
        "prd.html#sec-04",
      ),
    ).toEqual({
      path: "docs/domains/documents/prd.md",
      view: "html",
      fragment: "sec-04",
    });

    expect(
      resolveCompanionDocumentLink(
        "docs/domains/documents/screen-spec.md",
        "../../architecture/adr-001.md#decision",
      ),
    ).toEqual({
      path: "docs/architecture/adr-001.md",
      view: "markdown",
      fragment: "decision",
    });

    expect(
      resolveCompanionDocumentLink(
        "docs/domains/documents/prd.md",
        "#sec-04",
      ),
    ).toBeNull();
    expect(
      resolveCompanionDocumentLink(
        "docs/domains/documents/prd.md",
        "https://example.com",
      ),
    ).toBeNull();
  });

  it("strips author scripts, inline event handlers, unsafe URLs, and injects nonce CSP", () => {
    const html =
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src *" /><meta http-equiv="refresh" content="0;url=https://evil.test" /><script>alert(1)</script></head><body onload="alert(2)"><img src="x" onerror="alert(3)" /><img src="data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E" alt="valid" /><svg onload="alert(4)"></svg><a href="&#106;avascript:alert(5)" onclick="alert(6)">악성 링크</a><a href="#sec-04">04 완료 조건</a><h2 id="sec-04">완료 조건</h2></body></html>';
    const prepared = prepareInteractiveCompanionHtml(html, "chan-1", "nonce123");

    expect(prepared).not.toContain("alert(1)");
    expect(prepared).not.toContain("alert(2)");
    expect(prepared).not.toContain("alert(3)");
    expect(prepared).not.toContain("alert(4)");
    expect(prepared).not.toContain("alert(5)");
    expect(prepared).not.toContain("alert(6)");
    expect(prepared).not.toMatch(/\bon(?:load|error|click)\s*=/i);
    expect(prepared).not.toContain("http-equiv=\"refresh\"");
    expect(prepared).toContain("data:image/svg+xml");
    expect(prepared).toContain("script-src 'nonce-nonce123'");
    expect(prepared).toContain('<script nonce="nonce123">');
    expect(prepared).toContain('"chan-1"');
    expect(prepared).toContain("#sec-04");
  });

  it("strips unquoted and entity-encoded unsafe URLs in the non-DOMParser fallback sanitizer", () => {
    const html =
      '<img src=x onerror=alert(1)><a href=javascript:alert(2)>unquoted</a><a href="&#106;avascript:alert(3)">decimal</a><a href="&#x6a;avascript&colon;alert(4)">hex</a><a href="prd.html#sec-04">safe doc</a><img src="data:image/png;base64,AAA" alt="safe">';
    const cleaned = sanitizeCompanionHtmlFallback(html);

    expect(cleaned).not.toContain("alert(");
    expect(cleaned).not.toMatch(/\bonerror\s*=/i);
    expect(cleaned).not.toMatch(/href\s*=.*javascript/i);
    expect(cleaned).toContain('href="prd.html#sec-04"');
    expect(cleaned).toContain("data:image/png;base64,AAA");
  });

  it("handles trusted postMessage link navigation and ignores untrusted sources", () => {
    const onNavigateDocument = vi.fn();
    const onOpenExternal = vi.fn();

    render(
      <CompanionHtmlFrame
        html="<html><body><h1>문서</h1></body></html>"
        title="문서 사람용 보기"
        documentPath="docs/domains/documents/screen-spec.md"
        onNavigateDocument={onNavigateDocument}
        onOpenExternal={onOpenExternal}
      />,
    );

    const frame = screen.getByTitle("문서 사람용 보기") as HTMLIFrameElement;
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");

    const srcDoc = frame.getAttribute("srcdoc") ?? "";
    const channelMatch = /var ch="([^"]+)"/.exec(srcDoc);
    expect(channelMatch?.[1]).toBeTruthy();
    const channel = channelMatch![1]!;

    // Untrusted source (parent window instead of iframe contentWindow) must be ignored.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: "okhub:companion-link",
          channel,
          kind: "document",
          href: "prd.html",
        },
      }),
    );
    expect(onNavigateDocument).not.toHaveBeenCalled();

    // Valid source & channel -> dispatches relative document link in .html mode.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "okhub:companion-link",
          channel,
          kind: "document",
          href: "../dashboard/prd.html#sec-04",
        },
      }),
    );
    expect(onNavigateDocument).toHaveBeenCalledWith({
      path: "docs/domains/dashboard/prd.md",
      view: "html",
      fragment: "sec-04",
    });

    // External URL link -> opens externally.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: "okhub:companion-link",
          channel,
          kind: "external",
          href: "https://github.com/Mockly-Company/hub-knowledge",
        },
      }),
    );
    expect(onOpenExternal).toHaveBeenCalledWith(
      "https://github.com/Mockly-Company/hub-knowledge",
    );
  });
});
