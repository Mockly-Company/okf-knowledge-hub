import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("MarkdownCodeBlock", () => {
  it.each(["typescript", "unknown-lang"])("styles every %s search-match segment while keeping one scroll target", (language) => {
    const source = 'const value = "ok";';
    const { container } = render(
      <MarkdownCodeBlock language={language} source={source} searchMatch={{ start: 0, end: source.length }} onCopy={vi.fn()} />,
    );
    const segments = [...container.querySelectorAll("mark")];
    expect(segments.map((segment) => segment.textContent).join("")).toBe(source);
    if (language === "typescript") expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(segment).toHaveClass("markdown-code-block__search-match");
    expect(container.querySelectorAll("mark[data-search-match]")).toHaveLength(1);
    expect(segments[0]).toHaveAttribute("data-search-match");
  });

  it("lets keyboard users reach the code scroll region after its copy action", async () => {
    render(<MarkdownCodeBlock source="long code" onCopy={vi.fn()} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "코드 복사" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("region", { name: "코드 가로 스크롤" })).toHaveFocus();
  });

  it("highlights a registered language and copies the unmodified source", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MarkdownCodeBlock
        language="typescript"
        source={'const value = "ok";'}
        onCopy={onCopy}
      />,
    );

    expect(document.querySelector(".hljs-keyword")).toHaveTextContent("const");
    await user.click(screen.getByRole("button", { name: "코드 복사" }));
    expect(onCopy).toHaveBeenCalledWith('const value = "ok";');
    expect(screen.getByRole("button", { name: "복사됨" })).toBeVisible();
  });

  it("restores the copy label after 1,200 milliseconds", async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<MarkdownCodeBlock language="text" source="value" onCopy={onCopy} />);

    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "복사됨" })).toBeVisible();
    act(() => vi.advanceTimersByTime(1_200));
    expect(screen.getByRole("button", { name: "코드 복사" })).toBeVisible();
  });

  it("uses plain selectable text for an unknown language", () => {
    render(
      <MarkdownCodeBlock
        language="unknown-lang"
        source="plain value"
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText("plain value").closest("code")).not.toBeNull();
    expect(document.querySelector("[class*='hljs-']")).toBeNull();
  });

  it("keeps the original copy label when copying fails", async () => {
    const onCopy = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
    const user = userEvent.setup();

    render(<MarkdownCodeBlock source="value" onCopy={onCopy} />);
    await user.click(screen.getByRole("button", { name: "코드 복사" }));

    expect(screen.getByRole("button", { name: "코드 복사" })).toBeVisible();
  });
});
