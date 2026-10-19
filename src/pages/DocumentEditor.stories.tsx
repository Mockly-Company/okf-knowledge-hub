import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Button } from "@/components/ui/button";
import { PublicationSuccessToast } from "@/stories/fixtures/PublicationSuccessToast";
import { DocumentPublicationDialog, type DocumentPublicationRequest } from "@/features/documents/components/DocumentPublicationDialog";
import { MarkdownDocument } from "@/features/documents/components/MarkdownDocument";
import { documentTitle } from "@/features/documents/document-markdown";
import { DocumentDraftEditor } from "@/features/documents/components/DocumentDraftEditor";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import type { DocumentEditorState } from "@/features/documents/document-authoring-reducer";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";
import { allEditorMarkdown, richEditorMarkdown } from "@/stories/fixtures/editor-markdown";
import { markdownFixtures } from "@/stories/fixtures/markdown";
import { DocumentPublicationFlowPreview } from "@/stories/fixtures/DocumentPublicationFlowPreview";
import type { PublicationReviewState, PublicationBlocker } from "@/stories/fixtures/document-publication-flow";
import { documentCollaborationExample } from "@/stories/fixtures/document-collaboration-example";
import "@/features/documents/documents.css";

const markdown = documentCollaborationExample.proposal;
const editor: DocumentEditorState = {
  document: { changeId: "change", documentId: "document", path: "docs/api/map-search.md", markdown, contentHash: "hash", draft: { workspaceId: "workspace", changeId: "change", authorLogin: "storybook-bot", baseCommit: "base", branch: "draft/storybook/map-search", createdAtUnixMs: 1, lastOpenedAtUnixMs: 1 } },
  markdown, savedMarkdown: markdown, contentHash: "hash", saveStatus: "saved", saveRequestId: null, saveSnapshot: null, conflict: null, error: null, mode: "rich", closeAfterSave: false,
};
const baselineMarkdown = documentCollaborationExample.baseline;
const newDocumentMarkdown = markdown.replaceAll("지도 검색 API 계약", "새 API 문서");
const newDocumentEditor: DocumentEditorState = { ...editor, document: { ...editor.document, documentId: "new-document", path: "docs/api/new-api.md", markdown: newDocumentMarkdown }, markdown: newDocumentMarkdown, savedMarkdown: newDocumentMarkdown };

