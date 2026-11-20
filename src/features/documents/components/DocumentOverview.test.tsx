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

it("prevents default hash navigation and calls onRequestHeading when heading is not in DOM (.html iframe view)", async () => {
  const user = userEvent.setup();
  const onRequestHeading = vi.fn();
  const content = {
    properties: {},
    tableOfContents: [{ id: "2026-11-14-change", title: "2026-11-14 변경", level: 2 }],
  } as unknown as DocumentContent;
  window.location.hash = "#/documents";

  render(
    <section className="document-reader">
      <DocumentOverview document={content} onRequestHeading={onRequestHeading} />
    </section>,
  );

  await user.click(screen.getByRole("link", { name: "2026-11-14 변경" }));
  expect(window.location.hash).toBe("#/documents");
  expect(onRequestHeading).toHaveBeenCalledWith("2026-11-14-change");
  window.location.hash = "";
});

it("formats wireframes, designs, tags, related_docs, and impl_status cleanly instead of dumping raw JSON", () => {
  render(
    <DocumentOverview
      document={
        {
          properties: {
            type: "Screen Spec",
            impl_status: "partial",
            tags: ["documents", "ux"],
            related_docs: ["docs/prd.md", "docs/adr.md"],
            wireframes: [{ title: "보드 와이어프레임", image: "assets/wf.svg" }],
            designs: [
              { title: "시안 1", image: "assets/d1.svg" },
              { title: "시안 2", image: "assets/d2.svg" },
            ],
            custom_key: "kept",
          },
          tableOfContents: [],
        } as unknown as DocumentContent
      }
    />,
  );

  expect(screen.getByText("와이어프레임")).toBeVisible();
  expect(screen.getByText("1건 (시안 탭에서 보기)")).toBeVisible();
  expect(screen.getByText("디자인 시안")).toBeVisible();
  expect(screen.getByText("2건 (시안 탭에서 보기)")).toBeVisible();
  expect(screen.getByText("태그")).toBeVisible();
  expect(screen.getByText("documents, ux")).toBeVisible();
  expect(screen.getByText("관련 문서")).toBeVisible();
  expect(screen.getByText("docs/prd.md, docs/adr.md")).toBeVisible();
  expect(screen.getByText("코드 반영 상태")).toBeVisible();
  expect(screen.getByText("일부 수정 필요")).toBeVisible();
  expect(screen.getByText("custom_key")).toBeVisible();
  expect(screen.getByText("kept")).toBeVisible();
});

it("guards against prototype-chain lookups on impl_status/property keys and normalizes undefined values", () => {
  render(
    <DocumentOverview
      document={
        {
          properties: {
            impl_status: "toString",
            constructor: "literal-value",
            empty_prop: undefined,
          },
          tableOfContents: [],
        } as unknown as DocumentContent
      }
    />,
  );

  expect(screen.getByText("코드 반영 상태")).toBeVisible();
  expect(screen.getByText("toString")).toBeVisible();
  expect(screen.getByText("constructor")).toBeVisible();
  expect(screen.getByText("literal-value")).toBeVisible();
  expect(screen.getByText("empty_prop")).toBeVisible();
  expect(screen.getByText("-")).toBeVisible();
});
