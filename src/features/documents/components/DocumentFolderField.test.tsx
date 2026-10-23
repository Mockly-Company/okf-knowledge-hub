import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentTreeEntry } from "../model";
import { DocumentFolderField } from "./DocumentFolderField";

afterEach(cleanup);
const roots: DocumentTreeEntry[] = [{ kind: "folder", name: "docs", path: "docs", children: [
  { kind: "folder", name: "api", path: "docs/api", children: [{kind: "folder", name: "contracts", path: "docs/api/contracts", children: []}] },
  { kind: "folder", name: "guides", path: "docs/guides", children: [] },
] }];
function Harness() { const [value, setValue] = useState("docs/api"); return <DocumentFolderField roots={roots} value={value} onValueChange={setValue} />; }
describe("DocumentFolderField", () => {
  it("keeps the newest completed path segments visible when the prefix exceeds its width", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", {name: "새 폴더 만들기"}));
    const prefix = document.querySelector(".document-folder-field__prefix")!;
    Object.defineProperty(prefix, "scrollWidth", {configurable: true, value: 800});
    await user.type(screen.getByRole("textbox", {name: "새 폴더 이름"}), "hello/test/on/");
    expect(prefix.scrollLeft).toBe(800);
  });
  it("cancels folder creation with the heading close button and keeps the selected location", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", {name: "새 폴더 만들기"}));
    const region = within(screen.getByRole("group", {name: "새 폴더 만들기"}));
    expect(region.queryByRole("button", {name: "취소"})).not.toBeInTheDocument();
    await user.type(region.getByRole("textbox", {name: "새 폴더 이름"}), "v2/");
    await user.click(region.getByRole("button", {name: "새 폴더 입력 취소"}));
    expect(screen.queryByRole("textbox", {name: "새 폴더 이름"})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "저장 폴더 선택"})).toHaveTextContent("docs / api");
    expect(screen.getByRole("button", {name: "새 폴더 만들기"})).toHaveFocus();
  });
  it("shows every configured nested root even when its repository ancestors are absent", async () => {
    const user = userEvent.setup();
    render(<DocumentFolderField roots={[
      {kind: "folder", name: "api", path: "docs/api", children: []},
      {kind: "folder", name: "docs", path: "knowledge/docs", children: [{kind: "folder", name: "guides", path: "knowledge/docs/guides", children: []}]},
    ]} value="docs/api" onValueChange={() => undefined} />);
    await user.click(screen.getByRole("button", {name: "저장 폴더 선택"}));
    expect(screen.getByRole("menuitemradio", {name: "api"})).toBeVisible();
    expect(screen.getByRole("menuitemradio", {name: "docs"})).toBeVisible();
    await user.click(screen.getByRole("menuitem", {name: "knowledge / docs 펼치기"}));
    expect(screen.getByRole("menuitemradio", {name: "guides"})).toBeVisible();
  });
  it("selects existing folders and restores focus after Escape", async () => {
    const user = userEvent.setup(); render(<Harness />);
    const trigger = screen.getByRole("button", { name: "저장 폴더 선택" });
    await user.click(trigger); await user.keyboard("{Escape}"); expect(trigger).toHaveFocus();
    await user.click(trigger); await user.click(screen.getByRole("menuitemradio", { name: "guides" }));
    expect(trigger).toHaveTextContent("docs / guides");
  });
  it("adds nested pending folders, distinguishes existing segments and undoes the entire pending branch", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", { name: "새 폴더 만들기" }));
    const input = screen.getByRole("textbox", { name: "새 폴더 이름" });
    expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    await user.type(input, "contracts/v2/");
    expect(input).toHaveValue(""); expect(input).toHaveAttribute("placeholder", "");
    expect(input).toHaveAccessibleDescription(/docs \/ api \/ contracts \/ v2/);
    const region = screen.getByRole("group", {name: "새 폴더 만들기"});
    expect(within(region).getByText("contracts")).toHaveAttribute("data-folder-state", "existing");
    expect(within(region).getByText("v2")).toHaveAttribute("data-folder-state", "new");
    await user.keyboard("{Backspace}"); expect(input).toHaveValue("v2");
    await user.clear(input); await user.type(input, "v3/examples");
    await user.click(screen.getByRole("button", {name: "추가"}));
    expect(screen.getByRole("button", {name: "저장 폴더 선택"})).toHaveTextContent("docs / api / contracts / v3 / examples");
    await user.click(screen.getByRole("button", {name: "생성 예정 폴더 추가 취소"}));
    expect(screen.getByRole("button", {name: "저장 폴더 선택"})).toHaveTextContent("docs / api / contracts");
  });
  it("rejects traversal and cancels without changing the selected folder", async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("button", {name: "새 폴더 만들기"}));
    await user.type(screen.getByRole("textbox", {name: "새 폴더 이름"}), "../outside");
    await user.click(screen.getByRole("button", {name: "추가"}));
    expect(screen.getByRole("alert")).toHaveTextContent("폴더");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", {name: "새 폴더 이름"})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "저장 폴더 선택"})).toHaveTextContent("docs / api");
  });
});
