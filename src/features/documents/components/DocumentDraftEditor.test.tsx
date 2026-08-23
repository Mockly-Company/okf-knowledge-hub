import { cleanup, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorState } from "../document-authoring-reducer";
import { DocumentDraftEditor } from "./DocumentDraftEditor";

const { setMarkdown } = vi.hoisted(() => ({
  setMarkdown: vi.fn(),
}));

vi.mock("@mdxeditor/editor", () => {
  const Empty = () => null;
  const plugin = () => ({});

  return {
    MDXEditor: forwardRef(function MockMdxEditor(
      { markdown }: { markdown: string },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ setMarkdown }));
      return <div data-testid="mdx-editor">{markdown}</div>;
    }),
    BlockTypeSelect: Empty,
    BoldItalicUnderlineToggles: Empty,
    CodeToggle: Empty,
    CreateLink: Empty,
    InsertCodeBlock: Empty,
    InsertImage: Empty,
    InsertTable: Empty,
    ListsToggle: Empty,
    UndoRedo: Empty,
    codeBlockPlugin: plugin,
    codeMirrorPlugin: plugin,
    frontmatterPlugin: plugin,
    headingsPlugin: plugin,
    imagePlugin: plugin,
    linkDialogPlugin: plugin,
    linkPlugin: plugin,
    listsPlugin: plugin,
    markdownShortcutPlugin: plugin,
    quotePlugin: plugin,
    tablePlugin: plugin,
    thematicBreakPlugin: plugin,
    toolbarPlugin: plugin,
  };
});

afterEach(() => {
  cleanup();
  setMarkdown.mockReset();
});

function editor(markdown: string): DocumentEditorState {
  return {
    document: {
      changeId: "change",
      documentId: "document",
      path: "docs/guide.md",
      markdown,
      contentHash: "hash",
      draft: {
        workspaceId: "workspace",
        changeId: "change",
        authorLogin: "hyeeun",
        baseCommit: "base",
        branch: "draft/hyeeun/change-guide",
        createdAtUnixMs: 1,
        lastOpenedAtUnixMs: 1,
      },
    },
    markdown,
    savedMarkdown: markdown,
    contentHash: "hash",
    saveStatus: "saved",
    saveRequestId: null,
    saveSnapshot: null,
    conflict: null,
    error: null,
    mode: "rich",
    closeAfterSave: false,
  };
}

describe("DocumentDraftEditor", () => {
  it("synchronizes rich editor content when the same document changes externally", () => {
    const props = {
      onMarkdownChange: vi.fn(),
      onModeChange: vi.fn(),
      onAcceptDisk: vi.fn(),
      onAcceptHub: vi.fn(),
      onStartMerge: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <DocumentDraftEditor editor={editor("# Before")} {...props} />,
    );

    rerender(<DocumentDraftEditor editor={editor("# After")} {...props} />);

    expect(setMarkdown).toHaveBeenCalledWith("# After");
  });

  it("keeps external-change decisions in a persistent content feedback region", () => {
    const conflicted = editor("# Hub edit");
    conflicted.saveStatus = "conflict";
    conflicted.conflict = {
      status: "conflict",
      changeId: "change",
      documentId: "document",
      path: "docs/guide.md",
      diskHash: "disk-hash",
      diskMarkdown: "# Disk edit",
      hubMarkdown: "# Hub edit",
    };

    render(
      <DocumentDraftEditor
        editor={conflicted}
        onMarkdownChange={() => {}}
        onModeChange={() => {}}
        onAcceptDisk={() => {}}
        onAcceptHub={() => {}}
        onStartMerge={() => {}}
        onClose={() => {}}
      />,
    );

    const feedback = screen.getByRole("alert");
    expect(feedback).toHaveAttribute("data-feedback-variant", "content");
    expect(feedback).toHaveAttribute("data-feedback-tone", "error");
    expect(feedback).toHaveTextContent("디스크에서 문서가 변경되었습니다.");
    expect(screen.getByRole("button", { name: "디스크 내용 사용" })).toBeVisible();
  });
});
