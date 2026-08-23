import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { DesignSystemPage } from "./DesignSystemPage";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
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

function renderPage() {
  return render(
    <PreferencesProvider repository={new FakePreferencesRepository()}>
      <DesignSystemPage />
    </PreferencesProvider>,
  );
}

describe("DesignSystemPage", () => {
  it("catalogs the approved type, control, and status contracts", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-[number:var(--font-weight-page-title)]",
    );
    expect(screen.getByText("승인된 크기와 굵기 위계")).toHaveClass(
      "font-[number:var(--font-weight-description)]",
    );
    expect(screen.getByRole("button", { name: "Primary" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
    expect(screen.getByRole("tablist", { name: "문서 표시 모드" })).toBeVisible();
    for (const label of [
      "준비됨",
      "로컬 저장됨",
      "검토 중",
      "결정 필요",
      "저장 실패",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByRole("heading", { level: 1 }).closest("section")).toHaveClass(
      "px-[var(--page-padding-inline)]",
      "pt-[var(--page-block-start)]",
    );
    expect(screen.getByText("GitHub 연결이 끊어졌습니다.").closest("section"))
      .toHaveAttribute("data-feedback-variant", "banner");
  });

  it("catalogs the approved 400, 500, 600, and 700 weight roles", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-[number:var(--font-weight-page-title)]",
    );
    expect(screen.getByText("승인된 크기와 굵기 위계")).toHaveClass(
      "font-[number:var(--font-weight-description)]",
    );
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass(
      "font-[number:var(--font-weight-control)]",
    );
    expect(
      screen.getByText(/OkHub는 Git의 Markdown을 사람이 오래 읽어도/),
    ).toHaveClass("font-[number:var(--font-weight-body)]");
    expect(screen.getByText("docs/features/map-search.md")).toHaveClass(
      "font-[number:var(--font-weight-body)]",
    );
    expect(screen.getByText("로컬 저장됨 · 방금 전")).toHaveClass(
      "font-[number:var(--font-weight-body)]",
      "text-[length:var(--font-meta-size)]",
      "leading-[var(--font-meta-line)]",
      "text-[var(--color-text-muted)]",
    );
  });

  it("shows every approved button variant", () => {
    renderPage();

    for (const name of ["Primary", "Secondary", "Ghost", "Destructive"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("shows the shared form controls and their disabled states", () => {
    renderPage();

    expect(screen.getByRole("textbox", { name: "문서 제목" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "문서 유형" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "별도 변경 만들기" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "기본 밀도" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "미리보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "저장할 수 없음" })).toBeDisabled();
  });

  it("demonstrates the shared described Select and DropdownMenu primitives", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("combobox", { name: "문서 유형" }));
    expect(screen.getByRole("option", { name: /API 계약/ })).toHaveTextContent(
      "요청과 응답 계약을 정의합니다.",
    );

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "문서 작업" }));
    expect(screen.getByRole("menuitem", { name: "링크 복사" })).toBeVisible();
  });

  it("catalogs the disabled state for every control primitive", () => {
    renderPage();

    expect(screen.getByRole("textbox", { name: "비활성 입력" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "비활성 선택" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "비활성 Markdown" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "비활성 체크박스" }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "비활성 라디오" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "비활성 탭" })).toBeDisabled();
  });

  it("explains the icon-only button with a tooltip", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.hover(screen.getByRole("button", { name: "설정 열기" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("설정 열기");
    expect(tooltip).toHaveClass("text-[var(--color-canvas)]");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderPage();

    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });

  it("switches between the approved display densities", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "Compact로 보기" }),
    );

    expect(
      screen.getByRole("button", { name: "Default로 보기" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
  });
});
