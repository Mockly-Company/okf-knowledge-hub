import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { ProjectPage } from "./ProjectPage";

const meta = {
  id: "pages-projectpage",
  title: "화면/프로젝트",
  component: ProjectPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withAppProviders({ router: { initialEntries: ["/project"] } }),
  ],
} satisfies Meta<typeof ProjectPage>;
export default meta;

const boardGateway = FakeProjectBoardGateway.withIssues(
  [
    {
      number: 12,
      title: "기획서 초안",
      url: "https://example.test/issues/12",
      layer: "planning",
      status: "in_progress",
      children: [
        {
          number: 13,
          title: "하위 작업",
          url: "https://example.test/issues/13",
          layer: "planning",
          status: "backlog",
          children: [],
          kind: "작업",
        },
      ],
      kind: "기능",
    },
    {
      number: 34,
      title: "홈 화면 시안",
      url: "https://example.test/issues/34",
      layer: "design",
      status: "backlog",
      children: [],
      kind: null,
    },
  ],
  "2026-10-25T12:00:00+09:00",
);

export const Default: StoryObj<typeof meta> = {
  render: () => (
    <PageStoryFrame>
      <ProjectPage gateway={boardGateway} />
    </PageStoryFrame>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("region", { name: "기획 레이어" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("article", { name: "Issue #12 기획서 초안" }),
    ).toBeVisible();
  },
};

export const Empty: StoryObj<typeof meta> = {
  render: () => (
    <PageStoryFrame>
      <ProjectPage gateway={FakeProjectBoardGateway.empty()} />
    </PageStoryFrame>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("region", { name: "백엔드 레이어" }),
    ).toBeVisible();
  },
};

export const NotLinked: StoryObj<typeof meta> = {
  render: () => (
    <PageStoryFrame>
      <ProjectPage gateway={FakeProjectBoardGateway.unlinked()} />
    </PageStoryFrame>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("region", { name: "GitHub Project 연결" }),
    ).toBeVisible();
  },
};
