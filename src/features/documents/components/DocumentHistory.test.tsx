import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "../DocumentsProvider";
import type { HistoryPage } from "../model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentsPage } from "@/pages/DocumentsPage";

const SESSION_ID = "4b20eda7-09a0-46f9-bd3b-4de83d4b0157";

afterEach(cleanup);

function renderSelectedDocument(gateway: FakeDocumentsGateway) {
  render(
    <MemoryRouter>
      <DocumentsProvider gateway={gateway} createId={() => SESSION_ID}>
        <DocumentsPage />
      </DocumentsProvider>
    </MemoryRouter>,
  );
}

describe("DocumentHistory", () => {
  it("loads history only after its tab is selected and sends the returned cursor when loading more", async () => {
    const gateway = new FakeDocumentsGateway();
    const firstPage: HistoryPage = {
      items: [
        {
          commitOid: "aabbccddeeff",
          shortOid: "aabbccd",
          pathAtCommit: "docs/guide.md",
          authorName: "Kim",
          authoredAtUnix: 1_721_000_000,
          message: "첫 번째 변경",
        },
      ],
      nextCursor: { beforeCommitOid: "aabbccddeeff", trackedPath: "docs/guide.md" },
    };
    const secondPage: HistoryPage = { items: [], nextCursor: null };
    const history = vi
      .spyOn(gateway, "listDocumentHistory")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const user = userEvent.setup();

    renderSelectedDocument(gateway);
    await screen.findByRole("region", { name: "Guide" });
    expect(history).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "History" }));
    await waitFor(() =>
      expect(history).toHaveBeenCalledWith(SESSION_ID, "docs/guide.md", null),
    );
    expect(await screen.findByText("첫 번째 변경")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "더 불러오기" }));
    await waitFor(() =>
      expect(history).toHaveBeenLastCalledWith(SESSION_ID, "docs/guide.md", {
        beforeCommitOid: "aabbccddeeff",
        trackedPath: "docs/guide.md",
      }),
    );
  });

  it("reads the selected historical blob by its path at commit and returns to the current document", async () => {
    const gateway = new FakeDocumentsGateway();
    vi.spyOn(gateway, "listDocumentHistory").mockResolvedValue({
      items: [
        {
          commitOid: "aabbccddeeff",
          shortOid: "aabbccd",
          pathAtCommit: "docs/renamed-guide.md",
          authorName: "Kim",
          authoredAtUnix: 1_721_000_000,
          message: "이전 이름",
        },
      ],
      nextCursor: null,
    });
    const readVersion = vi.spyOn(gateway, "readDocumentVersion");
    const user = userEvent.setup();

    renderSelectedDocument(gateway);
    await screen.findByRole("region", { name: "Guide" });
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /이전 이름/ }));

    await waitFor(() =>
      expect(readVersion).toHaveBeenCalledWith(
        SESSION_ID,
        SESSION_ID,
        "aabbccddeeff",
        "docs/renamed-guide.md",
      ),
    );
    expect(await screen.findByText(/과거 버전/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "현재 문서로 돌아가기" }));
    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "readDocument")).toHaveLength(2),
    );
  });

  it("shows a historical-version read error and retries the same version", async () => {
    const gateway = new FakeDocumentsGateway();
    vi.spyOn(gateway, "listDocumentHistory").mockResolvedValue({
      items: [
        {
          commitOid: "aabbccddeeff",
          shortOid: "aabbccd",
          pathAtCommit: "docs/renamed-guide.md",
          authorName: "Kim",
          authoredAtUnix: 1_721_000_000,
          message: "읽을 수 없는 버전",
        },
      ],
      nextCursor: null,
    });
    const readVersion = vi
      .spyOn(gateway, "readDocumentVersion")
      .mockRejectedValue({
        code: "document_history_invalid",
        message: "과거 버전을 읽지 못했습니다.",
        recovery: "retry",
        details: {},
      });
    const user = userEvent.setup();

    renderSelectedDocument(gateway);
    await screen.findByRole("region", { name: "Guide" });
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(
      await screen.findByRole("button", { name: /읽을 수 없는 버전/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "과거 버전을 읽지 못했습니다.",
    );
    expect(screen.queryByText("문서를 여는 중…")).toBeNull();
    await user.click(screen.getByRole("button", { name: "버전 다시 열기" }));
    await waitFor(() => expect(readVersion).toHaveBeenCalledTimes(2));
    expect(readVersion).toHaveBeenLastCalledWith(
      SESSION_ID,
      SESSION_ID,
      "aabbccddeeff",
      "docs/renamed-guide.md",
    );
  });
});
