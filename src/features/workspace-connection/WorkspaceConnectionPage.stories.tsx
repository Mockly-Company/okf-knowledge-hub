import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect } from "storybook/test";
import { AppRoutes } from "@/app/AppRoutes";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";
import { StorybookAppProviders, useStorybookProviderBoundary, withAppProviders } from "@/stories/decorators/AppProviders";

interface StoryArgs { downloadOutcome?: "success" | "failure" }
function DemoRoutes() {
  const { state, selectRepository } = useWorkspaceConnection();
  const repository = state.step === "repository" ? state.repositories[0] : undefined;
  useEffect(() => { if (repository) selectRepository(repository); }, [repository, selectRepository]);
  return <AppRoutes documentsGateway={useStorybookProviderBoundary().documents} />;
}

const disconnected = withAppProviders({ workspace: { currentWorkspace: null }, includeDocumentsProvider: false });
const meta = { title: "Pages/WorkspaceConnection", component: WorkspaceConnectionPage, parameters: { layout: "fullscreen" } } satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;
export const Login: Story = { decorators: [withAppProviders({ workspace: { currentWorkspace: null, authState: { status: "signed_out" } }, includeDocumentsProvider: false })], play: async ({ canvas }) => { await expect(await canvas.findByRole("heading", { name: "GitHub에 연결" })).toBeVisible(); } };
export const LoginWaiting: Story = {
  decorators: [withAppProviders({ workspace: { currentWorkspace: null, authState: { status: "signed_out" } }, includeDocumentsProvider: false })],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "GitHub 로그인" }));
    await expect(await canvas.findByText("ABCD-EFGH")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "GitHub에서 인증 계속" })).toHaveAttribute("data-variant", "primary");
    await expect(canvas.queryByRole("button", { name: "로그인 취소" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "로그인 다시 시작" })).not.toBeInTheDocument();
  },
};
export const RepositorySelection: Story = { decorators: [disconnected], play: async ({ canvas, userEvent }) => {
  await expect(await canvas.findByRole("heading", { name: "OKF 저장소 선택" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "다음" })).toBeDisabled();
  await userEvent.click(canvas.getByRole("radio"));
  await expect(canvas.getByRole("button", { name: "다음" })).toBeEnabled();
} };
export const RepositorySelectionEmpty: Story = {
  decorators: [withAppProviders({ workspace: { currentWorkspace: null, repositories: [] }, includeDocumentsProvider: false })],
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("선택할 저장소가 없습니다.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "다음" })).toBeDisabled();
  },
};
export const RepositorySelectionLoading: Story = {
  decorators: [withAppProviders({ workspace: { currentWorkspace: null, repositoryLoading: true }, includeDocumentsProvider: false })],
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("status")).toHaveTextContent("저장소를 불러오는 중입니다.");
    await expect(canvas.getByRole("button", { name: "다음" })).toBeDisabled();
  },
};
export const LocalConnection: Story = {
  args: { downloadOutcome: "success" },
  argTypes: { downloadOutcome: { name: "다운로드 결과", control: "radio", options: ["success", "failure"], description: "성공은 실제 Home 화면으로, 실패는 재시도 가능한 오류로 이어집니다." } },
  render: ({ downloadOutcome = "success" }, context) => <StorybookAppProviders key={downloadOutcome} includeDocumentsProvider={false} workspace={{ currentWorkspace: null, cloneOutcome: downloadOutcome }} preferences={{ displayDensity: context.globals.displayDensity === "compact" ? "compact" : "default" }}><DemoRoutes /></StorybookAppProviders>,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(await canvas.findByRole("heading", { name: "로컬 연결" })).toBeVisible();
    await expect(canvas.getByRole("radio", { name: "이 기기의 저장소 연결" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "새로 다운로드해서 연결" })).toBeChecked();
    await expect(canvas.getByRole("textbox", { name: "다운로드 위치" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "폴더 선택" }));
    await expect(canvas.getByText(/\/demo-knowledge$/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "다운로드해서 연결" })).toBeEnabled();
    await expect(canvas.queryByRole("heading", { name: "다운로드 위치 확인" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("radio", { name: "새로 다운로드해서 연결" }));
    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("radio", { name: "이 기기의 저장소 연결" })).toBeChecked();
    await expect(canvas.getByRole("button", { name: "연결" })).toBeDisabled();
    canvasElement.dataset.reviewReady = "true";
  },
};

export const LocalConnectionError: Story = {
  decorators: [withAppProviders({ workspace: { currentWorkspace: null, existingCloneError: { code: "repository_path_conflict", message: "선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.", recovery: "choose_another_directory", details: {} } }, includeDocumentsProvider: false })],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("radio"));
    await userEvent.click(canvas.getByRole("button", { name: "다음" }));
    await userEvent.click(await canvas.findByRole("button", { name: "폴더 선택" }));
    await userEvent.click(canvas.getByRole("button", { name: "연결" }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
    const path = canvas.getByRole("textbox", { name: "저장소 폴더" });
    await expect(path).toHaveAttribute("aria-invalid", "true");
    await expect(path).toHaveAccessibleDescription("선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.");
    await expect(canvas.getByRole("button", { name: "변경" })).toBeVisible();
  },
};
