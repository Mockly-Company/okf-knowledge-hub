import { describe, expect, it } from "vitest";
import * as ButtonStories from "../components/ui/button.stories";
import * as InputStories from "../components/ui/input.stories";
import * as TabsStories from "../components/ui/tabs.stories";
import * as StatusBadgeStories from "../components/patterns/StatusBadge.stories";
import * as AppShellStories from "../components/patterns/AppShell.stories";
import * as DocumentStories from "../pages/DocumentsPage.stories";
import * as DocumentDetailStories from "../pages/DocumentDetail.stories";
import * as DocumentSearchStories from "../features/documents/components/DocumentSearch.stories";
import * as DocumentDraftSwitcherStories from "../features/documents/components/DocumentDraftSwitcher.stories";

function namedStories(module: Record<string, unknown>) {
  return Object.keys(module).filter((name) => name !== "default").sort();
}

describe("Storybook catalog", () => {
  it("uses discrete user-facing states instead of gallery-only exports", () => {
    expect(namedStories(ButtonStories)).toEqual([
      "Default",
      "Disabled",
      "IconOnly",
      "Keyboard",
      "Loading",
    ]);
    expect(namedStories(InputStories)).toEqual(["Default", "Disabled", "Invalid"]);
    expect(namedStories(TabsStories)).toEqual(["Default"]);
    expect(namedStories(StatusBadgeStories)).toEqual(["Compact", "Default"]);
    expect(namedStories(DocumentStories)).toEqual([
      "EmptySearch",
      "Home",
      "SearchResults",
    ]);
    expect(namedStories(DocumentDetailStories)).toEqual(["Default"]);
    expect(namedStories(DocumentSearchStories)).toEqual([
      "IndexPreparing",
      "SearchUnavailable",
    ]);
    expect(namedStories(DocumentDraftSwitcherStories)).toEqual(["ActiveDraft"]);
  });

  it("leaves viewport selection to the Storybook toolbar", () => {
    expect(AppShellStories.Default.globals?.viewport).toBeUndefined();
    expect(AppShellStories.ReauthenticationRequired.globals?.viewport).toBeUndefined();
  });

  it("starts the StatusBadge review from the neutral tone", () => {
    expect(StatusBadgeStories.Default.args).toMatchObject({ tone: "neutral" });
  });
});
