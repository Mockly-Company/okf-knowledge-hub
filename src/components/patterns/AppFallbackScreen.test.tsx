import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFallbackScreen } from "./AppFallbackScreen";

afterEach(cleanup);

describe("AppFallbackScreen", () => {
  it("renders the not-found fallback screen and triggers 홈으로 돌아가기 / 문서로 이동", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    const onGoDocuments = vi.fn();

    render(
      <AppFallbackScreen
        kind="not_found"
        detail="/unknown-toc-anchor"
        onGoHome={onGoHome}
        onGoDocuments={onGoDocuments}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "요청한 화면을 찾을 수 없습니다" }),
    ).toBeVisible();
    expect(screen.getByText("/unknown-toc-anchor")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "홈으로 돌아가기" }));
    expect(onGoHome).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "문서로 이동" }));
    expect(onGoDocuments).toHaveBeenCalledTimes(1);
  });

  it("renders the error fallback screen with retry action and suppresses sensitive paths/tokens", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    const onRetry = vi.fn();

    const { rerender } = render(
      <AppFallbackScreen
        kind="error"
        detail="Unexpected failure at /Users/alice/secret/repo.ts"
        onGoHome={onGoHome}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "화면을 표시하는 중 문제가 발생했습니다",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/\/Users\/alice/)).toBeNull();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Token leak ghu_secret123"
        onGoHome={onGoHome}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText(/ghu_secret123/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("masks GitHub/API tokens and local paths while suppressing unstructured secret leaks", () => {
    const onGoHome = vi.fn();
    const { rerender } = render(
      <AppFallbackScreen
        kind="error"
        detail="GitHub request failed with ghp_abc123XYZ and gho_oauth456 and github_pat_11AA_zz and sk-proj-999"
        onGoHome={onGoHome}
      />,
    );

    expect(screen.queryByText(/ghp_abc123XYZ/)).toBeNull();
    expect(screen.queryByText(/gho_oauth456/)).toBeNull();
    expect(screen.queryByText(/github_pat_11AA_zz/)).toBeNull();
    expect(screen.queryByText(/sk-proj-999/)).toBeNull();
    expect(
      screen.getByText(
        "GitHub request failed with [REDACTED] and [REDACTED] and [REDACTED] and [REDACTED]",
      ),
    ).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Callback error at /callback?token=topsecret42 with Authorization: Bearer bearersecret99 and api_key=myapikey77"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/topsecret42/)).toBeNull();
    expect(screen.queryByText(/bearersecret99/)).toBeNull();
    expect(screen.queryByText(/myapikey77/)).toBeNull();
    expect(
      screen.getByText(
        "Callback error at /callback?token=[REDACTED] with Authorization: [REDACTED] and api_key=[REDACTED]",
      ),
    ).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Unexpected failure at C:\\Users\\alice\\repo\\secret-file.ts"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/C:\\Users\\alice/)).toBeNull();
    expect(screen.getByText("Unexpected failure at [REDACTED]")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Unexpected failure at C:/Users/alice/repo/secret-file.ts"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/C:\/Users\/alice/)).toBeNull();
    expect(screen.getByText("Unexpected failure at [REDACTED]")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail={'error path=D:/Users/alice/secret.ts and file:///C:/Users/alice/id_rsa and "E:/tmp/crash.log"'}
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/Users\/alice/)).toBeNull();
    expect(screen.queryByText(/E:\/tmp/)).toBeNull();
    expect(
      screen.getByText(
        'error path=[REDACTED] and file:///[REDACTED] and "[REDACTED]"',
      ),
    ).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail={'Auth failed: client_secret="unclosedRawSecret999'}
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/unclosedRawSecret999/)).toBeNull();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail={"-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----"}
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/abc123/)).toBeNull();
    expect(screen.getByText("[REDACTED]")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="password reset required"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.getByText("password reset required")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="missing authorization header"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.getByText("missing authorization header")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="session token expired"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.getByText("session token expired")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Failed while opening task-12"
        onGoHome={onGoHome}
      />,
    );
    expect(screen.getByText("Failed while opening task-12")).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail={'error path=/Users/alice/secret.ts and ref=token:/Users/alice/id_rsa and "/private/var/tmp/crash.log"'}
        onGoHome={onGoHome}
      />,
    );
    expect(screen.queryByText(/\/Users\/alice/)).toBeNull();
    expect(screen.queryByText(/\/private\/var/)).toBeNull();
    expect(
      screen.getByText(
        "error path=[REDACTED] and ref=token:[REDACTED] and \"[REDACTED]\"",
      ),
    ).toBeVisible();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Remote resource missing at https://github.com/users/octocat"
        onGoHome={onGoHome}
      />,
    );
    expect(
      screen.getByText("Remote resource missing at https://github.com/users/octocat"),
    ).toBeVisible();
  });
});