function EditorPreview({ mode = "rich", error = false, initialMarkdown = markdown }: { mode?: "rich" | "source"; error?: boolean; initialMarkdown?: string }) {
  const { readAsset, copyText } = useDocuments();
  const [editing, setEditing] = useState(true);
  const [baseline, setBaseline] = useState(initialMarkdown === markdown ? baselineMarkdown : "");
  const [result, setResult] = useState("");
  const [state, setState] = useState<DocumentEditorState>({ ...editor, document: { ...editor.document, markdown: initialMarkdown }, markdown: initialMarkdown, savedMarkdown: initialMarkdown, mode, ...(error ? { saveStatus: "error" as const, error: { code: "document_session_stale" as const, details: {}, message: "문서를 저장하지 못했습니다. 디스크 상태를 확인한 뒤 다시 저장하세요.", recovery: "retry" as const } } : {}) });
  useEffect(() => {
    if (state.markdown === state.savedMarkdown || error) return;
    // Storybook-only simulation; production saving is owned by DocumentsProvider.
    const saving = window.setTimeout(() => setState((current) => ({ ...current, saveStatus: "saving" })), 350);
    const saved = window.setTimeout(() => setState((current) => ({ ...current, saveStatus: "saved", savedMarkdown: current.markdown })), 900);
    return () => { window.clearTimeout(saving); window.clearTimeout(saved); };
  }, [state.markdown, state.savedMarkdown, error]);
  const submit = async (request: DocumentPublicationRequest) => {
    // Storybook-only simulation; no Git or network operations.
    await new Promise(resolve => window.setTimeout(resolve, 500));
    if (request.intent === "publish") setBaseline(request.markdown);
    setResult(request.intent === "publish" ? "문서를 발행했습니다." : "검토 요청을 보냈습니다.");
    setEditing(false);
  };
  return <PageStoryFrame>{editing ? <DocumentDraftEditor readAsset={readAsset} copyText={copyText} editor={state} publication={{ baselineMarkdown: baseline, onSubmit: submit }} onMarkdownChange={(markdown) => { setResult(""); setState((current) => ({ ...current, markdown, saveStatus: error ? "error" : "dirty" })); }} onModeChange={(mode) => setState((current) => ({ ...current, mode }))} onAcceptDisk={() => {}} onAcceptHub={() => {}} onStartMerge={() => {}} onClose={() => setEditing(false)} /> : <section><div className="document-draft-editor__back-row"><h1>{documentTitle(state.markdown)}</h1><Button variant="secondary" onClick={() => setEditing(true)}>편집</Button></div>{!result ? <p className="document-draft-editor__local-note">로컬 초안 · 아직 발행하지 않은 작성 내용이 유지됩니다.</p> : null}<MarkdownDocument hideHeader document={{ summary: { path: editor.document.path, fileName: "map-search.md", title: documentTitle(state.markdown), documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: 0, size: state.markdown.length }, markdown: state.markdown, properties: {}, tableOfContents: [], lastCommit: null }} /></section>}<PublicationSuccessToast message={result} /></PageStoryFrame>;
}
type EditorStoryArgs = Parameters<typeof EditorPreview>[0] & {
  reviewState?: PublicationReviewState;
  unpublishedChanges?: boolean;
  recoveryState?: "active" | "available" | "expired";
  newDocument?: boolean;
  publicationFailure?: boolean;
  publicationBlocker?: PublicationBlocker;
};
const reviewArgTypes = {
  reviewState: { name: "검토 상태", control: { type: "select", labels: { none: "없음 · 로컬 초안", pending: "검토 대기 중", changes_requested: "수정 요청됨", approved: "승인됨", merged: "발행 완료", closed: "검토 종료" } }, options: ["none", "pending", "changes_requested", "approved", "merged", "closed"], table: { disable: false } },
  unpublishedChanges: { name: "미공유 변경", control: "boolean", table: { disable: false } },
} satisfies Story["argTypes"];
const meta = { id: "pages-documenteditor", title: "화면/문서/작성·편집", component: EditorPreview,
  argTypes: {
    mode: { table: { disable: true } }, error: { table: { disable: true } }, initialMarkdown: { table: { disable: true } },
    reviewState: { table: { disable: true } }, unpublishedChanges: { table: { disable: true } }, recoveryState: { table: { disable: true } }, newDocument: { table: { disable: true } }, publicationFailure: { table: { disable: true } }, publicationBlocker: { table: { disable: true } },
  },
  parameters: { layout: "fullscreen", docs: { description: { component: "발행·검토 요청 흐름은 메모리 내 시뮬레이션이며 실제 GitHub 전송을 수행하지 않습니다." } } }, decorators: [withAppProviders({ router: { initialEntries: ["/documents"] }, documents: { asset: markdownFixtures.localSvgAsset() } })] } satisfies Meta<EditorStoryArgs>;
