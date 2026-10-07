import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "@/app/AppRoutes";
import { StorybookAppProviders, useStorybookProviderBoundary } from "./AppProviders";

function DemoRoutes() {
  return <AppRoutes documentsGateway={useStorybookProviderBoundary().documents} />;
}
afterEach(cleanup);

async function startDownload(outcome: "success" | "failure") {
  const user = userEvent.setup();
  render(<StorybookAppProviders includeDocumentsProvider={false} workspace={{ currentWorkspace: null, ...{ cloneOutcome: outcome } }}><DemoRoutes /></StorybookAppProviders>);
  await user.click(await screen.findByRole("radio", { name: /demo-knowledge/ }));
  await user.click(screen.getByRole("button", { name: "다음" }));
  await user.click(screen.getByRole("radio", { name: "새로 다운로드해서 연결" }));
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
  return user;
}

describe("Storybook download simulation", () => {
  it("finishes the download through workspace validation and the real Home route", async () => {
    await startDownload("success");
    expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황", level: 1 }, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "로컬 연결" })).not.toBeInTheDocument();
  });
  it("shows a recoverable failure and permits another download attempt", async () => {
    const user = await startDownload("failure");
    expect(await screen.findByText("다운로드 연결이 끊겼습니다. 다시 시도하세요.", {}, { timeout: 3000 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: "다운로드 중…" })).toBeDisabled();
  });
});
