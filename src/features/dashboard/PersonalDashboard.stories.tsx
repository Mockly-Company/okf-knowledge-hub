import type { Meta, StoryObj } from "@storybook/react-vite";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PersonalDashboardProvider } from "./PersonalDashboardProvider";
import { PersonalDashboardView } from "./PersonalDashboardView";
import { FakePersonalDashboardGateway } from "@/test/FakePersonalDashboardGateway";

const sampleGateway = new FakePersonalDashboardGateway({
  viewerLogin: "YoonDongGeun",
  assigneeOptions: [
    { login: "YoonDongGeun", name: "윤동근" },
    { login: "alice", name: "앨리스" },
  ],
  tasks: [
    {
      workspaceId: "PVT_alpha",
      workspaceTitle: "OkHub 기획 보드",
      projectOwner: "Mockly-Company",
      projectNumber: 1,
      projectTitle: "OkHub 기획 보드",
      repositoryFullName: "Mockly-Company/okf-knowledge-hub",
      issueNumber: 74,
      title: "[프론트엔드] 멀티 프로젝트 내 작업 대시보드 UI 구현",
      url: "https://github.com/Mockly-Company/okf-knowledge-hub/issues/74",
      status: "in_progress",
      layer: "frontend",
      kind: "작업",
      dependsOn: 73,
      predecessorDone: true,
      readyToStart: true,
      isNew: true,
      assignees: [{ login: "YoonDongGeun", name: "윤동근" }],
      createdAt: "2026-11-14T00:00:00Z",
      updatedAt: "2026-11-14T01:00:00Z",
    },
    {
      workspaceId: "PVT_alpha",
      workspaceTitle: "OkHub 기획 보드",
      projectOwner: "Mockly-Company",
      projectNumber: 1,
      projectTitle: "OkHub 기획 보드",
      repositoryFullName: "Mockly-Company/okf-knowledge-hub",
      issueNumber: 77,
      title: "[프론트엔드] 팀원 배정 설정 및 AI 시작 owner 체크 구현",
      url: "https://github.com/Mockly-Company/okf-knowledge-hub/issues/77",
      status: "ready",
      layer: "frontend",
      kind: "작업",
      dependsOn: 74,
      predecessorDone: false,
      readyToStart: false,
      isNew: false,
      assignees: [{ login: "YoonDongGeun", name: "윤동근" }],
      createdAt: "2026-11-14T00:00:00Z",
      updatedAt: "2026-11-14T01:00:00Z",
    },
  ],
  notifications: [
    {
      id: "open_pr:PVT_alpha:18",
      workspaceId: "PVT_alpha",
      workspaceTitle: "OkHub 기획 보드",
      repositoryFullName: "Mockly-Company/hub-knowledge",
      kind: "open_pr",
      prNumber: 18,
      title: "docs: 멀티 워크스페이스 대시보드 화면명세 업데이트",
      summary: "내 담당 백로그 및 기획 변경 알림 카드 규격 반영",
      authorLogin: "alice",
      url: "https://github.com/Mockly-Company/hub-knowledge/pull/18",
      primaryDocPath: "docs/dashboard/screen-spec.md",
      hasCompanionHtml: true,
      timestamp: "2026-11-14T02:00:00Z",
      isNew: true,
    },
  ],
});

function PersonalDashboardStoryHarness() {
  return (
    <PersonalDashboardProvider gateway={sampleGateway}>
      <PersonalDashboardView />
    </PersonalDashboardProvider>
  );
}

const meta = {
  title: "기능/내 대시보드",
  component: PersonalDashboardStoryHarness,
  parameters: { layout: "fullscreen" },
  decorators: [withAppProviders()],
} satisfies Meta<typeof PersonalDashboardStoryHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "기본 보기",
};
