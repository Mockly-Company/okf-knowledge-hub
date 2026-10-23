import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import "../documents.css";
import { createInitialAuthoringState } from "../document-authoring-reducer";
import { DocumentDraftSwitcher } from "./DocumentDraftSwitcher";

const activeDraftState = createInitialAuthoringState();
activeDraftState.drafts = [
  {
    workspaceId: "storybook-workspace",
    changeId: "storybook-draft-map-search",
    authorLogin: "storybook-bot",
    baseCommit: "a1b2c3d4",
    branch: "draft/storybook-bot/map-search-index-rebuild",
    createdAtUnixMs: 1_726_000_000_000,
    lastOpenedAtUnixMs: 1_726_000_000_000,
  },
];
activeDraftState.activeChangeId = "storybook-draft-map-search";

const meta = {
  id: "documents-documentdraftswitcher", title: "문서 컴포넌트/DocumentDraftSwitcher",
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
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole("combobox", { name: "문서 작업 전환" });

    await expect(trigger).toHaveTextContent(
      "변경 작업",
    );
    await expect(window.getComputedStyle(trigger).width).toBe("280px");

    await userEvent.click(trigger);

    const option = await within(canvasElement.ownerDocument.body).findByRole("option", { name: /변경 작업/ });
    const branch = option.querySelector<HTMLElement>(".document-draft-switcher__branch");
    const indicator = option?.querySelector<SVGElement>("svg");
    const content = option?.parentElement?.parentElement;

    await expect(branch).not.toBeNull();
    await expect(option).not.toBeNull();
    await expect(indicator).not.toBeNull();
    await expect(content).not.toBeNull();
    await expect(branch!.getBoundingClientRect().right).toBeLessThanOrEqual(
      indicator!.getBoundingClientRect().left,
    );
    await expect(indicator!.getBoundingClientRect().right).toBeLessThanOrEqual(
      content!.getBoundingClientRect().right,
    );

    await userEvent.keyboard("{Escape}");
  },
};
