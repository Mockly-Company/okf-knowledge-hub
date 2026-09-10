import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { initializeDiagram, renderDiagram } = vi.hoisted(() => ({
  initializeDiagram: vi.fn(),
  renderDiagram: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeDiagram,
    render: renderDiagram,
  },
}));

import { MermaidBlock } from "./MermaidBlock";

afterEach(() => {
  cleanup();
  initializeDiagram.mockReset();
  renderDiagram.mockReset();
});

describe("MermaidBlock", () => {
  it("initializes Mermaid once for multiple blocks", async () => {
    renderDiagram.mockResolvedValue({ svg: "<svg><text>safe</text></svg>" });
    render(
      <>
        <MermaidBlock source="flowchart LR\nA --> B" />
        <MermaidBlock source="flowchart LR\nC --> D" />
      </>,
    );

    await screen.findAllByText("safe");
    expect(initializeDiagram).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: "flowchart", source: 'flowchart LR\nA[Draft] -->|submit| B{Review}\nstyle A fill:#f00,stroke:#f00', node: ".node .label-container", label: ".node .label text", edgeLabel: ".edgeLabel text", line: ".flowchart-link", marker: "marker .arrowMarkerPath" },
    { kind: "sequence", source: "sequenceDiagram\nDraft->>Review: submit", node: "rect.actor", label: "text.actor", edgeLabel: ".messageText", line: ".messageLine0", marker: "marker path" },
  ])("themes actual sanitized Mermaid $kind nodes, edges, markers, and readable labels in both views", async ({ source, node, label, edgeLabel, line, marker }) => {
    vi.resetModules();
    const actualMermaid = (await vi.importActual<typeof import("mermaid")>("mermaid")).default;
    const { MermaidBlock: ActualOutputBlock } = await import("./MermaidBlock");
    initializeDiagram.mockImplementation((config) => actualMermaid.initialize(config));
    // JSDOM has no SVG layout engine; only geometry measurement is supplied.
    const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
    const textLength = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getComputedTextLength");
    Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: () => ({ x: 0, y: 0, width: 80, height: 24 }) });
    Object.defineProperty(SVGElement.prototype, "getComputedTextLength", { configurable: true, value: () => 80 });
    const theme = document.createElement("style");
    theme.textContent = readFileSync(resolve(process.cwd(), "src/features/documents/documents.css"), "utf8");
    document.head.append(theme);
    try {
      renderDiagram.mockImplementation((id, source) => actualMermaid.render(id, source));
      const { container } = render(<ActualOutputBlock source={source} />);
      const expand = await screen.findByRole("button", { name: "다이어그램 크게 보기" });
      const inline = container.querySelector(".mermaid-block__svg")!;
      const assertTheme = (surface: Element) => {
        expect(surface).toHaveClass("mermaid-theme");
        expect(surface.querySelector("style, [style], foreignObject")).toBeNull();
        expect(surface.querySelector(node)).not.toBeNull();
        expect([...surface.querySelectorAll(label)].map((element) => element.textContent)).toContain("Draft");
        expect(surface.querySelector(edgeLabel)).toHaveTextContent("submit");
        expect(getComputedStyle(surface.querySelector(node)!).fill).toBe("var(--color-surface)");
        expect(getComputedStyle(surface.querySelector(node)!).stroke).toBe("var(--color-border-strong)");
        expect(getComputedStyle(surface.querySelector(line)!).stroke).toBe("var(--color-border-strong)");
        expect(getComputedStyle(surface.querySelector(line)!).strokeWidth).toBe("1px");
        expect(getComputedStyle(surface.querySelector(marker)!).fill).toBe("var(--color-primary)");
        expect(getComputedStyle(surface.querySelector(label)!).fill).toBe("var(--color-text-default)");
      };
      assertTheme(inline);
      await userEvent.click(expand);
      assertTheme(screen.getByRole("dialog").querySelector(".diagram-dialog__svg")!);
    } finally {
      theme.remove();
      if (bbox) Object.defineProperty(SVGElement.prototype, "getBBox", bbox);
      else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
      if (textLength) Object.defineProperty(SVGElement.prototype, "getComputedTextLength", textLength);
      else Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength");
    }
  });

  it("sanitizes scripts, event attributes, and external URLs from Mermaid SVG", async () => {
    renderDiagram.mockResolvedValue({
      svg: '<svg><script>alert(1)</script><circle onclick="alert(2)" /><a href="https://evil.test"><text>bad</text></a><text>safe</text></svg>',
    });
    const { container } = render(<MermaidBlock source="flowchart LR\nA --> B" />);

    expect(await screen.findByText("safe")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("a[href='https://evil.test']")).toBeNull();
  });

  it("removes stylesheet and presentation-attribute URLs before SVG insertion", async () => {
    renderDiagram.mockResolvedValue({
      svg: '<svg><style>@import url("https://evil.test/theme.css"); .node { fill: url(https://evil.test/fill); }</style><rect fill="url(https://evil.test/fill)" stroke="url(https://evil.test/stroke)" filter="url(https://evil.test/filter)" mask="url(https://evil.test/mask)" clip-path="url(https://evil.test/clip)" /><text>safe presentation</text></svg>',
    });
    const { container } = render(<MermaidBlock source="flowchart LR\nA --> B" />);

    expect(await screen.findByText("safe presentation")).toBeVisible();
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("[fill*='evil.test']")).toBeNull();
    expect(container.querySelector("[stroke*='evil.test']")).toBeNull();
    expect(container.querySelector("[filter*='evil.test']")).toBeNull();
    expect(container.querySelector("[mask*='evil.test']")).toBeNull();
    expect(container.querySelector("[clip-path*='evil.test']")).toBeNull();
  });

  it("shows its fenced source and error without crashing when Mermaid rejects", async () => {
    renderDiagram.mockRejectedValue(new Error("bad syntax"));
    render(<MermaidBlock source="not a diagram" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다이어그램을 표시할 수 없습니다.",
    );
    expect(screen.getByText("not a diagram")).toBeVisible();
    expect(screen.queryByRole("button", { name: "다이어그램 크게 보기" })).toBeNull();
  });

  it("keeps long invalid source in a named keyboard-accessible scroll region", async () => {
    renderDiagram.mockRejectedValue(new Error("bad syntax"));
    const source = `flowchart LR\nA[${"unclosed-node-".repeat(40)}`;
    render(<MermaidBlock source={source} />);

    await screen.findByRole("alert");
    const region = screen.getByRole("region", { name: "다이어그램 원문 가로 스크롤" });
    expect(region.querySelector("code")?.textContent).toBe(source);
    await userEvent.tab();
    expect(region).toHaveFocus();
    expect(screen.queryByRole("button", { name: "다이어그램 크게 보기" })).toBeNull();
  });

  it("has no expand action while loading", () => {
    renderDiagram.mockReturnValue(new Promise(() => {}));
    render(<MermaidBlock source="flowchart LR\nA --> B" />);
    expect(screen.getByText("다이어그램을 렌더링하는 중…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "다이어그램 크게 보기" })).toBeNull();
  });

  it("opens sanitized SVG and restores focus after Escape and close", async () => {
    renderDiagram.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><script>alert(1)</script><image href="https://evil.test/image.svg"/><text>safe fullscreen</text></svg>',
    });
    const user = userEvent.setup();
    render(<MermaidBlock source="flowchart LR\nA --> B" />);
    const expand = await screen.findByRole("button", { name: "다이어그램 크게 보기" });
    expect(expand).toHaveAttribute("data-variant", "icon");
    expect(expand).not.toHaveAttribute("title");
    await user.hover(expand);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(expand);
    const dialog = screen.getByRole("dialog", { name: "다이어그램 크게 보기" });
    expect(dialog).toBeVisible();
    expect(dialog.querySelector("script, [href*='evil.test']")).toBeNull();
    expect(dialog.querySelector("text")).toHaveTextContent("safe fullscreen");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(expand).toHaveFocus();
    await user.click(expand);
    await user.click(screen.getByRole("button", { name: "다이어그램 닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(expand).toHaveFocus();
  });

  it("ignores a stale Mermaid render after its source changes", async () => {
    let resolveStale: ((value: { svg: string }) => void) | undefined;
    renderDiagram
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce({ svg: "<svg><text>fresh</text></svg>" });
    const view = render(<MermaidBlock source="flowchart LR\nOld --> Node" />);

    view.rerender(<MermaidBlock source="flowchart LR\nNew --> Node" />);
    expect(await screen.findByText("fresh")).toBeVisible();
    resolveStale?.({ svg: "<svg><text>stale</text></svg>" });

    await waitFor(() => expect(screen.queryByText("stale")).toBeNull());
  });
});
