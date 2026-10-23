import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor } from "storybook/test";
import { SettingsPage } from "./SettingsPage";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";

const buildInfoGateway = { getBuildInfo: async () => ({ mode: "development" as const, branch: "feat/design-system-rollout", commit: "e25ad3f", dirty: true, credentialBackend: "system keychain" }) };
const meta = { id: "pages-settingspage", title: "화면/설정", component: SettingsPage, parameters: { layout: "fullscreen" }, decorators: [withAppProviders({ router: { initialEntries: ["/settings"] } })], render: () => <PageStoryFrame><SettingsPage buildInfoGateway={buildInfoGateway} /></PageStoryFrame> } satisfies Meta<typeof SettingsPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Display: Story = {};
export const Workspace: Story = { play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "워크스페이스" })); await expect(canvas.getByRole("heading", { name: "워크스페이스" })).toBeVisible(); } };
export const Connections: Story = { play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "외부 연결" })); await expect(canvas.getByRole("button", { name: "로그아웃" })).toBeVisible(); } };
export const LogoutConfirmation: Story = { play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "외부 연결" })); await userEvent.click(await canvas.findByRole("button", { name: "로그아웃" })); await waitFor(() => expect(screen.getByRole("alertdialog")).toBeVisible()); } };
export const AppInformation: Story = { play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "앱 정보" })); await expect(await canvas.findByText("system keychain")).toBeVisible(); } };
