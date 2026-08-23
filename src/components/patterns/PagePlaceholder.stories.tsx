import type { Meta, StoryObj } from "@storybook/react-vite";
import { PagePlaceholder } from "./PagePlaceholder";
import { withAppProviders } from "@/stories/decorators/AppProviders";

const meta = {
  title: "Patterns/PagePlaceholder",
  component: PagePlaceholder,
  decorators: [withAppProviders()],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PagePlaceholder>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyState: Story = {
  args: {
    title: "Project",
    description: "연결된 GitHub Issue와 Iteration이 아직 없어 표시할 내용이 없습니다.",
  },
};

export const LoadingState: Story = {
  args: {
    title: "Settings",
    description: "워크스페이스 설정을 불러오는 중입니다.",
  },
};

export const RecoverableErrorState: Story = {
  args: {
    title: "Documents",
    description: "문서를 준비하지 못했습니다. 설정을 확인한 뒤 다시 시도해 주세요.",
  },
};

export const CompactDensity: Story = {
  globals: {
    displayDensity: "compact",
  },
  args: {
    title: "Home",
    description: "Compact 밀도에서도 같은 placeholder 구조를 유지합니다.",
  },
};
