import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { aiKeys } from "./queryKeys";
import { AiSettingsPanel } from "./AiSettingsPanel";

afterEach(cleanup);

describe("AiSettingsPanel", () => {
  it("creates AGENTS.md from the template when missing and shows the preview", async () => {
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
    expect(
      screen.getByText(/\.okf\/AGENTS\.md를 만들면/),
    ).toBeInTheDocument();

    await user.click(createButton);

    expect(
      await screen.findByLabelText("AGENTS.md 미리보기"),
    ).toBeInTheDocument();
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
      await screen.findByText(/Claude Code와 Codex는 설정 없이/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("명령 템플릿")).toBeNull();
  });

  it("shows the app AGENTS.md hub rules with a 10-line preview", async () => {
    const gateway = new FakeAiGateway();
    render(
      <TestQueryProvider>
        <AiSettingsPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("허브 공통 규칙")).toBeInTheDocument();
    expect(await screen.findByText("/app/AGENTS.md")).toBeInTheDocument();
    const preview = await screen.findByLabelText("앱 AGENTS.md 미리보기");
    expect(preview.textContent?.split("\n").length).toBeLessThanOrEqual(10);
  });
});