export default meta;
type Story = StoryObj<EditorStoryArgs>;
// Stable direct URLs for the existing visual audit; normal review uses Controls.
export const Rich: Story = { args: { mode: "rich" }, tags: ["!dev", "!autodocs"] };
export const Source: Story = { args: { mode: "source" }, tags: ["!dev", "!autodocs"] };
export const SaveError: Story = { args: { mode: "source", error: true }, tags: ["!dev", "!autodocs"] };
export const RichInteractionTest: Story = { ...Rich, tags: ["!dev", "!autodocs"], play: async ({ canvas }) => {
  const title = await canvas.findByLabelText("문서 제목");
  await expect(title).toHaveValue("지도 검색 API 계약");
  await expect(canvas.getByRole("combobox", { name: "본문" })).toBeVisible();
  const tab = canvas.getByRole("tab", { name: "문서 편집" });
  await expect(parseFloat(getComputedStyle(tab).paddingInlineStart)).toBeGreaterThanOrEqual(12);
  for (const name of ["굵게", "기울임", "밑줄"]) {
    const button = canvas.getByRole("radio", { name });
    const icon = button.querySelector("svg")!;
    await expect(button.getBoundingClientRect().width - icon.getBoundingClientRect().width).toBeGreaterThanOrEqual(16);
  }
  await userEvent.clear(title);
  await userEvent.type(title, "지도 검색 API 계약 수정");
  await expect(canvas.getByText("자동 저장 대기중", { exact: true })).toHaveAttribute("role", "status");
  await expect(await canvas.findByText("로컬에 자동 저장 완료")).toBeVisible();
  await userEvent.clear(title);
  await userEvent.type(title, "지도 검색 API 계약");
  await expect(await canvas.findByText("로컬에 자동 저장 완료")).toBeVisible();
  await expect(canvas.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
} };

export const RichMarkdownSyntax: Story = {
  args: { mode: "rich", initialMarkdown: richEditorMarkdown },
};
export const RichMarkdownSyntaxInteractionTest: Story = {
  ...RichMarkdownSyntax, tags: ["!dev", "!autodocs"],
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "제목 1", level: 1 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "제목 6", level: 6 })).toBeInTheDocument();
    for (const [index, size] of [32, 28, 24, 20, 18, 16].entries()) {
      await expect(getComputedStyle(canvas.getByRole("heading", { name: `제목 ${index + 1}`, level: index + 1 })).fontSize).toBe(`${size}px`);
    }
    const quote = canvas.getByText("사용자가 이해할 수 있는 표현으로 작성합니다.").closest("blockquote")!;
    await expect(parseFloat(getComputedStyle(quote.querySelector("p")!).marginBottom)).toBeLessThanOrEqual(8);
    await expect(getComputedStyle(quote.lastElementChild!).marginBottom).toBe("0px");
    const externalLink = canvas.getByRole("link", { name: "외부 문서 링크" });
    await expect(getComputedStyle(externalLink).textDecorationLine).toContain("underline");
    await expect(canvas.getAllByRole("combobox", { name: "코드 언어" })).toHaveLength(3);
    await expect(canvas.getByRole("table")).toBeInTheDocument();
    await expect(canvas.getByText("제목과 본문 작성", { exact: true })).toBeInTheDocument();
    const checks = canvas.getAllByRole("checkbox", { name: "완료 상태" });
    await expect(checks).toHaveLength(3);
    await expect(checks[0]).toBeChecked();
    await expect(checks[1]).toBeChecked();
    await expect(checks[2]).not.toBeChecked();
    await userEvent.click(checks[2]);
    await expect(checks[2]).toBeChecked();
    await userEvent.keyboard(" ");
    await expect(checks[2]).not.toBeChecked();
    const languages = canvas.getAllByRole("combobox", { name: "코드 언어" });
    await userEvent.click(languages[0]);
    const page = within(languages[0].ownerDocument.body);
    await userEvent.click(await page.findByRole("option", { name: "JavaScript" }));
    await expect(languages[0]).toHaveTextContent("JavaScript");
    await userEvent.click(languages[0]);
    await userEvent.click(await page.findByRole("option", { name: "TypeScript" }));
    await userEvent.click(canvas.getAllByRole("button", { name: "코드 복사" })[0]);
    await expect(await canvas.findByText("복사 완료")).toBeVisible();
    await userEvent.click(canvas.getAllByRole("button", { name: "코드 블록 삭제" })[2]);
    await expect(canvas.getAllByRole("combobox", { name: "코드 언어" })).toHaveLength(2);
    await userEvent.click(canvas.getByRole("radio", { name: /실행 취소/ }));
    await waitFor(() => expect(canvas.getAllByRole("combobox", { name: "코드 언어" })).toHaveLength(3));
    const image = canvas.getByRole("img", { name: "장소 검색 흐름" }) as HTMLImageElement;
    await waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0));
    await expect(image.getBoundingClientRect().width).toBeGreaterThan(100);
    await expect(image.getBoundingClientRect().height).toBeGreaterThan(0);
    await userEvent.click(image);
    await expect(canvas.getByRole("button", { name: "이미지 편집" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "이미지 삭제" })).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Markdown 원문" }));
    const source = canvas.getByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    for (const text of ["# 제목 1", "###### 제목 6", "~~취소선~~", "SearchRequest", "[장소 검색 흐름]", "latitude"]) {
      await expect(source.value).toContain(text);
    }
    for (const text of ["제목과 본문 작성", "코드와 링크 검토", "순서 없는 목록", "typescript"]) await expect(source.value).toContain(text);
    await expect(source.value).toContain("[x] 제목과 본문 작성");
    await userEvent.click(canvas.getByRole("tab", { name: "문서 편집" }));
  },
};

