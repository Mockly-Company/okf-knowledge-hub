import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { CodeRepositoriesGateway } from "@/features/code-repositories/CodeRepositoriesGateway";
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

it("loads inline code snippets from connected code repositories when code_refs are clicked", async () => {
  const gateway: CodeRepositoriesGateway = {
    listWorkspaceCodeRepositories: vi.fn(async () => []),
    setCodeRepositoryLocalPath: vi.fn(),
    clearCodeRepositoryLocalPath: vi.fn(),
    readCodeRepositoryFile: vi.fn(async () => ({
      repositoryKey: "web",
      repositoryFullName: "Acme-Org/acme-web",
      filePath: "src/checkout/pay.ts",
      startLine: 10,
      endLine: 12,
      totalLines: 40,
      content: "export function submitPayment() {\n  return true;\n}",
    })),
  };

  const content = {
    properties: {
      type: "설계서",
      code_refs: ["web:src/checkout/pay.ts#L10-L12"],
    },
    tableOfContents: [],
  } as unknown as DocumentContent;

  const user = userEvent.setup();
  render(
    <DocumentOverview
      document={content}
      codeRepositoriesGateway={gateway}
    />,
  );

  const trigger = screen.getByRole("button", {
    name: /src\/checkout\/pay\.ts/,
  });
  await user.click(trigger);

  expect(gateway.readCodeRepositoryFile).toHaveBeenCalledWith(
    "web",
    "src/checkout/pay.ts",
    10,
    12,
  );
  expect(await screen.findByText(/submitPayment/)).toBeInTheDocument();
});
