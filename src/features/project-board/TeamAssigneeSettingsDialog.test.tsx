import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTeamAssigneesSnapshot } from "./model";
import {
  TeamAssigneeSettingsDialog,
  type TeamAssigneeSettingsDialogProps,
} from "./TeamAssigneeSettingsDialog";

afterEach(cleanup);

function baseSnapshot(
  overrides: Partial<WorkspaceTeamAssigneesSnapshot> = {},
): WorkspaceTeamAssigneesSnapshot {
  return {
    viewerLogin: "alice",
    docsRepositoryFullName: "Acme-Org/acme-docs",
    canWriteDocsRepository: true,
    members: [
      { login: "charlie", name: "찰리" },
      { login: "alice", name: "가나다" },
      { login: "bob", name: "나다라" },
    ],
    assignees: {
      planning: ["alice"],
      design: ["bob"],
      frontend: [],
      backend: ["charlie"],
    },
    staleLogins: [],
    memberFetchFailed: false,
    fetchedAt: "2026-11-15T10:00:00Z",
    ...overrides,
  };
}

function renderDialog(overrides: Partial<TeamAssigneeSettingsDialogProps> = {}) {
  const props: TeamAssigneeSettingsDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    snapshot: baseSnapshot(),
    isLoading: false,
    fetchError: null,
    isRefreshing: false,
    isSaving: false,
    saveError: null,
    onRefreshMembers: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(<TeamAssigneeSettingsDialog {...props} />),
  };
}

