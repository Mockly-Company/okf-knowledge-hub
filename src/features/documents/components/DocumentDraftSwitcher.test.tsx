import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialAuthoringState } from "../document-authoring-reducer";
import { DocumentDraftSwitcher } from "./DocumentDraftSwitcher";

afterEach(cleanup);

describe("DocumentDraftSwitcher", () => {
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
});
