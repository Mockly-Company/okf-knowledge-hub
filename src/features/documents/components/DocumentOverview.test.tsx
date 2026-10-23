import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DocumentContent } from "../model";
import { DocumentOverview } from "./DocumentOverview";

afterEach(cleanup);

it("uses readable names for known properties without losing custom keys", () => {
  render(<DocumentOverview document={{ properties: { type: "API 계약", owner: "Platform", custom: "보존" }, tableOfContents: [] } as unknown as DocumentContent} />);
  expect(screen.getByText("유형")).toBeVisible();
  expect(screen.getByText("담당")).toBeVisible();
  expect(screen.getByText("custom")).toBeVisible();
  expect(screen.getByText("보존")).toBeVisible();
});

it("marks only the section at the reading position as current", () => {
  const content = { properties: {}, tableOfContents: [{id: "intro", title: "소개", level: 1}, {id: "request", title: "요청", level: 2}] } as unknown as DocumentContent;
  render(<section className="document-reader"><h1 id="intro">본문 소개</h1><h2 id="request">본문 요청</h2><DocumentOverview document={content} /></section>);
  expect(screen.getByRole("link", {name: "소개"})).toHaveAttribute("aria-current", "location");
  fireEvent.click(screen.getByRole("link", {name: "요청"}));
  expect(screen.getByRole("link", {name: "요청"})).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("link", {name: "소개"})).not.toHaveAttribute("aria-current");
});
