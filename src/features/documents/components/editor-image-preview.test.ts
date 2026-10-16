import { describe, expect, it, vi } from "vitest";
import { createEditorImagePreview } from "./editor-image-preview";

describe("editor image preview", () => {
  it("resolves relative repository images without changing their Markdown path", async () => {
    const read = vi.fn().mockResolvedValue({ kind: "raster", mimeType: "image/png", base64: "AAAA" });
    expect(await createEditorImagePreview("docs/page.md", read)("./assets/map.png#x")).toBe("data:image/png;base64,AAAA");
    expect(read).toHaveBeenCalledWith("docs/page.md", "./assets/map.png");
  });
  it("blocks external URLs and repository escapes without fetching them", async () => {
    const read = vi.fn();
    for (const src of ["https://example.com/a.png", "../../a.png", "data:image/svg+xml,a"]) {
      expect(decodeURIComponent(await createEditorImagePreview("docs/page.md", read)(src))).toContain("이미지를 표시할 수 없습니다");
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("sanitizes SVG and gives a visible fallback on failure", async () => {
    const preview = createEditorImagePreview("docs/page.md", vi.fn().mockResolvedValue({ kind: "svg", source: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>' }));
    expect(decodeURIComponent(await preview("a.svg"))).not.toContain("<script>");
    expect(decodeURIComponent(await createEditorImagePreview("docs/page.md", vi.fn().mockRejectedValue(new Error("no")))("a.svg"))).toContain("이미지를 표시할 수 없습니다");
  });
});
