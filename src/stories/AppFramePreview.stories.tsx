import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within, userEvent, waitFor } from "storybook/test";
import { withAppProviders } from "./decorators/AppProviders";
import { AppFramePreview } from "./fixtures/AppFramePreview";
import { homeStateControl, homeListSizeControl } from "./fixtures/home-tasks";

const meta = {
  id: "patterns-app-frame-preview",
  title: "UI 컴포넌트/패턴/앱 프레임 시안",
  component: AppFramePreview,
  parameters: { layout: "fullscreen" },
  decorators: [withAppProviders()],
  args: { screen: "detail", initialCollapsed: false, platform: "macos" },
  argTypes: {
    screen: { name: "화면", options: ["home", "documents", "detail", "editor", "review"], control: { type: "select", labels: { home: "홈", documents: "문서 목록", detail: "문서 상세", editor: "편집", review: "리뷰" } } },
    initialCollapsed: { name: "데스크톱 최초 접힘", control: "boolean" },
    platform: { name: "운영체제", options: ["macos", "windows"], control: { type: "radio", labels: { macos: "macOS", windows: "Windows" } } },
    homeState: homeStateControl,
    homeListSize: homeListSizeControl,
  },
} satisfies Meta<typeof AppFramePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "공용 프레임" };
export const AccountIdentityTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    if (window.innerWidth < 1024) await userEvent.click(canvas.getByRole("button", { name: "탐색 메뉴 열기" }));
    const identity = await page.findByRole("group", { name: /GitHub 계정: @/ });
    await expect(within(identity).getByText("GitHub 계정", { exact: true })).toBeVisible();
    await expect(identity.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(identity.getBoundingClientRect().bottom).toBeGreaterThan(window.innerHeight - 80);
    if (window.innerWidth >= 1024) {
      await userEvent.click(canvas.getByRole("button", { name: "사이드바 접기" }));
      const compact = page.getByRole("group", { name: /GitHub 계정: @/ });
      await expect(within(compact).queryByText("GitHub 계정", { exact: true })).not.toBeInTheDocument();
      compact.focus();
      await expect(await page.findByRole("tooltip")).toHaveTextContent("GitHub 계정");
    }
  },
};
export const DocumentIntegrationTest: Story = {
  args: { screen: "documents" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const main = within(canvas.getByRole("main"));
    await userEvent.click(await main.findByRole("button", { name: /지도 검색 API 계약/ }));
    const picker = await main.findByRole("combobox", { name: "문서 작업 전환" });
    const pickerLeft = picker.getBoundingClientRect().left;
    const title = main.getByRole("heading", { level: 1, name: "지도 검색 API 계약" });
    await expect(picker.getBoundingClientRect().bottom).toBeLessThanOrEqual(title.getBoundingClientRect().top);
    const pickerText = canvasElement.ownerDocument.createRange();
    pickerText.selectNodeContents(picker.querySelector("span")!);
    await expect(Math.abs(title.getBoundingClientRect().left - pickerText.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
    const metadata = canvasElement.querySelector(".document-reader__meta")!;
    await expect(metadata.getBoundingClientRect().left).toBe(title.getBoundingClientRect().left);
    const readerPage = canvasElement.querySelector(".documents-page--reader")!;
    const available = canvas.getByRole("main").getBoundingClientRect();
    await expect(Math.abs(readerPage.getBoundingClientRect().width - Math.min(available.width, 1180))).toBeLessThanOrEqual(1);
    await expect(Math.abs(readerPage.getBoundingClientRect().left - available.left - (available.width - readerPage.getBoundingClientRect().width) / 2)).toBeLessThanOrEqual(1);
    await expect(canvasElement.querySelector(".markdown-document")!.getBoundingClientRect().left).toBe(title.getBoundingClientRect().left);
    const contextPanel = canvasElement.querySelector(".document-reader__context");
    if (contextPanel) {
      const actions = canvasElement.querySelector(".document-reader__actions")!;
      await expect(contextPanel.getBoundingClientRect().left - actions.getBoundingClientRect().right).toBeLessThanOrEqual(32);
    }
    const editLabel = canvasElement.ownerDocument.createRange();
    editLabel.selectNodeContents(main.getByRole("button", { name: "편집" }));
    await expect(editLabel.getClientRects().length).toBe(1);
    await userEvent.click(picker);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("option", { name: /변경 작업/ }));
    await expect(main.getByText("로컬 초안", { exact: true })).toBeVisible();
    await userEvent.click(main.getByRole("button", { name: "편집" }));
    const editorPicker = main.getByRole("combobox", { name: "문서 작업 전환" });
    await expect(Math.abs(editorPicker.getBoundingClientRect().left - pickerLeft)).toBeLessThanOrEqual(1);
    await expect(editorPicker.getBoundingClientRect().bottom).toBeLessThanOrEqual(main.getByRole("textbox", { name: "문서 제목" }).getBoundingClientRect().top);
    await userEvent.click(editorPicker);
    await userEvent.click(await page.findByRole("option", { name: "확정 문서" }));
    await expect(main.getByRole("button", { name: "편집" })).toBeVisible();
    await expect(main.getByText("확정본 · main")).toBeVisible();
  },
};
export const NavigationTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body);
    const toggle = canvas.getByRole("button", { name: /사이드바 접기|탐색 메뉴 열기/ });
    await expect(getComputedStyle(toggle).backgroundColor).toBe(getComputedStyle(canvasElement.querySelector(".frame-prototype__topbar")!).backgroundColor);
    if (window.innerWidth < 1024) {
      await userEvent.click(canvas.getByRole("button", { name: "편집" }));
      await expect(canvas.queryByRole("navigation", { name: "앱 탐색" })).not.toBeInTheDocument();
      const open = canvas.getByRole("button", { name: "탐색 메뉴 열기" });
      await userEvent.click(open);
      await expect(await page.findByRole("dialog", { name: "탐색 메뉴" })).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(open).toHaveFocus());
      await userEvent.click(open);
      await userEvent.click(canvasElement.ownerDocument.querySelector<HTMLElement>(".frame-prototype__scrim")!);
      await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(open).toHaveFocus());
      await userEvent.click(open);
      await userEvent.click(page.getByRole("button", { name: "Home" }));
      await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(canvas.getByRole("main")).toHaveFocus());
    } else {
      const name = canvas.getByText("Mockly", { exact: true });
      const title = canvas.getByRole("heading", { name: "지도 검색 API 계약", level: 1 });
      const workspace = canvasElement.querySelector(".frame-prototype__workspace")!;
      const sidebar = canvasElement.querySelector(".frame-prototype__sidebar")!;
      const folder = workspace.querySelector("svg")!;
      await expect(Math.abs(workspace.getBoundingClientRect().left - sidebar.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
      const selector = canvas.getByRole("combobox", { name: "문서 작업 전환" });
      await expect(selector.getBoundingClientRect().left).toBeGreaterThanOrEqual(folder.getBoundingClientRect().left);
      await expect(title.getBoundingClientRect().left).toBeGreaterThan(selector.getBoundingClientRect().left);
      await expect(canvas.getByRole("img", { name: args.platform === "windows" ? "Windows 창 제어 예시" : "macOS 창 제어 예시" })).toBeVisible();
      await expect(canvas.getByRole("button", { name: "뒤로 가기" })).toBeDisabled();
      await expect(canvas.getByRole("button", { name: "앞으로 가기" })).toBeDisabled();
      await expect(name.getBoundingClientRect().left).toBeGreaterThan(toggle.getBoundingClientRect().right);
      const main = canvas.getByRole("main");
      const before = main.getBoundingClientRect().width;
      await userEvent.click(canvas.getByRole("button", { name: "사이드바 접기" }));
      await expect(workspace.getBoundingClientRect().left).toBeGreaterThanOrEqual(toggle.getBoundingClientRect().right);
      await expect(main.getBoundingClientRect().width).toBeGreaterThan(before);
      await expect(canvas.queryByRole("region", { name: "문서 탐색" })).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Home" }));
      await expect(canvas.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
    }
    await expect(await canvas.findByRole("heading", { name: "내 작업" })).toBeVisible();
  },
};
export const WindowsNavigationTest: Story = { ...NavigationTest, args: { platform: "windows" }, tags: ["!dev", "!autodocs"] };
