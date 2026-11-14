import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
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

vi.mock("@/infrastructure/ai/XtermRenderer", async () => {
  const { FakeTerminalRenderer: FakeRenderer } = await import(
    "@/test/FakeTerminalRenderer"
  );
  return {
    createXtermRenderer: FakeRenderer.create,
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = "";
  FakeTerminalRenderer.created = [];
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

  it("lands directly on Documents and shows inline workspace onboarding when none is saved", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.startError = {
      code: "workspace_missing",
      message: "워크스페이스가 연결되지 않았습니다.",
      recovery: "open_workspace_file",
      details: {},
    };
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.disconnected()}
        documentsGateway={documentsGateway}
        docsRepositoryGateway={new FakeDocsRepositoryGateway()}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    expect(await screen.findByRole("main", { name: "OkHub" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Documents" }),
    ).toBeVisible();
    expect(
      await screen.findByText("GitHub에 로그인하고 문서 워크스페이스를 시작하세요"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "GitHub로 로그인" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Settings에서 로그인" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "워크스페이스 연결" }),
    ).toBeNull();
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

  it("supports creating both Project+Docs and standalone Docs workspaces and switching between them", async () => {
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.currentWorkspace = null;
    workspaceGateway.repositories = [
      {
        id: "R_mockly",
        owner: "Mockly-Company",
        name: "Mockly",
        fullName: "Mockly-Company/Mockly",
        defaultBranch: "main",
        isEmpty: false,
      },
      {
        id: "R_handbook",
        owner: "Mockly-Company",
        name: "handbook",
        fullName: "Mockly-Company/handbook",
        defaultBranch: "main",
        isEmpty: false,
      },
    ];
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.projectList = [
      {
        id: "PVT_1",
        owner: "Mockly-Company",
        number: 1,
        title: "Mockly Board",
        scope: "organization",
      },
    ];
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.prepareResult = {
      parentDirectory: "/app/repos/Mockly-Company",
      alreadyCloned: true,
    };
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const user = userEvent.setup();

    render(
      <App
        workspaceGateway={workspaceGateway}
        projectBoardGateway={projectGateway}
        docsRepositoryGateway={docsRepoGateway}
        documentsGateway={documentsGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    // 1. Project + 소속 문서 저장소 연결
    await user.click(
      await screen.findByRole("button", { name: /Mockly Board/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Mockly-Company\/Mockly/ }),
    );

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    await waitFor(() => {
      expect(switcher).toHaveTextContent("Mockly Board");
      expect(switcher).toHaveTextContent("문서 · Mockly-Company/Mockly");
    });
    expect(
      await screen.findByText("선택된 Project · Mockly Board"),
    ).toBeVisible();
    expect(screen.getByText("Mockly-Company #1")).toBeVisible();

    // 2. 사이드바에서 단독 문서 저장소 워크스페이스 추가
    await user.click(switcher);
    await user.click(
      await screen.findByRole("menuitem", { name: "새 워크스페이스 추가" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "새 워크스페이스 추가",
    });
    await user.click(
      within(dialog).getByRole("tab", { name: /문서 저장소만 관리/ }),
    );
    await user.click(
      await within(dialog).findByRole("button", {
        name: /Mockly-Company\/handbook/,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^워크스페이스 전환/ }),
      ).toHaveTextContent("문서 전용 · Mockly-Company/handbook");
    });

    // 3. 단독 문서 모드에서 Board 탭으로 이동 시 친절한 보드 연결 안내 제공
    await user.click(screen.getByRole("link", { name: "Board" }));
    expect(
      await screen.findByText("문서 저장소 단독으로 관리 중인 워크스페이스입니다"),
    ).toBeVisible();
  });

  it("isolates AI CLI sessions per project workspace and preserves background terminals across switches", async () => {
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha Project",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_beta",
        owner: "Mockly-Company",
        number: 2,
        title: "Beta Project",
        scope: "organization",
      },
      { repositoryId: "R_beta", fullName: "Mockly-Company/beta-docs" },
    );
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");

    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const aiGateway = new FakeAiGateway();
    const user = userEvent.setup();

    render(
      <App
        workspaceGateway={workspaceGateway}
        projectBoardGateway={projectGateway}
        docsRepositoryGateway={docsRepoGateway}
        documentsGateway={documentsGateway}
        aiGateway={aiGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    await waitFor(() =>
      expect(switcher).toHaveTextContent("Alpha Project"),
    );

    // Alpha Project에서 AI 화면으로 이동 후 Antigravity CLI 실행
    await user.click(screen.getByRole("link", { name: "AI" }));
    await user.click(await screen.findByRole("button", { name: "Antigravity" }));
    expect(
      await screen.findByRole("tab", { name: /Antigravity/ }),
    ).toBeInTheDocument();

    const aiNavLink = screen.getByRole("link", { name: /^AI/ });
    expect(within(aiNavLink).getByText("1")).toBeInTheDocument();

    // 사이드바에서 Beta Project로 전환
    await user.click(switcher);
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Beta Project/ }),
    );

    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    await waitFor(() =>
      expect(within(contextBar).getByText("선택된 Project · Beta Project")).toBeInTheDocument(),
    );
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/beta-docs"),
    ).toBeInTheDocument();

    // Beta Project에서는 이전 Alpha의 CLI 탭이 보이지 않고 백그라운드 실행 안내가 표시된다
    expect(screen.queryByRole("tab", { name: /Antigravity/ })).toBeNull();
    expect(within(aiNavLink).queryByText("1")).toBeNull();
    expect(
      screen.getByText("다른 워크스페이스 AI 실행 중 1개"),
    ).toBeInTheDocument();

    // 다시 Alpha Project로 돌아오면 실행 중이던 Antigravity 탭이 그대로 복원된다
    await user.click(screen.getByRole("button", { name: /^워크스페이스 전환/ }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Alpha Project/ }),
    );
    await waitFor(() =>
      expect(within(contextBar).getByText("선택된 Project · Alpha Project")).toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("tab", { name: /Antigravity/ }),
    ).toBeInTheDocument();
    expect(aiGateway.terminalStops).toEqual([]);
  });
});
