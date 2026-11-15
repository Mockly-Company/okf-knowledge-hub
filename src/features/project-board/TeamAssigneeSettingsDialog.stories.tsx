import type { Meta, StoryObj } from "@storybook/react-vite";
import { TeamAssigneeSettingsDialog } from "./TeamAssigneeSettingsDialog";
import type { WorkspaceTeamAssigneesSnapshot } from "./model";

const sampleSnapshot: WorkspaceTeamAssigneesSnapshot = {
  viewerLogin: "alice",
  docsRepositoryFullName: "Acme-Org/acme-docs",
  canWriteDocsRepository: true,
  members: [
    { login: "alice", name: "김기획" },
    { login: "bob", name: "이디자인" },
    { login: "carol", name: "박프론트" },
    { login: "dave", name: "최백엔드" },
  ],
  assignees: {
    planning: ["alice"],
    design: ["bob"],
    frontend: ["carol"],
    backend: ["dave"],
  },
  staleLogins: [],
  memberFetchFailed: false,
  fetchedAt: "2026-11-15T12:00:00Z",
};

const meta = {
  title: "Features/ProjectBoard/TeamAssigneeSettingsDialog",
  component: TeamAssigneeSettingsDialog,
  decorators: [
    (Story) => (
      <div className="min-h-[640px] bg-[var(--color-surface)] p-[var(--space-6)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TeamAssigneeSettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    snapshot: sampleSnapshot,
    isLoading: false,
    fetchError: null,
    isRefreshing: false,
    isSaving: false,
    saveError: null,
    onRefreshMembers: () => {},
    onSave: () => {},
  },
};

export const MissingRolesAndStale: Story = {
  args: {
    ...Default.args,
    snapshot: {
      ...sampleSnapshot,
      members: sampleSnapshot.members.slice(0, 2),
      assignees: {
        planning: ["alice"],
        design: [],
        frontend: ["ghost-dev"],
        backend: [],
      },
      staleLogins: ["ghost-dev"],
    },
  },
};

export const EmptyMembers: Story = {
  args: {
    ...Default.args,
    snapshot: {
      ...sampleSnapshot,
      members: [],
      assignees: {
        planning: [],
        design: [],
        frontend: [],
        backend: [],
      },
    },
  },
};

export const FetchErrorAndSaveError: Story = {
  args: {
    ...Default.args,
    snapshot: {
      ...sampleSnapshot,
      members: [],
      memberFetchFailed: true,
    },
    fetchError: null,
    saveError: "담당 설정을 저장하지 못했습니다.",
  },
};
