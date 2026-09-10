import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialAuthoringState } from "../document-authoring-reducer";
import { DocumentDraftSwitcher } from "./DocumentDraftSwitcher";

afterEach(cleanup);

describe("DocumentDraftSwitcher", () => {
  it("uses a compact confirmed-document label instead of a separate work-basis field", () => {
    const state = createInitialAuthoringState();

    render(<DocumentDraftSwitcher state={state} onSwitch={() => {}} />);

    expect(screen.getByRole("combobox", { name: "문서 작업 전환" })).toHaveTextContent(
      "확정 문서",
    );
    expect(screen.queryByText("작업 기준")).not.toBeInTheDocument();
  });

  it("keeps a failed draft switch visible beside the selector", () => {
    const state = createInitialAuthoringState();
    state.draftSwitch = {
      status: "error",
      requestId: "632af6ac-8034-4d83-ac65-8dc43cc306c2",
      changeId: null,
      error: {
        code: "document_session_stale",
        message: "로컬 Draft를 열 수 없습니다.",
        recovery: "retry",
        details: {},
      },
    };

    render(<DocumentDraftSwitcher state={state} onSwitch={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "로컬 Draft를 열 수 없습니다.",
    );
  });

  it("switches to an available Draft with the keyboard Select flow", async () => {
    const user = userEvent.setup();
    const state = createInitialAuthoringState();
    state.drafts = [
      {
        workspaceId: "workspace-id",
        changeId: "draft-map-search",
        authorLogin: "hyeeun",
        baseCommit: "a1b2c3d4",
        branch: "draft/hyeeun/map-search",
        createdAtUnixMs: 1,
        lastOpenedAtUnixMs: 1,
      },
    ];
    const onSwitch = vi.fn();

    render(<DocumentDraftSwitcher state={state} onSwitch={onSwitch} />);

    const trigger = screen.getByRole("combobox", { name: "문서 작업 전환" });
    trigger.focus();
    await user.keyboard("{Enter}{ArrowDown}{Enter}");

    expect(onSwitch).toHaveBeenCalledWith("draft-map-search");
  });
});
