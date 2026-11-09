import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ActiveProjectModule from "@/features/active-project/ActiveProjectProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { DocsPullNotice } from "./DocsPullNotice";
import {
  DOCS_PULL_INTERVAL_MS,
  useDocsRepositorySync,
} from "./useDocsRepositorySync";

function Sync({ gateway }: { gateway: FakeDocsRepositoryGateway }) {
  useDocsRepositorySync(gateway);
  return <DocsPullNotice />;
}

function renderSync(gateway: FakeDocsRepositoryGateway, documents = new FakeDocumentsGateway()) {
  documents.sessionSnapshot.lastOpenedPath = null;
  const view = render(
    <TestQueryProvider>
      <DocumentsProvider gateway={documents} searchDebounceMs={0}>
        <Sync gateway={gateway} />
      </DocumentsProvider>
    </TestQueryProvider>,
  );
  return { documents, view };
}

function mockActiveProject(id: string) {
  return vi.spyOn(ActiveProjectModule, "useOptionalActiveProject").mockReturnValue({
    activeProjectId: id,
  } as unknown as ActiveProjectModule.ActiveProjectContextValue);
}

describe("useDocsRepositorySync", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pulls on mount and every five minutes", async () => {
    const gateway = new FakeDocsRepositoryGateway();
    renderSync(gateway);

    await waitFor(() => expect(gateway.pulls).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCS_PULL_INTERVAL_MS);
    });
    expect(gateway.pulls).toBe(2);
    expect(DOCS_PULL_INTERVAL_MS).toBe(300_000);
  });

  it("refreshes documents only after an update", async () => {
    const gateway = new FakeDocsRepositoryGateway();
    gateway.pullOutcome = "up_to_date";
    const { documents } = renderSync(gateway);
    await waitFor(() =>
      expect(documents.calls.some((call) => call.method === "startSession")).toBe(true),
    );
    await waitFor(() => expect(gateway.pulls).toBeGreaterThanOrEqual(1));
    expect(documents.calls.some((call) => call.method === "refreshSession")).toBe(false);

    gateway.pullOutcome = "updated";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCS_PULL_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(documents.calls.some((call) => call.method === "refreshSession")).toBe(true),
    );
  });

  it("shows the notice when the pull was skipped", async () => {
    const gateway = new FakeDocsRepositoryGateway();
    gateway.pullOutcome = "skipped_local_changes";
    renderSync(gateway);

    expect(
      await screen.findByText("작업 중인 변경이 있어 최신 내용을 받지 않았습니다."),
    ).toBeInTheDocument();
  });

  it("pulls again when the active project changes", async () => {
    const gateway = new FakeDocsRepositoryGateway();
    const spy = mockActiveProject("a");
    const { view } = renderSync(gateway);
    await waitFor(() => expect(gateway.pulls).toBe(1));

    spy.mockReturnValue({
      activeProjectId: "b",
    } as unknown as ActiveProjectModule.ActiveProjectContextValue);
    view.rerender(
      <TestQueryProvider>
        <DocumentsProvider gateway={new FakeDocumentsGateway()} searchDebounceMs={0}>
          <Sync gateway={gateway} />
        </DocumentsProvider>
      </TestQueryProvider>,
    );

    await waitFor(() => expect(gateway.pulls).toBe(2));
  });
});
