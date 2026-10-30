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
      await canvas.findByRole("region", { name: "계층 보기" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("article", { name: "에픽 #12 기획서 초안" }),
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
      await canvas.findByText("연결된 Issue 없음"),
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

export const Layers: StoryObj<typeof meta> = {
  render: () => (
    <PageStoryFrame>
      <ProjectPage gateway={boardGateway} />
    </PageStoryFrame>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "영역별" }),
    );
    await expect(
      await canvas.findByRole("region", { name: "기획 레이어" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("article", { name: "Issue #12 기획서 초안" }),
    ).toBeVisible();
  },
};

const flowGateway = FakeProjectBoardGateway.withIssues(
  [
    {
      number: 1,
      title: "예시 에픽",
      url: "https://example.test/issues/1",
      layer: "unassigned",
      status: "in_progress",
      children: [
        {
          number: 2,
          title: "예시 기획",
          url: "https://example.test/issues/2",
          layer: "planning",
          status: "in_progress",
          children: [],
          kind: "기능",
          dependsOn: null,
        },
        {
          number: 3,
          title: "예시 기획-IA 구조",
          url: "https://example.test/issues/3",
          layer: "planning",
          status: "backlog",
          children: [],
          kind: "기능",
          dependsOn: 2,
        },
        {
          number: 4,
          title: "예시 디자인-홈화면",
          url: "https://example.test/issues/4",
          layer: "design",
          status: "backlog",
          children: [],
          kind: "기능",
          dependsOn: 3,
        },
      ],
      kind: null,
    },
  ],
  "2026-10-25T12:00:00+09:00",
);

export const Flow: StoryObj<typeof meta> = {
  render: () => (
    <PageStoryFrame>
      <ProjectPage gateway={flowGateway} />
    </PageStoryFrame>
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("list", { name: "예시 에픽 흐름 요약" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("article", { name: "스토리 #3 예시 기획-IA 구조" }),
    ).toBeVisible();
  },
};
