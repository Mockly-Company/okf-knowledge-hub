import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { App } from "./App";

const { initializeMermaid, renderMermaid } = vi.hoisted(() => ({
  initializeMermaid: vi.fn(),
  renderMermaid: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: { initialize: initializeMermaid, render: renderMermaid },
}));

afterEach(() => {
  cleanup();
  initializeMermaid.mockReset();
  renderMermaid.mockReset();
});

describe("App", () => {
  it("renders the OkHub application landmark", async () => {
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.connected()}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );
    expect(await screen.findByRole("main", { name: "OkHub" })).toBeInTheDocument();
  });

  it("asks to choose a project before connecting documents when none is saved", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.startError = {
      code: "workspace_missing",
      message: "워크스페이스가 연결되지 않았습니다.",
      recovery: "open_workspace_file",
      details: {},
    };
    const user = userEvent.setup();
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.disconnected()}
        documentsGateway={documentsGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    expect(await screen.findByRole("main", { name: "OkHub" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GitHub에 연결" }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("link", { name: "Documents" }));
    expect(await screen.findByText("프로젝트를 먼저 선택하세요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장소 연결하기" })).toBeNull();
  });

  it("closes the document session and keeps the app shell after logout", async () => {
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const documentsGateway = new FakeDocumentsGateway();
    const user = userEvent.setup();
    render(
      <App
        workspaceGateway={workspaceGateway}
        documentsGateway={documentsGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );
    await waitFor(() => {
      const call = documentsGateway.calls.find(
        (candidate) => candidate.method === "startSession",
      );
      expect(call).toBeDefined();
    });

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "외부 연결" }));
    await user.click(await screen.findByRole("button", { name: "로그아웃" }));
    await user.click(screen.getByRole("button", { name: "GitHub에서 로그아웃" }));

    expect(
      await screen.findByRole("main", { name: "OkHub" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GitHub에 연결" }),
    ).not.toBeInTheDocument();
    // 로그아웃해도 셸이 유지되므로 문서 세션은 정리되지 않는다.
    expect(
      documentsGateway.calls.filter((call) => call.method === "stopSession"),
    ).toHaveLength(0);
    expect(documentsGateway.listenerCount()).toBe(1);
    expect(workspaceGateway.currentWorkspace?.status).toBe("connected");
  });

  it("completes the Documents flow and releases its document session on unmount", async () => {
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const guide = documentsGateway.guideCatalog.documents[0];
    const api = documentsGateway.apiCatalog.documents[0];
    documentsGateway.sessionSnapshot.catalog = {
      documents: [guide, api],
      roots: [
        {
          kind: "folder",
          name: "docs",
          path: "docs",
          children: [
            { kind: "document", summary: guide },
            { kind: "document", summary: api },
          ],
        },
      ],
    };
    documentsGateway.searchResults = [
      {
        path: api.path,
        title: api.title,
        matchField: "body",
        matchText: "portal flow",
        snippet: "The portal flow is rendered below.",
      },
    ];
    documentsGateway.historyPage = {
      items: [
        {
          commitOid: "a".repeat(40),
          shortOid: "aaaaaaa",
          pathAtCommit: api.path,
          authorName: "OKF",
          authoredAtUnix: 1_721_000_000,
          message: "Add portal flow",
        },
      ],
      nextCursor: null,
    };
    vi.spyOn(documentsGateway, "readDocument").mockResolvedValue({
      summary: api,
      markdown: "# API\n\n```mermaid\nflowchart LR\nPortal --> API\n```",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    });
    vi.spyOn(documentsGateway, "readDocumentVersion").mockResolvedValue({
      summary: api,
      markdown: "# Historical API",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    });
    renderMermaid.mockResolvedValue({
      svg: "<svg><text>Mermaid rendered</text></svg>",
    });
    const user = userEvent.setup();
    const view = render(
      <App
        workspaceGateway={workspaceGateway}
        documentsGateway={documentsGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    await user.click(await screen.findByRole("link", { name: "Documents" }));
    const folder = await screen.findByRole("treeitem", { name: "docs" });
    await user.click(folder);
    expect(await screen.findByRole("treeitem", { name: "API" })).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "문서 검색" }), "portal");
    await user.click(
      await within(screen.getByLabelText("문서 찾기")).findByRole("button", {
        name: /API/,
      }),
    );
    expect(await screen.findByRole("region", { name: "API" })).toBeVisible();
    expect(await screen.findByText("Mermaid rendered")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /Add portal flow/ }));
    expect(await screen.findByText("Historical API")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "현재 문서로 돌아가기" }));
    expect(await screen.findByText("Mermaid rendered")).toBeVisible();

    const sessionId = documentsGateway.calls.find(
      (call) => call.method === "startSession",
    )?.args[0];
    view.unmount();
    await waitFor(() => {
      expect(documentsGateway.calls).toContainEqual({
        method: "stopSession",
        args: [sessionId],
      });
      expect(documentsGateway.listenerCount()).toBe(0);
    });
  });
});
