import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
