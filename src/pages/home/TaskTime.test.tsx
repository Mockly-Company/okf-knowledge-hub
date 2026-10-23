import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskTime } from "./TaskTime";

afterEach(cleanup);
const now = Date.parse("2026-10-21T12:00:00Z");

describe("TaskTime", () => {
  it.each([
    ["2026-10-21T11:59:40Z", "방금 전"],
    ["2026-10-21T11:55:00Z", "5분 전"],
    ["2026-10-21T09:00:00Z", "3시간 전"],
    ["2026-10-19T12:00:00Z", "2일 전"],
    ["2026-08-21T12:00:00Z", "2개월 전"],
    ["2025-10-21T12:00:00Z", "1년 전"],
    ["2026-10-21T12:05:00Z", "방금 전"],
  ])("shows %s as %s and preserves the exact timestamp", (value, label) => {
    render(<TaskTime value={value} now={now} />);
    const time = screen.getByText(label);
    expect(time).toHaveAttribute("dateTime", value);
    expect(time.getAttribute("title")).toMatch(/202[56]/);
    expect(time.getAttribute("aria-label")).toContain(label);
  });
});
