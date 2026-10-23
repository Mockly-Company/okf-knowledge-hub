import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { AppFramePreview } from "./AppFramePreview";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// jsdom has no text layout API; real layout is covered by the browser matrix.
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
beforeAll(() => Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] }));
afterAll(() => { if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects); else delete (Range.prototype as Partial<Range>).getClientRects; });
function show(initialCollapsed = false, platform: "macos" | "windows" = "macos") {
  return render(<MemoryRouter><PreferencesProvider repository={new FakePreferencesRepository()}><WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}><DocumentsProvider gateway={new FakeDocumentsGateway()}><AppFramePreview screen="detail" initialCollapsed={initialCollapsed} platform={platform} /></DocumentsProvider></WorkspaceConnectionProvider></PreferencesProvider></MemoryRouter>);
}
describe("Storybook app frame", () => {
  it("keeps the connected account at the bottom in expanded and collapsed navigation", async () => {
    const user = userEvent.setup(); show();
    const account = await screen.findByRole("group", { name: /GitHub 계정: @/ });
    expect(within(account).getByText("GitHub 계정", { exact: true })).toBeVisible();
    expect(account.textContent).toMatch(/@/);
    fireEvent.error(account.querySelector("img")!);
    expect(account.querySelector(".frame-prototype__avatar")).toHaveTextContent("H");
    await user.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.getByRole("group", { name: /GitHub 계정:/ })).toBeVisible();
    expect(screen.queryByText("GitHub 계정", { exact: true })).not.toBeInTheDocument();
  });
  it("opens Documents at the shared list and keeps the version picker above the document title", async () => {
    const user = userEvent.setup(); show();
    await user.click(within(screen.getByRole("navigation", { name: "앱 탐색" })).getByRole("button", { name: "Documents" }));
    expect(await screen.findByRole("searchbox", { name: "문서 검색" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /지도 검색 API 계약/ }));
    const picker = await screen.findByRole("combobox", { name: "문서 작업 전환" });
    const title = screen.getByRole("heading", { level: 1, name: "지도 검색 API 계약" });
    expect(picker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.getByRole("combobox", { name: "문서 작업 전환" })).toBeVisible();
  });
  it("uses Windows caption controls instead of macOS traffic lights when selected", () => {
    show(false, "windows");
    expect(screen.getByRole("img", { name: "Windows 창 제어 예시" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "macOS 창 제어 예시" })).not.toBeInTheDocument();
  });
  it("navigates visit history and discards forward entries after a new destination", async () => {
    const user = userEvent.setup(); show();
    const back = screen.getByRole("button", { name: "뒤로 가기" });
    const forward = screen.getByRole("button", { name: "앞으로 가기" });
    expect(back).toBeDisabled(); expect(forward).toBeDisabled();
    const nav = within(screen.getByRole("navigation", { name: "앱 탐색" }));
    await user.click(nav.getByRole("button", { name: "Home" }));
    await user.click(nav.getByRole("button", { name: "Project" }));
    await user.click(back);
    expect(nav.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await user.click(back);
    expect(nav.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "page");
    expect(back).toBeDisabled();
    await user.click(forward);
    expect(nav.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await user.click(nav.getByRole("button", { name: "Settings" }));
    expect(forward).toBeDisabled();
  });
  it("restores the mobile opener after editing and cancelling navigation", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 1023px)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } }));
    const user = userEvent.setup(); show();
    await user.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.queryByRole("button", { name: "뒤로 가기" })).not.toBeInTheDocument();
    const open = screen.getByRole("button", { name: "탐색 메뉴 열기" });
    await user.click(open); await user.keyboard("{Escape}");
    expect(open).toHaveFocus();
    await user.click(open);
    fireEvent.pointerDown(document.querySelector(".frame-prototype__scrim")!);
    expect(screen.queryByRole("dialog", { name: "탐색 메뉴" })).not.toBeInTheDocument();
  });
  it("keeps navigation available when collapsed and preserves collapse across menus", async () => {
    const user = userEvent.setup(); show();
    const nav = within(screen.getByRole("navigation", { name: "앱 탐색" }));
    await user.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(nav.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "page");
    await user.click(nav.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "내 작업" })).toBeVisible();
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "홈으로 돌아가기" })).not.toBeInTheDocument();
  });
  it("preserves edited Markdown when navigating away and returning", async () => {
    const user = userEvent.setup(); show();
    await user.click(screen.getByRole("button", { name: "편집" }));
    await user.click(screen.getByRole("tab", { name: "Markdown 원문" }));
    const source = screen.getByRole("textbox", { name: "Markdown 원문" });
    await user.clear(source); await user.paste("# 유지할 문서\n\n작성 중인 내용");
    await user.click(within(screen.getByRole("navigation", { name: "앱 탐색" })).getByRole("button", { name: "Home" }));
    await user.click(within(screen.getByRole("navigation", { name: "앱 탐색" })).getByRole("button", { name: "Documents" }));
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: /유지할 문서/ }));
    await user.click(screen.getByRole("button", { name: "편집" }));
    expect(screen.getByRole("textbox", { name: "Markdown 원문" })).toHaveValue("# 유지할 문서\n\n작성 중인 내용");
  });
});