export const AllMarkdownSyntax: Story = {
  args: { mode: "source", initialMarkdown: allEditorMarkdown },
};
export const AllMarkdownSyntaxInteractionTest: Story = {
  ...AllMarkdownSyntax, tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole("textbox", { name: "Markdown 원문" })).toHaveValue(allEditorMarkdown);
    await expect(canvas.getByRole("tab", { name: "문서 편집" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.click(dialog.getByRole("tab", { name: "문서 미리보기" }));
    await expect(dialog.getByText("좌표의 기준은 WGS84입니다.")).toBeInTheDocument();
    await expect(dialog.getByText("오류 응답 예시 보기")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "작성으로 돌아가기" }));
    await expect(await canvas.findByRole("textbox", { name: "Markdown 원문" })).toHaveValue(allEditorMarkdown);
  },
};

export const HeadingHierarchy: Story = {
  args: { mode: "rich", initialMarkdown: "# 제목 1\n\n## 제목 2\n\n### 제목 3\n\n#### 제목 4\n\n##### 제목 5\n\n###### 제목 6\n\n일반 본문" },
};
export const HeadingHierarchyInteractionTest: Story = {
  tags: ["!dev", "!autodocs"],
  args: { mode: "source" },
  play: async ({ canvas }) => {
    await userEvent.clear(canvas.getByRole("textbox", { name: "Markdown 원문" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Markdown 원문" }), '---\ntitle: "제목 크기 검수"\n---\n\n# 제목 1\n\n## 제목 2\n\n### 제목 3\n\n#### 제목 4\n\n일반 본문');
    await userEvent.click(canvas.getByRole("tab", { name: "문서 편집" }));
    const bodySize = parseFloat(getComputedStyle(canvas.getByText("일반 본문", { exact: true })).fontSize);
    let previousSize = Infinity;
    for (const level of [1, 2, 3, 4]) {
      const size = parseFloat(getComputedStyle(canvas.getByRole("heading", { level })).fontSize);
      await expect(size).toBeGreaterThan(bodySize);
      await expect(size).toBeLessThan(previousSize);
      previousSize = size;
    }
  },
};

function PublicationPreview({ intent = "publish", failure = false }: { intent?: "publish" | "review"; failure?: boolean }) {
  const [open, setOpen] = useState(true), [result, setResult] = useState("");
  return <PageStoryFrame><Button onClick={() => { setOpen(true); setResult(""); }}>변경사항 확인</Button><PublicationSuccessToast message={result} /><DocumentPublicationDialog open={open} onOpenChange={setOpen} intent={intent} path={editor.document.path} markdown={markdown} baselineMarkdown={baselineMarkdown} onSubmit={async () => { await new Promise(resolve => window.setTimeout(resolve, 500)); if (failure) throw new Error("simulated failure"); setResult(intent === "review" ? "검토 요청을 보냈습니다." : "문서를 발행했습니다."); }} /></PageStoryFrame>;
}

export const PublishConfirmation: Story = {
  render: () => <PublicationPreview />,
};
export const PublishConfirmationInteractionTest: Story = {
  ...PublishConfirmation, tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = within(await page.findByRole("dialog", { name: "발행" }));
    await expect(dialog.getByRole("tab", { name: "원문 비교" })).toHaveAttribute("aria-selected", "true");
    const documentToggle = dialog.getByRole("button", { name: /지도 검색 API 계약.*docs\/api\/map-search.md/ });
    await userEvent.click(documentToggle);
    await expect(documentToggle).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.queryByRole("region", { name: "원문 변경사항" })).not.toBeInTheDocument();
    await userEvent.keyboard(" ");
    await expect(documentToggle).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByRole("button", { name: "발행하기" })).toBeDisabled();
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "검색 조건을 정리합니다");
    await expect(dialog.getByRole("button", { name: "발행하기" })).toBeEnabled();
    await userEvent.click(dialog.getByRole("tab", { name: "문서 미리보기" }));
    await expect(dialog.getByRole("region", { name: "현재 작성본 미리보기" })).toBeVisible();
    await userEvent.click(dialog.getByRole("tab", { name: "원문 비교" }));
  },
};
export const ReviewConfirmation: Story = { render: () => <PublicationPreview intent="review" /> };
export const PublicationFailure: Story = { render: () => <PublicationPreview failure /> };
export const PublicationFailureInteractionTest: Story = { ...PublicationFailure, tags: ["!dev", "!autodocs"], play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  const dialog = within(await page.findByRole("dialog"));
  await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "재시도할 설명");
  await userEvent.click(dialog.getByRole("button", { name: "발행하기" }));
  await expect(await dialog.findByRole("alert")).toHaveTextContent("초안과 변경 설명은 유지됩니다");
  await expect(dialog.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("재시도할 설명");
} };

