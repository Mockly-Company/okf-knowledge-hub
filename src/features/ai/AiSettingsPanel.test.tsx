import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActiveProjectProvider,
  useActiveProject,
} from "@/features/active-project/ActiveProjectProvider";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { aiKeys } from "./queryKeys";
import { AiSettingsPanel } from "./AiSettingsPanel";

afterEach(cleanup);

describe("AiSettingsPanel", () => {
  it("creates repository shared rules from the template when missing and hides local paths", async () => {
    const gateway = new FakeAiGateway();
    gateway.agentsMdExists = false;
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    const createButton = await screen.findByRole("button", {
      name: "템플릿으로 만들기",
    });
    const repoSection = screen.getByRole("region", { name: "저장소 공통 규칙" });
    expect(screen.getByText("저장소 공통 규칙")).toBeInTheDocument();
    expect(within(repoSection).getByText("미설정")).toBeInTheDocument();
    expect(
      screen.getByText(
        "아직 저장소 공통 규칙이 없습니다. 기본 템플릿으로 만들면 이 저장소의 AI 작업 규칙으로 사용됩니다.",
      ),
    ).toBeInTheDocument();

    await user.click(createButton);

    expect(
      await screen.findByLabelText("저장소 공통 규칙 미리보기"),
    ).toBeInTheDocument();
    expect(within(repoSection).getByText("적용 중")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/work/mockly-knowledge");
    expect(document.body.textContent).not.toContain(".okf/AGENTS.md");
    expect(gateway.creates).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "템플릿으로 만들기" })).toBeNull();
  });

  it("saves the terminal cli command", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    const cliInput = await screen.findByLabelText("터미널용 CLI 명령");
    // 입력은 로딩 완료 후 활성화된다. 시딩이 끝나야 타이핑이 덮어써지지 않는다.
    await waitFor(() => expect(cliInput).toHaveValue("codex"));

    await user.clear(cliInput);
    await user.type(cliInput, "opencode");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
    expect(gateway.sets).toHaveLength(1);
    expect(gateway.sets[0]).toBe("opencode");
    expect((await gateway.getConfig()).cli_command).toBe("opencode");
  });

  it("refreshes config readers after saving", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    function ConfigProbe() {
      const query = useQuery({
        queryKey: aiKeys.config,
        queryFn: () => gateway.getConfig(),
      });
      return <p>{query.data ? query.data.cli_command : "loading"}</p>;
    }
    render(
      <TestQueryProvider>
        <ConfigProbe />
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("codex")).toBeInTheDocument();

    const cliInput = await screen.findByLabelText("터미널용 CLI 명령");
    await waitFor(() => expect(cliInput).toHaveValue("codex"));
    await user.clear(cliInput);
    await user.type(cliInput, "opencode");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
    // 저장 후 같은 키 구독자가 새 값을 다시 읽는다.
    expect(await screen.findByText("opencode")).toBeInTheDocument();
  });

  it("explains that presets need no setup and has no command template", async () => {
    const gateway = new FakeAiGateway();
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText(/Claude Code, Codex, Antigravity는 설정 없이/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("명령 템플릿")).toBeNull();
  });

  it("shows the app hub rules with a 10-line preview without exposing local file paths", async () => {
    const gateway = new FakeAiGateway();
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("허브 공통 규칙")).toBeInTheDocument();
    const preview = await screen.findByLabelText("허브 공통 규칙 미리보기");
    expect(preview.textContent?.split("\n").length).toBeLessThanOrEqual(10);
    expect(document.body.textContent).not.toContain("/app/AGENTS.md");
  });

  it("shows fallback message when hub shared rules fail to load without leaking paths", async () => {
    const gateway = new FakeAiGateway();
    gateway.resolveAppAgentsMd = async () => {
      throw new Error("/secret/path/AGENTS.md failed");
    };
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByText("허브 공통 규칙을 불러오지 못했습니다."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/secret/path/AGENTS.md");
  });

  it("scopes repository shared rules query per active workspace so switching workspaces refreshes the preview", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const gateway = new FakeAiGateway();
    gateway.agentsMd = {
      workspace_path: "/work/docs-a",
      path: "/work/docs-a/.okf/AGENTS.md",
      content: "# Alpha 규칙\n",
    };

    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createStandaloneWorkspace("R_a", "Mockly-Company/docs-a");
    await docsGateway.createStandaloneWorkspace("R_b", "Mockly-Company/docs-b");
    await docsGateway.setActiveWorkspace("repo:R_a");

    function SwitchButton() {
      const { activeWorkspaceId, selectWorkspace } = useActiveProject();
      return (
        <div>
          <output data-testid="active-ws">{activeWorkspaceId ?? "none"}</output>
          <button
            type="button"
            onClick={() => {
              gateway.agentsMd = {
                workspace_path: "/work/docs-b",
                path: "/work/docs-b/.okf/AGENTS.md",
                content: "# Beta 규칙\n",
              };
              void selectWorkspace("repo:R_b");
            }}
          >
            Beta로 전환
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={FakeProjectBoardGateway.empty()}
          docsRepositoryGateway={docsGateway}
          aiGateway={gateway}
        >
          <SwitchButton />
          <AiSettingsPanel gateway={gateway} />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("repo:R_a"),
    );
    expect(
      await screen.findByLabelText("저장소 공통 규칙 미리보기"),
    ).toHaveTextContent("# Alpha 규칙");
    expect(document.body.textContent).not.toContain("/work/docs-a");

    await user.click(screen.getByRole("button", { name: "Beta로 전환" }));

    await waitFor(() =>
      expect(
        screen.getByLabelText("저장소 공통 규칙 미리보기"),
      ).toHaveTextContent("# Beta 규칙"),
    );
    expect(document.body.textContent).not.toContain("/work/docs-b");
  });
});
