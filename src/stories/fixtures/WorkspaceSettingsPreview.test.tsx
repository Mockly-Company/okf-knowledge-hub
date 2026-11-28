import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceSettingsPreview } from "./WorkspaceSettingsPreview";

afterEach(cleanup);

describe("workspace settings design preview", () => {
  it("gives the account avatar an accessible image role", () => {
    render(<WorkspaceSettingsPreview />);
    expect(screen.getByRole("img", { name: "GitHub 계정 hyeeun" })).toHaveTextContent("HY");
  });
  it("saves all changes directly after confirmation without an approval step", async () => {
    const user = userEvent.setup(); render(<WorkspaceSettingsPreview />);
    await user.click(screen.getByRole("button", { name: "Project-OKF 기본으로 설정" }));
    await user.click(screen.getByRole("button", { name: "변경 저장" }));
    const dialog = within(screen.getByRole("dialog", { name: "변경 내용 확인" }));
    expect(dialog.getByText("운영 개선")).toBeVisible();
    expect(dialog.getByText("Project-OKF")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "저장" }));
    expect(await within(screen.getByRole("dialog")).findByText("저장 완료")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("button", { name: "변경 저장" })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Project-OKF" })).not.toHaveAttribute("data-change");
    expect(screen.queryByText("승인 대기")).not.toBeInTheDocument();
  });

  it("keeps edits when saving fails and allows retry", async () => {
    const user = userEvent.setup(); render(<WorkspaceSettingsPreview saveResult="failure" initialChanges />);
    await user.click(screen.getByRole("button", { name: "변경 저장" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했어요");
    expect(screen.getByRole("button", { name: "다시 저장" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("listitem", { name: "Project-OKF" })).toHaveAttribute("data-change", "modified");
    expect(screen.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  });

  it("never overwrites a newer version without another review", async () => {
    const user = userEvent.setup(); render(<WorkspaceSettingsPreview saveResult="conflict" initialChanges />);
    await user.click(screen.getByRole("button", { name: "변경 저장" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다른 사람이 설정을 먼저 변경했어요");
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
    expect(screen.getByRole("heading", { name: "다른 사람의 변경" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "내 변경" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다시 검토" }));
    const dialog = within(screen.getByRole("dialog", { name: "변경 내용 확인" }));
    expect(dialog.getByText("제품 개발")).toBeVisible();
    expect(dialog.getByText("Project-OKF")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "저장" }));
    expect(await within(screen.getByRole("dialog")).findByText("저장 완료")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("listitem", { name: "제품 개발" })).toBeVisible();
    expect(screen.getByRole("listitem", { name: "Project-OKF" })).toHaveTextContent("기본");
  });

  it("keeps children editable and keeps folder selections while filtering or collapsing", async () => {
    const user = userEvent.setup(); render(<WorkspaceSettingsPreview />);
    await user.click(screen.getByRole("button", { name: "hub-knowledge 편집" }));
    const dialog = within(screen.getByRole("dialog", { name: "저장소 편집" }));
    await user.click(dialog.getByRole("checkbox", { name: "api" }));
    expect(dialog.getByRole("checkbox", { name: "docs" })).toBePartiallyChecked();
    await user.click(dialog.getByRole("button", { name: "docs 접기" }));
    expect(dialog.queryByRole("checkbox", { name: "api" })).not.toBeInTheDocument();
    await user.type(dialog.getByRole("searchbox", { name: "폴더 검색" }), "api");
    expect(dialog.getByRole("checkbox", { name: "api" })).not.toBeChecked();
    await user.click(dialog.getByRole("checkbox", { name: "문서" }));
    expect(dialog.getByRole("searchbox", { name: "폴더 검색" })).toBeDisabled();
    await user.click(dialog.getByRole("checkbox", { name: "문서" }));
    expect(dialog.getByRole("checkbox", { name: "api" })).not.toBeChecked();
  });

  it("adds a second document repository without removing the first", async () => {
    const user = userEvent.setup(); render(<WorkspaceSettingsPreview />);
    await user.click(screen.getByRole("button", { name: "okf-knowledge-hub 편집" }));
    const dialog = within(screen.getByRole("dialog", { name: "저장소 편집" }));
    await user.click(dialog.getByRole("checkbox", { name: "문서" }));
    await user.click(dialog.getByRole("button", { name: "적용" }));
    expect(screen.getByRole("listitem", { name: "hub-knowledge" })).toHaveTextContent("문서");
    expect(screen.getByRole("listitem", { name: "okf-knowledge-hub" })).toHaveTextContent("문서");
    expect(screen.queryByLabelText("연결 해제 예정")).not.toBeInTheDocument();
  });

});
