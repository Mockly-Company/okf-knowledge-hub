import { describe, expect, it } from "vitest";
import {
  documentTitle,
  isRichEditorCompatibleMarkdown,
  isDocumentTitleLinked,
  updateDocumentTitle,
} from "./document-markdown";

describe("document Markdown authoring", () => {
  it("keeps frontmatter title and the first H1 linked while they match", () => {
    const markdown = '---\nokf_hub_id: "id"\ntitle: "이전 제목"\n---\n\n# 이전 제목\n\n본문';
    expect(updateDocumentTitle(markdown, "새 제목")).toContain(
      'title: "새 제목"\n---\n\n# 새 제목',
    );
    expect(documentTitle(updateDocumentTitle(markdown, "새 제목"))).toBe(
      "새 제목",
    );
    expect(isDocumentTitleLinked(markdown)).toBe(true);
  });

  it("does not overwrite a separately edited first H1", () => {
    const markdown = '---\ntitle: "문서 제목"\n---\n\n# 별도 본문 제목\n';
    expect(updateDocumentTitle(markdown, "변경한 문서 제목")).toContain(
      "# 별도 본문 제목",
    );
    expect(isDocumentTitleLinked(markdown)).toBe(false);
  });

  it("keeps the first H1 linked after clearing and retyping the title", () => {
    const original = '---\ntitle: "이전 제목"\n---\n\n# 이전 제목\n\n본문';
    const cleared = updateDocumentTitle(original, "");
    expect(isDocumentTitleLinked(cleared)).toBe(true);
    const renamed = updateDocumentTitle(cleared, "새 제목");
    expect(renamed).toContain("# 새 제목\n\n본문");
    expect(isDocumentTitleLinked(renamed)).toBe(true);
  });

  it("keeps the first H1 linked while typing a space in the title", () => {
    const markdown = '---\ntitle: "지도"\n---\n\n# 지도\n\n본문';
    const withSpace = updateDocumentTitle(markdown, "지도 ");
    expect(isDocumentTitleLinked(withSpace)).toBe(true);
    expect(updateDocumentTitle(withSpace, "지도 검색")).toContain("# 지도 검색\n\n본문");
  });

  it("routes unsupported MDX and HTML syntax to source mode", () => {
    expect(isRichEditorCompatibleMarkdown("# 문서\n\n```mermaid\ngraph TD\n```"))
      .toBe(true);
    expect(isRichEditorCompatibleMarkdown("# 문서\n\n<Component />")).toBe(false);
    expect(isRichEditorCompatibleMarkdown("# 문서\n\n<div>raw</div>"))
      .toBe(false);
  });

  it("keeps unresolved manual merge markers in source mode", () => {
    expect(
      isRichEditorCompatibleMarkdown(
        "<<<<<<< 내 내용\nHub\n=======\nDisk\n>>>>>>> 디스크 내용\n",
      ),
    ).toBe(false);
  });
});