describe("TeamAssigneeSettingsDialog", () => {
  it("renders title, fixed description, sorted member rows, multi-role toggles, and missing-role warning", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    const dialog = screen.getByRole("dialog", { name: "담당 설정" });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByText(
        "팀 멤버마다 맡을 역할을 고르세요. AI가 백로그를 나눌 때 여기 설정된 사람에게만 배정합니다.",
      ),
    ).toBeVisible();

    // Missing frontend role banner
    expect(
      within(dialog).getByText(
        "프론트엔드 담당자가 없습니다. AI가 해당 백로그를 만들 때 먼저 물어봅니다.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).queryByText(/기획 담당자가 없습니다/),
    ).toBeNull();

    // Sorted by display name (가나다 -> 나다라 -> 찰리)
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-member-login"))).toEqual([
      "alice",
      "bob",
      "charlie",
    ]);

    const aliceRow = rows[0]!;
    const alicePlanning = within(aliceRow).getByRole("button", {
      name: "기획",
    });
    expect(alicePlanning).toHaveAttribute("aria-pressed", "true");

    const saveButton = within(dialog).getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();

    // Assign alice also to frontend (multiple roles for same member) & bob also to frontend
    await user.click(within(aliceRow).getByRole("button", { name: "프론트엔드" }));
    await user.click(within(rows[1]!).getByRole("button", { name: "프론트엔드" }));

    expect(
      within(dialog).queryByText(/프론트엔드 담당자가 없습니다/),
    ).toBeNull();
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith({
      planning: ["alice"],
      design: ["bob"],
      frontend: ["alice", "bob"],
      backend: ["charlie"],
    });
  });

  it("renders stale logins with 지정 불가, does not count them toward valid roles, and preserves them on save until 제거 is clicked", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({
      snapshot: baseSnapshot({
        members: [{ login: "Alice", name: "앨리스" }],
        assignees: {
          planning: ["ghost-user"],
          design: [],
          frontend: ["alice"],
          backend: ["ghost-user"],
        },
        staleLogins: ["ghost-user"],
      }),
      onSave,
    });

    // ghost-user is stale so planning & backend still warn as missing valid assignees
    expect(
      screen.getByText(
        "기획 담당자가 없습니다. AI가 해당 백로그를 만들 때 먼저 물어봅니다.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "백엔드 담당자가 없습니다. AI가 해당 백로그를 만들 때 먼저 물어봅니다.",
      ),
    ).toBeVisible();

    const staleSection = screen.getByRole("region", {
      name: "지정할 수 없는 담당자",
    });
    expect(within(staleSection).getByText("@ghost-user")).toBeVisible();
    expect(within(staleSection).getByText("지정 불가")).toBeVisible();

    // Edit valid role without clicking 제거 -> stale login preserved in save payload
    const aliceRow = screen.getByRole("listitem", { name: /@Alice/i });
    await user.click(within(aliceRow).getByRole("button", { name: "디자인" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(onSave).toHaveBeenLastCalledWith({
      planning: ["ghost-user"],
      design: ["Alice"],
      frontend: ["alice"],
      backend: ["ghost-user"],
    });

    // Clicking 제거 deletes stale login from all roles
    await user.click(within(staleSection).getByRole("button", { name: "제거" }));
    expect(
      screen.queryByRole("region", { name: "지정할 수 없는 담당자" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenLastCalledWith({
      planning: [],
      design: ["Alice"],
      frontend: ["alice"],
      backend: [],
    });
  });

  it("preserves unsaved draft selections when 멤버 목록 새로고침 updates snapshot", async () => {
    const user = userEvent.setup();
    const onRefreshMembers = vi.fn();
    const initial = baseSnapshot();
    const { rerender } = render(
      <TeamAssigneeSettingsDialog
        open
        onOpenChange={vi.fn()}
        snapshot={initial}
        isLoading={false}
        fetchError={null}
        isRefreshing={false}
        isSaving={false}
        saveError={null}
        onRefreshMembers={onRefreshMembers}
        onSave={vi.fn()}
      />,
    );

    const bobRow = screen.getByRole("listitem", { name: /@bob/i });
    await user.click(within(bobRow).getByRole("button", { name: "프론트엔드" }));
    expect(
      within(bobRow).getByRole("button", { name: "프론트엔드" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByRole("button", { name: "멤버 목록 새로고침" }),
    );
    expect(onRefreshMembers).toHaveBeenCalledTimes(1);

    rerender(
      <TeamAssigneeSettingsDialog
        open
        onOpenChange={vi.fn()}
        snapshot={{
          ...initial,
          members: [...initial.members, { login: "diana", name: "다이애나" }],
          fetchedAt: "2026-11-15T10:05:00Z",
        }}
        isLoading={false}
        fetchError={null}
        isRefreshing={false}
        isSaving={false}
        saveError={null}
        onRefreshMembers={onRefreshMembers}
        onSave={vi.fn()}
      />,
    );

    const updatedBobRow = screen.getByRole("listitem", { name: /@bob/i });
    expect(
      within(updatedBobRow).getByRole("button", { name: "프론트엔드" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("@diana")).toBeVisible();
  });

  it("renders loading, empty, fetch error retry, and save error states cleanly", async () => {
    const user = userEvent.setup();
    const onRefreshMembers = vi.fn();

    const loadingView = renderDialog({
      snapshot: null,
      isLoading: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "팀 멤버를 불러오는 중…",
    );
    loadingView.unmount();

    const emptyView = renderDialog({
      snapshot: baseSnapshot({
        members: [],
        assignees: { planning: [], design: [], frontend: [], backend: [] },
      }),
    });
    expect(
      screen.getByText(
        "담당 가능한 멤버가 없습니다. 저장소에 멤버를 초대한 뒤 새로고침하세요.",
      ),
    ).toBeVisible();
    emptyView.unmount();

    renderDialog({
      snapshot: baseSnapshot({
        members: [],
        memberFetchFailed: true,
      }),
      saveError: "담당 설정을 저장하지 못했습니다.",
      onRefreshMembers,
    });
    expect(
      screen.getByText("멤버 목록을 불러오지 못했습니다. 현재 설정만 표시합니다."),
    ).toBeVisible();
    expect(screen.getByText("담당 설정을 저장하지 못했습니다.")).toBeVisible();
    // Configured members still shown under current config
    expect(screen.getByText("@alice")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRefreshMembers).toHaveBeenCalledTimes(1);
  });

  it("swallows rejected onSave promises without leaving an unhandled rejection (#77)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("저장 실패"));
    renderDialog({ onSave });

    const aliceRow = screen.getByRole("listitem", { name: /@alice/i });
    await user.click(within(aliceRow).getByRole("button", { name: "프론트엔드" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });
});
