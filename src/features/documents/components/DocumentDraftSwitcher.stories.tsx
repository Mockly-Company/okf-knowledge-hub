import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { createInitialAuthoringState } from "../document-authoring-reducer";
import { DocumentDraftSwitcher } from "./DocumentDraftSwitcher";

const activeDraftState = createInitialAuthoringState();
activeDraftState.drafts = [
  {
    workspaceId: "storybook-workspace",
    changeId: "storybook-draft-map-search",
    authorLogin: "storybook-bot",
    baseCommit: "a1b2c3d4",
    branch: "draft/storybook-bot/map-search",
    createdAtUnixMs: 1_726_000_000_000,
    lastOpenedAtUnixMs: 1_726_000_000_000,
  },
];
activeDraftState.activeChangeId = "storybook-draft-map-search";

const meta = {
  title: "Documents/DocumentDraftSwitcher",
  component: DocumentDraftSwitcher,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DocumentDraftSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActiveDraft: Story = {
  args: {
    state: activeDraftState,
    onSwitch: () => {},
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("combobox", { name: "문서 작업 전환" })).toHaveTextContent(
      "변경 작업",
    );
  },
};
