import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialAuthoringState,
  type DocumentAuthoringState,
} from "../document-authoring-reducer";
import { NewDocumentDialog } from "./NewDocumentDialog";

afterEach(cleanup);

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
        },
        {
          id: "team:api/mockly.md",
          source: "team" as const,
          label: "Mockly API",
          description: "팀 계약",
          typeKey: "api_contract",
          defaults: { tags: ["api"] },
          richEditorCompatible: true,
        },
      ],
      diagnostics: [],
    },
  };
}

describe("NewDocumentDialog", () => {
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

    expect(screen.getByLabelText("폴더")).toHaveValue("docs/api");
    await user.click(screen.getByRole("button", { name: /Mockly API/ }));
    expect(screen.getByRole("button", { name: /Mockly API/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByLabelText("제목"), "지도 API");
    await user.clear(screen.getByLabelText("파일명"));
    await user.type(screen.getByLabelText("파일명"), "map-api.md");
    await user.click(screen.getByRole("button", { name: "문서 만들기" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: "docs/api",
        templateId: "team:api/mockly.md",
        title: "지도 API",
      }),
    );
  });

  it("duplicates the selected template into the Git-shared team catalog", async () => {
    const duplicate = vi.fn();
    const user = userEvent.setup();
    render(
      <NewDocumentDialog
        state={dialogState()}
        onClose={() => undefined}
        onCreate={() => undefined}
        onUseSuggestion={() => undefined}
        onDuplicateTemplate={duplicate}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "선택한 템플릿을 팀 템플릿으로 복제" }),
    );
    await user.type(screen.getByLabelText("표시 이름"), "우리 API 계약");
    await user.type(screen.getAllByLabelText("파일명")[1], "our-api.md");
    await user.click(screen.getByRole("button", { name: "팀 템플릿 만들기" }));
    expect(duplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTemplateId: "builtin:blank",
        fileName: "our-api.md",
        label: "우리 API 계약",
      }),
    );
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
    expect(screen.getByRole("button", { name: /빈 문서/ })).toBeVisible();
  });
});
