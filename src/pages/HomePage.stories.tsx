import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { HomePage } from "./HomePage";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";

const meta = { id: "pages-homepage", title: "화면/홈", component: HomePage, parameters: { layout: "fullscreen" }, decorators: [withAppProviders()], render: () => <PageStoryFrame><HomePage /></PageStoryFrame> } satisfies Meta<typeof HomePage>;
export default meta;
export const Default: StoryObj<typeof meta> = { play: async ({ canvas }) => { await expect(await canvas.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeVisible(); } };
