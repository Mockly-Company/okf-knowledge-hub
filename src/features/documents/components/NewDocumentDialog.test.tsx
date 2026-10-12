import { cleanup, render as renderBase, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { DocumentsProvider } from "../DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialAuthoringState,
  type DocumentAuthoringState,
} from "../document-authoring-reducer";
import { NewDocumentDialog } from "./NewDocumentDialog";

afterEach(cleanup);

function render(ui: ReactElement) {
  return renderBase(<DocumentsProvider gateway={new FakeDocumentsGateway()}>{ui}</DocumentsProvider>);
}

function dialogState(): DocumentAuthoringState {
  return {
    ...createInitialAuthoringState(),
    dialogOpen: true,
    defaultFolder: "docs/api",
    templatesStatus: "ready" as const,
    templateCatalog: {
      templates: [
        {
          id: "builtin:blank",
          source: "built_in" as const,
          label: "빈 문서",
          description: null,
          typeKey: null,
          defaults: { tags: [] },
          richEditorCompatible: true,
          body: "# {{title}}\n",
        },
        {
          id: "team:api/mockly.md",
          source: "team" as const,
          label: "Mockly API",
          description: "팀 계약",
          typeKey: "api_contract",
          defaults: { tags: ["api"] },
          richEditorCompatible: true,
          body: "# {{title}}\n\n## 팀 API 요청\n\n요청 내용을 작성합니다.\n",
        },
      ],
      diagnostics: [],
    },
  };
}

describe("NewDocumentDialog", () => {
  it("derives a valid filename from dotted titles without altering the document title", async () => {
    const user = userEvent.setup(); const create = vi.fn();
    render(<NewDocumentDialog state={dialogState()} onClose={() => undefined} onCreate={create} onUseSuggestion={() => undefined} onDuplicateTemplate={() => undefined} />);
    await user.type(screen.getByLabelText("제목"), "API v1.0");
    await user.click(screen.getByRole("button", {name: "문서 만들기"}));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({title: "API v1.0", fileName: "api-v1-0.md"}));
  });
  it("Escape cancels folder editing without dismissing the document dialog or losing the title", async () => {
    const user = userEvent.setup(); const close = vi.fn();
    render(<NewDocumentDialog state={dialogState()} onClose={close} onCreate={() => undefined} onUseSuggestion={() => undefined} onDuplicateTemplate={() => undefined} />);
    await user.type(screen.getByLabelText("제목"), "작성 중 문서");
    await user.click(screen.getByRole("button", {name: "새 폴더 만들기"}));
    await user.click(screen.getByRole("textbox", {name: "새 폴더 이름"}));
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("제목")).toHaveValue("작성 중 문서");
    expect(screen.queryByRole("textbox", {name: "새 폴더 이름"})).not.toBeInTheDocument();
  });
  it("shows a filled built-in example without using its title for document creation", async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    const state = dialogState();
    state.templateCatalog.templates.push({
      id: "builtin:api_contract", source: "built_in", label: "API 계약",
      description: null, typeKey: "api_contract", defaults: { tags: [] },
      body: "# {{title}}\n\n## 요청\n", richEditorCompatible: true,
    });
    render(<NewDocumentDialog state={state} onClose={() => undefined} onCreate={create}
      onUseSuggestion={() => undefined} onDuplicateTemplate={() => undefined} />);
    await user.click(screen.getByRole("combobox", { name: "템플릿" }));
    await user.click(await screen.findByRole("option", { name: /API 계약/ }));
    const preview = within(screen.getByRole("region", { name: "템플릿 미리보기" }));
    expect(preview.getByRole("heading", { name: "지도 검색 API 계약" })).toBeVisible();
    expect(preview.getByText(/예시 내용은 생성되는 문서에 포함되지 않습니다/)).toBeVisible();
    expect(preview.getByRole("heading", { name: "GET /api/places" })).toBeVisible();
    await user.type(screen.getByLabelText("제목"), "내 API 문서");
    await user.click(screen.getByRole("button", { name: "문서 만들기" }));
    expect(create).toHaveBeenCalledWith({title: "내 API 문서", fileName: "내-api-문서.md",
      folder: "docs/api", templateId: "builtin:api_contract", separateChange: false});
  });
  it("uses the same form for a tree folder and shows the selected template", async () => {
    const create = vi.fn();
    const user = userEvent.setup();
    render(
      <NewDocumentDialog
        state={dialogState()}
        onClose={() => undefined}
        onCreate={create}
        onUseSuggestion={() => undefined}
        onDuplicateTemplate={() => undefined}
      />,
    );

    expect(screen.getByRole("button", {name: "저장 폴더 선택"})).toHaveTextContent("docs / api");
    expect(screen.queryByRole("textbox", {name: "파일명"})).not.toBeInTheDocument();
    expect(screen.getByLabelText("제목")).toHaveAttribute("placeholder", "제목을 입력해주세요");
    expect(screen.getByLabelText("제목")).toHaveAccessibleDescription(/파일명은 제목으로 자동 생성/);
    await user.click(screen.getByRole("combobox", { name: "템플릿" }));
    await user.click(await screen.findByRole("option", { name: /Mockly API/ }));
    expect(screen.getByRole("combobox", { name: "템플릿" })).toHaveTextContent("Mockly API");
    expect(screen.getByRole("combobox", { name: "템플릿" })).toHaveAccessibleDescription("팀 계약");
    await user.type(screen.getByLabelText("제목"), "지도 API");
    const preview = within(screen.getByRole("region", { name: "템플릿 미리보기" }));
    expect(preview.getByRole("heading", { name: "지도 API" })).toBeVisible();
    expect(preview.getByRole("heading", { name: "팀 API 요청" })).toBeVisible();
    expect(preview.getByText("요청 내용을 작성합니다.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "문서 만들기" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: "docs/api",
        templateId: "team:api/mockly.md",
        title: "지도 API",
        fileName: "지도-api.md",
      }),
    );
  });

  it("keeps template management out of the document creation dialog", () => {
    render(
      <NewDocumentDialog
        state={dialogState()}
        onClose={() => undefined}
        onCreate={() => undefined}
        onUseSuggestion={() => undefined}
        onDuplicateTemplate={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /팀 템플릿으로 복제/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("표시 이름")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "별도 변경으로 만들기" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "템플릿" })).toHaveTextContent("빈 문서");
  });

  it("shows team template diagnostics without hiding valid templates", () => {
    const state = dialogState();
    state.templateCatalog.diagnostics = [
      {
        templateId: "team:broken.yml",
        message: "label 필드가 필요합니다.",
      },
    ];
    render(
      <NewDocumentDialog
        state={state}
        onClose={() => undefined}
        onCreate={() => undefined}
        onUseSuggestion={() => undefined}
        onDuplicateTemplate={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("team:broken.yml");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "label 필드가 필요합니다.",
    );
    expect(screen.getByRole("combobox", { name: "템플릿" })).toHaveTextContent("빈 문서");
  });
});
