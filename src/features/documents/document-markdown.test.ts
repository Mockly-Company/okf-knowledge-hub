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
