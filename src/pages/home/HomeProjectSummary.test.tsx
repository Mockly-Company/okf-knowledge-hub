import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { HomeProjectSummary, type HomeProjectData } from "./HomeProjectSummary";

afterEach(cleanup);
const data: HomeProjectData = { status: "ready", project: { name: "Mockly 제품 개발", statuses: [{ id: "todo", name: "Todo", count: 12 }, { id: "doing", name: "In progress", count: 4 }, { id: "done", name: "Done", count: 0 }] } };
describe("HomeProjectSummary", () => {
  it("shows the representative project's original status names and counts, including zero", () => {
    render(<MemoryRouter><HomeProjectSummary data={data} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Mockly 제품 개발" })).toBeVisible();
    const groups = screen.getAllByRole("definition");
    expect(groups.map(group => group.textContent)).toEqual(["12", "4", "0"]);
    expect(screen.getAllByRole("term").map(term => term.textContent)).toEqual(["Todo", "In progress", "Done"]);
    expect(screen.getByRole("link", { name: "프로젝트 보기" })).toHaveAttribute("href", "/project");
  });
  it("opens the project through the frame's navigation callback", async () => {
    function Journey() {
      const [opened, setOpened] = useState(false);
      return opened ? <h1>프로젝트 화면</h1> : <HomeProjectSummary data={data} onOpen={() => setOpened(true)} />;
    }
    render(<Journey />);
    await userEvent.click(screen.getByRole("button", { name: "프로젝트 보기" }));
    expect(screen.getByRole("heading", { name: "프로젝트 화면" })).toBeVisible();
  });
  it("does not invent counts before connection or after a failed query", () => {
    const { rerender } = render(<MemoryRouter><HomeProjectSummary /></MemoryRouter>);
    expect(screen.getByText("대표 프로젝트가 아직 연결되지 않았습니다.")).toBeVisible();
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
    rerender(<MemoryRouter><HomeProjectSummary data={{ ...data, status: "error" }} /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("프로젝트 현황을 불러오지 못했습니다.");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });
  it("labels cached counts as stale instead of current", () => {
    render(<MemoryRouter><HomeProjectSummary data={{ ...data, status: "stale", updatedAt: "2026-10-21T01:30:00Z" }} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("저장된 현황입니다");
    expect(within(screen.getByRole("status")).getByRole("time")).toHaveAttribute("dateTime", "2026-10-21T01:30:00Z");
    expect(screen.getAllByRole("definition")).toHaveLength(3);
  });
  it("distinguishes an unselected representative project from loading", () => {
    const { rerender } = render(<MemoryRouter><HomeProjectSummary data={{ status: "empty" }} /></MemoryRouter>);
    expect(screen.getByText("선택된 대표 프로젝트가 없습니다.")).toBeVisible();
    rerender(<MemoryRouter><HomeProjectSummary data={{ status: "loading" }} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("프로젝트 현황을 불러오는 중입니다.");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });
});
