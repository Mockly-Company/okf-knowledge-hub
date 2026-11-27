import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { WorkspaceSettingsPreview } from "./fixtures/WorkspaceSettingsPreview";

const meta = {
  id: "patterns-workspace-settings-preview",
  title: "UI 컴포넌트/패턴/워크스페이스 설정 시안",
  component: WorkspaceSettingsPreview,
  parameters: { layout: "fullscreen" },
  args: { folderSize: "few", access: "ready", saveResult: "success" },
  argTypes: {
    folderSize: { name: "폴더 목록", options: ["few", "many"], control: { type: "radio", labels: { few: "짧은 목록", many: "긴 목록" } } },
    access: { name: "저장소 접근", options: ["ready", "denied"], control: { type: "radio", labels: { ready: "정상", denied: "권한 없음" } } },
    saveResult: { name: "저장 결과", options: ["success", "failure", "conflict"], control: { type: "radio", labels: { success: "성공", failure: "저장 실패", conflict: "다른 사람의 수정" } } },
  },
} satisfies Meta<typeof WorkspaceSettingsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "워크스페이스 설정" };
export const ManyFolders: Story = { name: "긴 폴더 목록", args: { folderSize: "many" } };
export const AccessDenied: Story = { name: "저장소 접근 실패", args: { access: "denied" } };
export const SaveFailure: Story = { name: "저장 실패", args: { saveResult: "failure", initialChanges: true } };
export const ConcurrentChanges: Story = { name: "다른 사람이 먼저 수정", args: { saveResult: "conflict", initialChanges: true } };
export const ConcurrentSaveTest: Story = {
  tags: ["!dev", "!autodocs"], args: { saveResult: "conflict", initialChanges: true },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "변경 저장" }));
    let dialog = page.getByRole("dialog", { name: "변경 내용 확인" });
    await userEvent.click(within(dialog).getByRole("button", { name: "저장" }));
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent("다른 사람이 설정을 먼저 변경했어요");
    await userEvent.click(within(dialog).getByRole("button", { name: "최신 내용 확인" }));
    dialog = page.getByRole("dialog", { name: "최신 변경 확인" });
    await expect(within(dialog).getByRole("heading", { name: "다른 사람의 변경" })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "다시 검토" }));
    dialog = page.getByRole("dialog", { name: "변경 내용 확인" });
    await expect(within(dialog).getByText("제품 개발")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "저장" }));
    await expect(await page.findByRole("dialog", { name: "저장 완료" })).toBeVisible();
  },
};
export const AdditionRemovalAlignmentTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    async function checkRows() {
      const rows = [...canvasElement.querySelectorAll(".wsp-repository-row,.wsp-board-row")];
      const actionsRight = rows[0].querySelector(".wsp-row-actions,.wsp-board-actions")!.getBoundingClientRect().right;
      const indicatorX = rows[0].querySelector(".wsp-change-mark")!.getBoundingClientRect().left;
      for (const row of rows) {
        const heading = row.closest("section")!.querySelector("h2")!;
        const identity = row.querySelector(".wsp-row-identity")!;
        const name = identity.querySelector("strong")!;
        await expect(Math.abs(identity.getBoundingClientRect().left - heading.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
        await expect(Math.abs(row.querySelector(".wsp-row-actions,.wsp-board-actions")!.getBoundingClientRect().right - actionsRight)).toBeLessThanOrEqual(1);
        const actions = row.querySelector(".wsp-row-actions,.wsp-board-actions")!;
        const control = actions.querySelector("button,a");
        await expect(Math.abs(row.querySelector(".wsp-change-mark")!.getBoundingClientRect().left - indicatorX)).toBeLessThanOrEqual(1);
        if (!canvasElement.querySelector(".wsp-add-board")) await expect(Math.abs(actions.getBoundingClientRect().right - row.querySelector(".wsp-change-mark")!.getBoundingClientRect().right - 100)).toBeLessThanOrEqual(1);
        if (control) await expect(control.getBoundingClientRect().left - row.querySelector(".wsp-change-mark")!.getBoundingClientRect().right).toBeGreaterThanOrEqual(7);
        await expect(parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThan(parseFloat(getComputedStyle(name).fontSize));
        await expect(getComputedStyle(name).fontWeight).toBe("400");
      }
    }
    await checkRows();
    await userEvent.click(canvas.getByRole("button", { name: "저장소 추가" }));
    await userEvent.click(page.getByRole("button", { name: "example-team/team-docs" }));
    await userEvent.click(page.getByRole("button", { name: "적용" }));
    await userEvent.click(await canvas.findByRole("button", { name: "보드 편집" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "추가할 보드" }));
    await userEvent.click(page.getByRole("option", { name: "제품 개발 · #12" }));
    await userEvent.click(canvas.getByRole("button", { name: "추가" }));
    await expect(canvas.getByRole("listitem", { name: "제품 개발" })).toHaveAttribute("data-change", "added");
    await checkRows();
    await userEvent.click(canvas.getByRole("button", { name: "Project-OKF 연결 해제" }));
    await expect(canvas.getByRole("listitem", { name: "Project-OKF" })).toHaveAttribute("data-change", "removed");
    await checkRows();
    await userEvent.click(canvas.getByRole("button", { name: "Project-OKF 되돌리기" }));
    await expect(canvas.getByRole("listitem", { name: "Project-OKF" })).not.toHaveAttribute("data-change");
    await checkRows();
    await userEvent.click(canvas.getByRole("button", { name: "취소" }));
  },
};
export const AlignmentAndRequestTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const rows = [...canvasElement.querySelectorAll(".wsp-repository-row,.wsp-board-row")];
    const markX = (row: Element) => row.querySelector(".wsp-row-actions,.wsp-board-actions")!.getBoundingClientRect().right;
    for (const row of rows) {
      await expect(Math.abs(markX(row) - markX(rows[0]))).toBeLessThanOrEqual(1);
      await expect(Math.abs(row.getBoundingClientRect().height - rows[0].getBoundingClientRect().height)).toBeLessThanOrEqual(1);
      const heading = row.closest("section")!.querySelector("h2")!;
      const name = row.querySelector(".wsp-row-identity")!;
      await expect(Math.abs(name.getBoundingClientRect().left - heading.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
    }
    await userEvent.click(canvas.getByRole("button", { name: "hub-knowledge 편집" }));
    const dialog = page.getByRole("dialog", { name: "저장소 편집" });
    await waitFor(() => expect(Math.abs(dialog.getBoundingClientRect().height - Math.min(640, canvasElement.ownerDocument.defaultView!.innerHeight - 48))).toBeLessThanOrEqual(1));
    const height = dialog.getBoundingClientRect().height;
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "문서" }));
    await expect(Math.abs(dialog.getBoundingClientRect().height - height)).toBeLessThanOrEqual(1);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "문서" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "api" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "적용" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Project-OKF 기본으로 설정" }));
    await userEvent.click(await canvas.findByRole("button", { name: "변경 저장" }));
    const review = page.getByRole("dialog", { name: "변경 내용 확인" });
    const footer = review.querySelector("footer")!.getBoundingClientRect();
    await expect(footer.bottom).toBeLessThanOrEqual(canvasElement.ownerDocument.defaultView!.innerHeight);
    await expect(review.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    await userEvent.click(within(review).getByRole("button", { name: "저장" }));
    const saved = await page.findByRole("dialog", { name: "저장 완료" });
    await expect(within(saved).getByText("기본 보드")).toBeVisible();
  },
};
