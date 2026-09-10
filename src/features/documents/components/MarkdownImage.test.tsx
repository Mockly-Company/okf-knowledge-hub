import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownImage } from "./MarkdownImage";

afterEach(cleanup);

describe("MarkdownImage", () => {
  it("keeps alt text separate from an optional caption", async () => {
    const readAsset = vi.fn().mockResolvedValue({
      kind: "svg",
      source: '<svg xmlns="http://www.w3.org/2000/svg"><text>flow</text></svg>',
    });

    render(
      <MarkdownImage
        src="images/flow.svg"
        alt="검색 흐름 순서도"
        title="그림 1. 검색 요청 흐름"
        documentPath="docs/api.md"
        readAsset={readAsset}
      />,
    );

    expect(
      await screen.findByRole("img", { name: "검색 흐름 순서도" }),
    ).toBeVisible();
    expect(screen.getByText("그림 1. 검색 요청 흐름")).toBeVisible();
  });

  it("shows the filename and reason when the repository asset fails", async () => {
    const readAsset = vi.fn().mockRejectedValue(new Error("missing"));

    render(
      <MarkdownImage
        src="images/flow.svg"
        alt="검색 흐름"
        documentPath="docs/api.md"
        readAsset={readAsset}
      />,
    );

    expect(await screen.findByText("flow.svg")).toBeVisible();
    expect(screen.getByText("이미지를 표시할 수 없습니다.")).toBeVisible();
  });

  it("blocks remote image URLs with a compact fallback", () => {
    const readAsset = vi.fn();

    render(
      <MarkdownImage
        src="https://example.test/diagram.svg"
        alt="외부 다이어그램"
        documentPath="docs/api.md"
        readAsset={readAsset}
      />,
    );

    expect(screen.getByText("diagram.svg")).toBeVisible();
    expect(screen.getByText("외부 이미지는 표시할 수 없습니다.")).toBeVisible();
    expect(screen.queryByRole("img", { name: "외부 다이어그램" })).toBeNull();
  });
});