export const PublicationFlow: Story = {
  name: "문서 편집",
  args: { mode: "rich", reviewState: "none", unpublishedChanges: false, error: false, publicationFailure: false, publicationBlocker: "none" },
  argTypes: {
    ...reviewArgTypes,
    mode: { name: "편집 모드", control: { type: "radio", labels: { rich: "문서 편집", source: "Markdown 원문" } }, options: ["rich", "source"], table: { disable: false } },
    error: { name: "자동 저장 실패", control: "boolean", table: { disable: false } },
    publicationFailure: { name: "발행 실패", control: "boolean", table: { disable: false } },
    publicationBlocker: { name: "발행 제한", control: { type: "select", labels: { none: "제한 없음 · 검사 통과", review: "필수 승인 미충족", checks_pending: "필수 검사 진행 중", checks: "필수 검사 실패", conflict: "병합 충돌", permission: "권한 없음" } }, options: ["none", "review", "checks_pending", "checks", "conflict", "permission"], table: { disable: false } },
  },
  render: (args) => <DocumentPublicationFlowPreview editor={{ ...editor, mode: args.mode ?? "rich", saveStatus: args.error ? "error" : "saved", error: args.error ? { code: "document_session_stale", details: {}, message: "문서를 저장하지 못했습니다. 디스크 상태를 확인한 뒤 다시 저장하세요.", recovery: "retry" } : null }} baseline={baselineMarkdown} reviewState={args.reviewState} unpublishedChanges={args.unpublishedChanges} failure={args.publicationFailure} publicationBlocker={args.publicationBlocker} />,
};
export const PublicationFlowInteractionTest: Story = {
  ...PublicationFlow, name: "발행 흐름 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "검색 조건을 정리합니다");
    await userEvent.click(dialog.getByRole("button", { name: "발행하기" }));
    await expect(await canvas.findByText("문서를 발행했습니다.")).toBeVisible();
    await expect(canvas.getByRole("region", { name: "문서 상태" })).toBeVisible();
    await expect(canvas.getAllByRole("heading", { name: "지도 검색 API 계약", level: 1 })).toHaveLength(1);
    const reader = canvas.getByRole("region", { name: "문서 상태" });
    const main = reader.closest("main")!;
    const mainBox = main.getBoundingClientRect();
    const readerBox = reader.getBoundingClientRect();
    const mainStyle = getComputedStyle(main);
    const leftGap = readerBox.left - mainBox.left - parseFloat(mainStyle.paddingLeft);
    const rightGap = mainBox.right - parseFloat(mainStyle.paddingRight) - readerBox.right;
    await expect(leftGap).toBeGreaterThanOrEqual(16);
    await expect(rightGap).toBeGreaterThanOrEqual(16);
    await expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
  },
};

export const ControlledReviewInteractionTest: Story = {
  ...PublicationFlow, name: "Controls 검토 상태 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "approved", unpublishedChanges: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("검토 승인됨")).toBeVisible();
    await expect(canvas.getByText("미공유 변경 있음")).toBeVisible();
    await expect(canvas.getByText("미공유 변경 있음")).toHaveAttribute("data-tone", "warning");
    await expect(canvas.getByRole("link", { name: "PR #42" })).toBeVisible();
  },
};

export const RepublishInteractionTest: Story = {
  ...PublicationFlow, name: "발행 후 새 초안 검토 요청 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "merged", mode: "source" },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("발행 완료")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "PR #42" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^편집$/ }));
    await expect(await canvas.findByText("로컬 초안")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "PR #42" })).not.toBeInTheDocument();
    const source = await canvas.findByRole("textbox", { name: "Markdown 원문" });
    await userEvent.type(source, "\n\n재발행할 추가 설명입니다.");
    await userEvent.click(canvas.getByRole("button", { name: /^발행$/ }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.click(dialog.getByRole("radio", { name: "검토 요청" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "추가 설명을 검토 요청합니다");
    await userEvent.click(dialog.getByRole("button", { name: "검토 요청 보내기" }));
    await expect(await canvas.findByText("PR #43로 검토를 요청했습니다.")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "PR #43" })).toHaveAttribute("href", "https://github.com/Mockly-Company/okf-knowledge-hub/pull/43");
    await expect(canvas.getByText("검토 대기중")).toBeVisible();
    await expect(canvas.queryByText("검토 승인됨")).not.toBeInTheDocument();
  },
};

