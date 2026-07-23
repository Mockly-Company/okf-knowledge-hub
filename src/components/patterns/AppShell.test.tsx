import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<h1>프로젝트 진행 상황</h1>} />
          <Route path="documents" element={<h1>Documents</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("navigates without leaving the application", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("link", { name: "Documents" }));
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  });

  it("collapses and restores the sidebar", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    const openButton = screen.getByRole("button", { name: "사이드바 열기" });
    expect(openButton).toHaveFocus();
    await userEvent.click(openButton);
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveFocus();
  });

  it("reserves space for the open button only while collapsed", async () => {
    renderShell();
    const main = screen.getByRole("main", { name: "OkHub" });
    expect(main).not.toHaveClass("app-shell__main--sidebar-collapsed");

    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(main).toHaveClass("app-shell__main--sidebar-collapsed");

    await userEvent.click(screen.getByRole("button", { name: "사이드바 열기" }));
    expect(main).not.toHaveClass("app-shell__main--sidebar-collapsed");
  });

  it("toggles the sidebar with the platform shortcut", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 열기" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveFocus();
  });
});
