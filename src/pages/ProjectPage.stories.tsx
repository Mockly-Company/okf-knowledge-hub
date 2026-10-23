import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ProjectPage } from "./ProjectPage";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";

const meta = { id: "pages-projectpage", title: "화면/프로젝트", component: ProjectPage, parameters: { layout: "fullscreen" }, decorators: [withAppProviders({ router: { initialEntries: ["/project"] } })], render: () => <PageStoryFrame><ProjectPage /></PageStoryFrame> } satisfies Meta<typeof ProjectPage>;
export default meta;
export const Default: StoryObj<typeof meta> = { play: async ({ canvas }) => { await expect(await canvas.findByRole("region", { name: "Project Board" })).toBeVisible(); } };
