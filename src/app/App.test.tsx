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

  it("shows connection instead of the shell when no workspace is saved", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.disconnected()}
        documentsGateway={documentsGateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "GitHub에 연결" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "OkHub" })).not.toBeInTheDocument();
    expect(
      documentsGateway.calls.filter((call) => call.method === "startSession"),
    ).toHaveLength(0);
  });

  it("connects an existing initialized clone and opens Home", async () => {
    const gateway = FakeWorkspaceConnectionGateway.existingReadyClone();
    const user = userEvent.setup();
    render(<App workspaceGateway={gateway} preferencesRepository={new FakePreferencesRepository()} />);

    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));

    expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeInTheDocument();
  });

  it("keeps the current workspace when repository replacement is cancelled", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected(
      "/work/mockly-knowledge",
    );
    const user = userEvent.setup();
    render(
      <App
        workspaceGateway={gateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스" }));
    await user.click(
      screen.getByRole("button", { name: "다른 지식 저장소 연결" }),
    );
    expect(
      await screen.findByRole("heading", { name: "OKF 저장소 선택" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "연결 취소" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );

    expect(
      await screen.findByText("/work/mockly-knowledge"),
    ).toBeInTheDocument();
    expect(gateway.currentWorkspace?.path).toBe("/work/mockly-knowledge");
  });

  it("closes the document session and returns to GitHub connection after logout", async () => {
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
    const sessionId = (
      await waitFor(() => {
        const call = documentsGateway.calls.find(
          (candidate) => candidate.method === "startSession",
        );
        expect(call).toBeDefined();
        return call;
      })
    )?.args[0];

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "외부 연결" }));
    await user.click(await screen.findByRole("button", { name: "로그아웃" }));
    await user.click(screen.getByRole("button", { name: "GitHub에서 로그아웃" }));

    expect(
      await screen.findByRole("heading", { name: "GitHub에 연결" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(documentsGateway.calls).toContainEqual({
        method: "stopSession",
        args: [sessionId],
      });
      expect(documentsGateway.listenerCount()).toBe(0);
    });
    expect(workspaceGateway.currentWorkspace?.status).toBe("connected");
  });

  it("reuses the authenticated GitHub session when replacing a workspace", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    const user = userEvent.setup();
    render(
      <App
        workspaceGateway={gateway}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스" }));
    await user.click(
      screen.getByRole("button", { name: "다른 지식 저장소 연결" }),
    );

    expect(
      await screen.findByRole("heading", { name: "OKF 저장소 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitHub 로그인" }),
    ).not.toBeInTheDocument();
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
