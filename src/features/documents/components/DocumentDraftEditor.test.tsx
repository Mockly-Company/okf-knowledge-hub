import { cleanup, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
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
    CodeMirrorEditor: Empty,
    realmPlugin: () => plugin,
    addComposerChild$: "addComposerChild",
    addTableCellEditorChild$: "addTableCellEditorChild",
    addImportVisitor$: "addImportVisitor",
    openEditImageDialog$: "openEditImageDialog",
    useCodeBlockEditorContext: () => ({}),
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
  it("keeps publication entry available so review can be chosen inside", () => {
    render(<DocumentDraftEditor editor={editor("# 작성 중")} publication={{ publishDisabledReason: "수정 내용을 먼저 검토 요청으로 공유해주세요." }} onMarkdownChange={() => {}} onModeChange={() => {}} onAcceptDisk={() => {}} onAcceptHub={() => {}} onStartMerge={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "발행" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "검토 요청" })).not.toBeInTheDocument();
  });
  it("opens publication confirmation without changing the draft", async () => {
    const user = userEvent.setup(), change = vi.fn();
    render(<DocumentDraftEditor editor={editor("# 작성 중")} onMarkdownChange={change} onModeChange={() => {}} onAcceptDisk={() => {}} onAcceptHub={() => {}} onStartMerge={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "발행" }));
    expect(screen.getByRole("dialog", { name: "발행" })).toBeVisible();
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "작성 내용 설명");
    await user.click(screen.getByRole("button", { name: "작성으로 돌아가기" }));
    await user.click(screen.getByRole("button", { name: "발행" }));
    expect(screen.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("작성 내용 설명");
  });
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