export const ControlledRecoveryInteractionTest: Story = {
  name: "Controls 복구 상태 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { recoveryState: "expired", newDocument: true, reviewState: "none" },
  render: (args) => <DocumentPublicationFlowPreview editor={args.newDocument ? newDocumentEditor : editor} baseline={args.newDocument ? "" : baselineMarkdown} reviewState={args.reviewState} discarded={args.recoveryState !== "active"} expired={args.recoveryState === "expired"} />,
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("heading", { name: "Documents" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "최근 삭제한 초안" }));
    const page = within(canvasElement.ownerDocument.body);
    const deleted = within(await page.findByRole("dialog", { name: "최근 삭제한 초안" }));
    await waitFor(() => expect(deleted.getByText("최근 삭제한 초안이 없습니다.")).toBeVisible());
    await expect(deleted.queryByRole("button", { name: "초안 복구" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "PR #42" })).not.toBeInTheDocument();
  },
};

const ReviewPending: Story = {
  name: "검토 요청한 문서",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} review="pending" />,
};
export const ReviewPendingInteractionTest: Story = {
  ...ReviewPending, name: "검토 상태 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas }) => {
    const metadata = within(canvas.getByRole("group", { name: "문서 정보" }));
    await expect(metadata.getByText("docs/api/map-search.md")).toBeVisible();
    const prLink = metadata.getByRole("link", { name: "PR #42" });
    await expect(prLink).toHaveAttribute("href", "https://github.com/Mockly-Company/okf-knowledge-hub/pull/42");
    await expect(prLink.getBoundingClientRect().top).toBeGreaterThanOrEqual(metadata.getByText("docs/api/map-search.md").getBoundingClientRect().bottom);
    await expect(metadata.getByText("검토 대기중")).toBeVisible();
    await expect(metadata.getByText("검토 대기중")).toHaveAttribute("data-tone", "info");
    await expect(canvas.getByRole("button", { name: "변경 취소" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "발행" })).toBeEnabled();
  },
};

const ReviewApproved: Story = {
  name: "승인 후 발행 대기",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} review="approved" />,
};
export const ReviewApprovedInteractionTest: Story = {
  ...ReviewApproved, name: "승인 상태 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("검토 승인됨")).toBeVisible();
    await expect(canvas.queryByText("문서를 발행했습니다.")).not.toBeInTheDocument();
    await expect(canvas.getByText("검토 승인됨")).toHaveAttribute("data-tone", "success");
    await expect(canvas.getByRole("button", { name: "발행" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await waitFor(() => expect(dialog.getByRole("region", { name: "원문 변경사항" })).toBeVisible());
    await expect(dialog.queryByRole("textbox", { name: /변경 설명/ })).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "작성으로 돌아가기" }));
  },
};

const ReviewUpdate: Story = {
  name: "기존 PR에 수정본 공유",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} review="changed" />,
};
export const ReviewUpdateInteractionTest: Story = {
  ...ReviewUpdate, name: "수정본 공유 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("미공유 변경 있음")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "검토 요청" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.click(dialog.getByRole("radio", { name: "검토 요청" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "좌표를 선택 입력으로 설명합니다");
    await userEvent.click(dialog.getByRole("button", { name: "검토 요청 보내기" }));
    await expect(await canvas.findByText("PR #42에 수정 내용을 반영했습니다.")).toBeVisible();
    await expect(canvas.getByText("검토 승인됨")).toBeVisible();
    await expect(canvas.getByText("재검토 필요")).toBeVisible();
    await expect(canvas.getByText("재검토 필요")).toHaveAttribute("data-tone", "warning");
    await expect(canvas.queryByText("문서를 발행했습니다.")).not.toBeInTheDocument();
  },
};

export const RequestedRevisionInteractionTest: Story = {
  ...PublicationFlow, name: "수정 요청 유지 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "changes_requested", unpublishedChanges: true },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.click(dialog.getByRole("radio", { name: "검토 요청" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "요청한 내용 수정");
    await userEvent.click(dialog.getByRole("button", { name: "검토 요청 보내기" }));
    await expect(await canvas.findByText("PR #42에 수정 내용을 반영했습니다.")).toBeVisible();
    await expect(canvas.getByText("수정 요청됨")).toBeVisible();
  },
};
export const ApprovedChecksInteractionTest: Story = {
  ...PublicationFlow, name: "승인과 발행 제한 분리 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "approved", publicationBlocker: "checks" },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("검토 승인됨")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await expect(dialog.getByRole("button", { name: "발행하기" })).toBeDisabled();
    await expect(dialog.getByText("필수 검사를 통과해야 발행할 수 있습니다.")).toBeInTheDocument();
  },
};

