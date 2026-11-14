import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectIssueDrawer } from "./ProjectIssueDrawer";
import type { BoardIssue } from "./model";
import type { ProjectBoardIssueDetail } from "./ProjectBoardGateway";

const sampleIssue: BoardIssue = {
  number: 60,
  title: "[기획] 알림 채널 설정 명세 확정",
  url: "https://github.com/Acme-Org/acme-docs/issues/60",
  layer: "planning",
  status: "ready",
  children: [
    {
      number: 61,
      title: "[백엔드] 알림 웹훅 발송 API 구현",
      url: "https://github.com/Acme-Org/acme-web/issues/61",
      layer: "backend",
      status: "backlog",
      children: [],
      kind: "작업",
      dependsOn: 60,
    },
  ],
  kind: "기능",
  dependsOn: null,
};

const sampleDetail: ProjectBoardIssueDetail = {
  number: 60,
  title: "[기획] 알림 채널 설정 명세 확정",
  url: "https://github.com/Acme-Org/acme-docs/issues/60",
  repositoryFullName: "Acme-Org/acme-docs",
  layer: "planning",
  status: "ready",
  kind: "기능",
  priority: "P1",
  body: "## 배경\n팀별 슬랙·웹훅 알림 정책을 정의합니다.\n\n## 완료 조건\n- [ ] `docs/product/notifications.md` 정본 및 `.html` 사람용 뷰 갱신\n- [ ] `[NEW]` / `[CHANGED]` 하이라이트 표시",
  dependsOn: null,
  predecessorDone: true,
  readyToStart: true,
  subIssues: [
    {
      number: 61,
      title: "[백엔드] 알림 웹훅 발송 API 구현",
      url: "https://github.com/Acme-Org/acme-web/issues/61",
    },
  ],
  linkedDocuments: [
    {
      path: "docs/product/notifications.md",
      hasCompanionHtml: true,
    },
  ],
  linkedPullRequests: [
    {
      number: 18,
      title: "docs: 팀 알림 설정 기획서 작성 (#60)",
      htmlUrl: "https://github.com/Acme-Org/acme-docs/pull/18",
      repositoryFullName: "Acme-Org/acme-docs",
      isDraft: false,
    },
  ],
  recommendedWorkingDir: "/Users/dev/workspace/acme-docs",
  priorityOptions: ["P0", "P1", "P2"],
};

const meta = {
  title: "Features/ProjectBoard/ProjectIssueDrawer",
  component: ProjectIssueDrawer,
  decorators: [
    (Story) => (
      <div className="min-h-[640px] bg-[var(--color-surface)] p-[var(--space-6)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectIssueDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenWithLinkedDocsAndPr: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    issue: sampleIssue,
    detail: sampleDetail,
    isLoadingDetail: false,
    detailError: null,
    readiness: { state: "ready", waitingOn: null },
    isUpdating: false,
    updateError: null,
    onUpdateField: () => {},
    onStartWithAi: () => {},
  },
};
