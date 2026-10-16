import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Button } from "@/components/ui/button";
import { StatusFeedback } from "@/components/ui/status-feedback";
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
import "@/features/documents/documents.css";

const markdown = "---\ntitle: 지도 검색 API 계약\n---\n\n# 지도 검색 API 계약\n\n검색어와 좌표를 전달해 장소 후보를 찾습니다.\n\n## 요청\n\n- 검색어\n- 위도와 경도\n\n## 응답\n\n장소 후보와 오류 정보를 반환합니다.";
const editor: DocumentEditorState = {
  document: { changeId: "change", documentId: "document", path: "docs/api/map-search.md", markdown, contentHash: "hash", draft: { workspaceId: "workspace", changeId: "change", authorLogin: "storybook-bot", baseCommit: "base", branch: "draft/storybook/map-search", createdAtUnixMs: 1, lastOpenedAtUnixMs: 1 } },
  markdown, savedMarkdown: markdown, contentHash: "hash", saveStatus: "saved", saveRequestId: null, saveSnapshot: null, conflict: null, error: null, mode: "rich", closeAfterSave: false,
};
const baselineMarkdown = markdown.replace("- 검색어", "- 검색어 (제한 없음)").replace("- 위도와 경도", "- 위도와 경도 (필수)");

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
    setResult(request.intent === "publish" ? "발행 완료 시안 · 확정본에 반영된 상태입니다. 실제 Git 전송은 없습니다." : "검토 요청 완료 시안 · 확정본은 바뀌지 않습니다. 실제 PR 전송은 없습니다.");
    setEditing(false);
  };
  return <PageStoryFrame>{editing ? <DocumentDraftEditor readAsset={readAsset} copyText={copyText} editor={state} publication={{ baselineMarkdown: baseline, onSubmit: submit }} onMarkdownChange={(markdown) => { setResult(""); setState((current) => ({ ...current, markdown, saveStatus: error ? "error" : "dirty" })); }} onModeChange={(mode) => setState((current) => ({ ...current, mode }))} onAcceptDisk={() => {}} onAcceptHub={() => {}} onStartMerge={() => {}} onClose={() => setEditing(false)} /> : <section><div className="document-draft-editor__back-row"><h1>{documentTitle(state.markdown)}</h1><Button variant="secondary" onClick={() => setEditing(true)}>편집</Button></div>{result ? <StatusFeedback variant="content" tone="success">{result}</StatusFeedback> : <p className="document-draft-editor__local-note">로컬 초안 · 아직 발행하지 않은 작성 내용이 유지됩니다.</p>}<MarkdownDocument hideHeader document={{ summary: { path: editor.document.path, fileName: "map-search.md", title: documentTitle(state.markdown), documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: 0, size: state.markdown.length }, markdown: state.markdown, properties: {}, tableOfContents: [], lastCommit: null }} /></section>}</PageStoryFrame>;
}
const meta = { title: "Pages/DocumentEditor", component: EditorPreview, parameters: { layout: "fullscreen" }, decorators: [withAppProviders({ router: { initialEntries: ["/documents"] }, documents: { asset: markdownFixtures.localSvgAsset() } })] } satisfies Meta<typeof EditorPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Rich: Story = { args: { mode: "rich" }, play: async ({ canvas }) => {
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
  await expect(canvas.getByRole("status")).toHaveTextContent("자동 저장 대기중");
  await expect(await canvas.findByText("로컬에 자동 저장 완료")).toBeVisible();
  await userEvent.clear(title);
  await userEvent.type(title, "지도 검색 API 계약");
  await expect(await canvas.findByText("로컬에 자동 저장 완료")).toBeVisible();
  await expect(canvas.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
} };
export const Source: Story = { args: { mode: "source" } };
export const SaveError: Story = { args: { mode: "source", error: true } };

export const RichMarkdownSyntax: Story = {
  args: { mode: "rich", initialMarkdown: richEditorMarkdown },
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
  return <PageStoryFrame><p className="document-draft-editor__local-note">Storybook 시안 · 실제 Git 전송 없음</p><Button onClick={() => { setOpen(true); setResult(""); }}>변경사항 확인</Button>{result ? <StatusFeedback variant="content" tone="success">{result}</StatusFeedback> : null}<DocumentPublicationDialog open={open} onOpenChange={setOpen} intent={intent} path={editor.document.path} markdown={markdown} baselineMarkdown={baselineMarkdown} onSubmit={async () => { await new Promise(resolve => window.setTimeout(resolve, 500)); if (failure) throw new Error("simulated failure"); setResult(intent === "review" ? "검토 요청 완료 시안 · 확정본은 바뀌지 않았습니다." : "발행 완료 시안 · 실제 Git 전송은 없습니다."); }} /></PageStoryFrame>;
}

export const PublishConfirmation: Story = {
  render: () => <PublicationPreview />,
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
export const PublicationFailure: Story = { render: () => <PublicationPreview failure />, play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  const dialog = within(await page.findByRole("dialog"));
  await userEvent.type(dialog.getByRole("textbox", { name: /변경 설명/ }), "재시도할 설명");
  await userEvent.click(dialog.getByRole("button", { name: "발행하기" }));
  await expect(await dialog.findByRole("alert")).toHaveTextContent("초안과 변경 설명은 유지됩니다");
  await expect(dialog.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("재시도할 설명");
} };