function ChecksTransitionTestPreview() {
  const [blocker, setBlocker] = useState<PublicationBlocker>("checks_pending");
  useEffect(() => {
    const update = (event: Event) => setBlocker((event as CustomEvent<PublicationBlocker>).detail);
    document.addEventListener("test-publication-checks", update);
    return () => document.removeEventListener("test-publication-checks", update);
  }, []);
  return <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} reviewState="pending" unpublishedChanges publicationBlocker={blocker} />;
}

export const ChecksRetryInteractionTest: Story = {
  name: "검사 상태 변경 후 입력 유지·재시도 자동 테스트", tags: ["!dev", "!autodocs"],
  render: () => <ChecksTransitionTestPreview />,
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const page = within(canvasElement.ownerDocument.body);
    let dialog = within(await page.findByRole("dialog", { name: "발행" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "검사 후 발행할 설명");
    await expect(dialog.getByText("필수 검사가 진행 중입니다. 완료 후 발행할 수 있습니다.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "발행하기" })).toBeDisabled();
    canvasElement.ownerDocument.dispatchEvent(new CustomEvent("test-publication-checks", { detail: "checks" }));
    await waitFor(() => expect(page.getByText("필수 검사를 통과해야 발행할 수 있습니다.")).toBeVisible());
    await expect(dialog.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("검사 후 발행할 설명");
    canvasElement.ownerDocument.dispatchEvent(new CustomEvent("test-publication-checks", { detail: "none" }));
    await waitFor(() => expect(page.getByRole("dialog", { name: "발행" })).toBeVisible());
    dialog = within(page.getByRole("dialog", { name: "발행" }));
    await expect(dialog.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("검사 후 발행할 설명");
    await waitFor(() => expect(dialog.getByRole("button", { name: "발행하기" })).toBeEnabled());
    await userEvent.click(dialog.getByRole("button", { name: "발행하기" }));
    await expect(await canvas.findByText("문서를 발행했습니다.")).toBeVisible();
    await expect(canvas.getByText("추가로 작성한 내용입니다.")).toBeVisible();
  },
};
export const ClosedReviewInteractionTest: Story = {
  ...PublicationFlow, name: "종료 PR에서 새 검토 요청 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "closed" },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "편집" }));
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await expect(dialog.getByRole("button", { name: "발행하기" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("radio", { name: "검토 요청" }));
    await expect(dialog.getByText("기존 PR이 종료되었습니다. 새 PR로 검토를 요청합니다.")).toBeVisible();
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "새 검토를 요청합니다");
    await userEvent.type(dialog.getByRole("textbox", { name: /검토 요청 메모/ }), "다시 검토해주세요");
    await userEvent.click(dialog.getByRole("button", { name: "검토 요청 보내기" }));
    await expect(await canvas.findByText("PR #43로 검토를 요청했습니다.")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "PR #43" })).toBeVisible();
    await expect(canvas.getByText("검토 대기중")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "PR #42" })).not.toBeInTheDocument();
  },
};
export const DirectRevisionPublicationInteractionTest: Story = {
  ...PublicationFlow, name: "선택 검토 후 수정본 직접 발행 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...PublicationFlow.args, reviewState: "approved", unpublishedChanges: true },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "발행" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "발행" }));
    await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "최신 수정본 발행");
    await userEvent.click(dialog.getByRole("button", { name: "발행하기" }));
    await expect(await canvas.findByText("문서를 발행했습니다.")).toBeVisible();
    await expect(canvas.getByText("발행 완료")).toBeVisible();
  },
};

export const DraftDiscard: Story = {
  name: "변경 취소와 복구",
  args: { reviewState: "pending", unpublishedChanges: false, recoveryState: "active", newDocument: false },
  argTypes: {
    ...reviewArgTypes,
    recoveryState: { name: "복구 상태", control: { type: "select", labels: { active: "작성 중", available: "복구 가능", expired: "7일 만료" } }, options: ["active", "available", "expired"], table: { disable: false } },
    newDocument: { name: "미발행 새 문서", control: "boolean", table: { disable: false } },
  },
  render: (args) => <DocumentPublicationFlowPreview editor={args.newDocument ? newDocumentEditor : editor} baseline={args.newDocument ? "" : baselineMarkdown} reviewState={args.newDocument ? "none" : args.reviewState} unpublishedChanges={args.unpublishedChanges} discarded={args.recoveryState !== "active"} expired={args.recoveryState === "expired"} />,
};
export const NewDocumentDiscardInteractionTest: Story = {
  ...DraftDiscard, name: "새 문서 취소 후 목록 이동 자동 테스트", tags: ["!dev", "!autodocs"],
  args: { ...DraftDiscard.args, newDocument: true },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "변경 취소" }));
    const confirm = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "변경 내용을 버릴까요?" }));
    await expect(confirm.getByText("새 문서를 삭제합니다.")).toBeInTheDocument();
    await expect(confirm.getByText("버린 내용은 7일간 복구할 수 있습니다.")).toBeInTheDocument();
    await userEvent.click(confirm.getByRole("button", { name: "변경 버리기" }));
    await expect(await canvas.findByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /새 API 문서/ })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "실행 취소" }));
    await expect(await canvas.findByRole("textbox", { name: "문서 제목" })).toHaveValue("새 API 문서");
  },
};
export const DraftDiscardConfirmation: Story = {
  name: "변경 취소 확인창",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} review="pending" initialDiscardOpen />,
};
export const DraftDiscardConfirmationInteractionTest: Story = {
  ...DraftDiscardConfirmation, name: "변경 취소 확인창 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: "변경 내용을 버릴까요?" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};
export const DraftDiscardInteractionTest: Story = {
  ...DraftDiscard, name: "변경 취소와 복구 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "변경 취소" }));
    let dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "변경 내용을 버릴까요?" }));
    await waitFor(() => expect(dialog.getByText("PR에 공유한 내용은 유지됩니다.")).toBeVisible());
    await userEvent.click(dialog.getByRole("button", { name: "계속 편집" }));
    await expect(canvas.getByRole("region", { name: "문서 편집기" })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "변경 취소" }));
    dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "변경 내용을 버릴까요?" }));
    await userEvent.click(dialog.getByRole("button", { name: "변경 버리기" }));
    const notice = await canvas.findByText("변경을 취소했습니다.");
    await expect(notice.closest('[data-feedback-variant="toast"]')).toBeVisible();
    await expect(canvas.getByRole("region", { name: "문서 상태" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "실행 취소" }));
    await expect(canvas.getByRole("region", { name: "문서 편집기" })).toBeVisible();
    await expect(canvas.getByText("검토 대기중")).toBeVisible();
  },
};

const DraftDiscarded: Story = {
  name: "폐기한 초안 · 복구 가능",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} review="pending" discarded />,
};
export const DraftDiscardedInteractionTest: Story = {
  ...DraftDiscarded, name: "복구 가능 상태 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("검토 대기중")).toBeVisible();
    await expect(canvas.queryByText("미공유 변경 있음")).not.toBeInTheDocument();
    await expect(canvas.queryByText("로컬 초안을 폐기했습니다.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "문서 목록" }));
    await userEvent.click(canvas.getByRole("button", { name: "최근 삭제한 초안" }));
    const deleted = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "최근 삭제한 초안" }));
    await userEvent.click(deleted.getByRole("button", { name: "초안 복구" }));
    await expect(await canvas.findByRole("region", { name: "문서 편집기" })).toBeVisible();
  },
};
const DraftRecoveryExpired: Story = {
  name: "폐기한 초안 · 7일 만료",
  render: () => <DocumentPublicationFlowPreview editor={editor} baseline={baselineMarkdown} discarded expired />,
};
export const DraftRecoveryExpiredInteractionTest: Story = {
  ...DraftRecoveryExpired, name: "복구 만료 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "문서 목록" }));
    await userEvent.click(canvas.getByRole("button", { name: "최근 삭제한 초안" }));
    const deleted = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "최근 삭제한 초안" }));
    await waitFor(() => expect(deleted.getByText("최근 삭제한 초안이 없습니다.")).toBeVisible());
    await expect(deleted.queryByRole("button", { name: "초안 복구" })).not.toBeInTheDocument();
  },
};
