import { describe, expect, it } from "vitest";
import { createPublicationFlow, createPublicationPreview, publicationFlowReducer, canPublishFlow } from "./document-publication-flow";

const now = Date.UTC(2026, 9, 17);
describe("Storybook document publication flow", () => {
  it("starts another draft from the published baseline without reusing its merged PR", () => {
    const published = createPublicationPreview("published content", "old content", { reviewState: "merged", now });
    const draft = publicationFlowReducer(published, { type: "start_edit" });
    expect(draft.review).toBeNull();
    expect(draft.reviewHistory.map(review => review.number)).toEqual([42]);
    expect(draft.markdown).toBe("published content");
    expect(draft.baseline).toBe("published content");
    expect(canPublishFlow(draft)).toBe(false);
    const revised = publicationFlowReducer(draft, { type: "edit", markdown: "next revision" });
    expect(canPublishFlow(revised)).toBe(true);
    const shared = publicationFlowReducer(revised, { type: "review" });
    expect(shared.review?.number).toBe(43);
    expect(shared.review?.status).toBe("pending");
    expect(shared.review?.reviewedMarkdown).toBeNull();
    expect(shared.baseline).toBe("published content");
  });
  it("keeps an open PR connected when returning to edit", () => {
    const shared = createPublicationPreview("draft", "base", { reviewState: "approved", now });
    expect(publicationFlowReducer(shared, { type: "start_edit" })).toEqual(shared);
  });
  it("can edit and publish again after direct publication", () => {
    const published = publicationFlowReducer(createPublicationFlow("first", "base"), { type: "publish" });
    const draft = publicationFlowReducer(published, { type: "start_edit" });
    expect(draft.baseline).toBe("first");
    expect(draft.published).toBe(false);
    const revised = publicationFlowReducer(draft, { type: "edit", markdown: "second" });
    expect(publicationFlowReducer(revised, { type: "publish" }).baseline).toBe("second");
  });
  it("keeps review state and unshared edits independent in controlled previews", () => {
    const state = createPublicationPreview("draft", "base", { reviewState: "approved", unpublishedChanges: true, now });
    expect(state.review?.status).toBe("approved");
    expect(state.review?.sharedMarkdown).toBe("draft");
    expect(state.markdown).not.toBe("draft");
    expect(state.baseline).toBe("base");
  });
  it("starts published and closed previews without fabricating pending review", () => {
    const published = createPublicationPreview("draft", "base", { reviewState: "merged", now });
    expect(published.published).toBe(true);
    expect(published.baseline).toBe("draft");
    const closed = createPublicationPreview("draft", "base", { reviewState: "closed", now });
    expect(closed.review?.status).toBe("closed");
    expect(closed.published).toBe(false);
  });
  it("creates expired recovery previews with no recoverable action", () => {
    const state = createPublicationPreview("draft", "base", { discarded: true, expired: true, now });
    expect(state.discarded).toBe(true);
    expect(state.backup!.expiresAt).toBeLessThanOrEqual(now);
    expect(publicationFlowReducer(state, { type: "restore", now })).toEqual(state);
  });
  it("does not publish when a review is approved", () => {
    const shared = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "review" });
    const approved = publicationFlowReducer(shared, { type: "approve" });
    expect(approved.baseline).toBe("base");
    expect(approved.published).toBe(false);
    expect(canPublishFlow(approved)).toBe(true);
  });
  it("keeps edits local and updates the same PR only on review request", () => {
    const shared = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "review" });
    const edited = publicationFlowReducer(shared, { type: "edit", markdown: "revised" });
    expect(edited.review?.sharedMarkdown).toBe("draft");
    expect(canPublishFlow(edited)).toBe(true);
    const updated = publicationFlowReducer(edited, { type: "review" });
    expect(updated.review?.number).toBe(shared.review?.number);
    expect(updated.review?.sharedMarkdown).toBe("revised");
    expect(updated.review?.status).toBe("pending");
  });
  it("publishes without requiring optional approval", () => {
    const shared = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "review" });
    const published = publicationFlowReducer(shared, { type: "publish" });
    expect(published.baseline).toBe("draft");
    expect(published.published).toBe(true);
  });
  it("does not fabricate remote approval dismissal when the shared content changes", () => {
    const shared = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "review" });
    const approved = publicationFlowReducer(shared, { type: "approve" });
    const updated = publicationFlowReducer(publicationFlowReducer(approved, { type: "edit", markdown: "new" }), { type: "review" });
    expect(updated.review?.status).toBe("approved");
    expect(updated.review?.reviewedMarkdown).toBe("draft");
    expect(updated.review?.sharedMarkdown).toBe("new");
  });
  it("preserves a request for changes when a revision is shared", () => {
    const requested = createPublicationPreview("draft", "base", { reviewState: "changes_requested", now });
    const edited = publicationFlowReducer(requested, { type: "edit", markdown: "revision" });
    expect(publicationFlowReducer(edited, { type: "review" }).review?.status).toBe("changes_requested");
  });
  it("checks publication constraints independently of the review label", () => {
    const approved = createPublicationPreview("draft", "base", { reviewState: "approved", now });
    for (const blocker of ["review", "checks_pending", "checks", "conflict", "permission"] as const) {
      expect(canPublishFlow(approved, blocker)).toBe(false);
      expect(publicationFlowReducer(approved, { type: "publish", blocker })).toEqual(approved);
    }
  });
  it("includes local revisions in the current PR before optional-review publication", () => {
    const approved = createPublicationPreview("draft", "base", { reviewState: "approved", unpublishedChanges: true, now });
    const published = publicationFlowReducer(approved, { type: "publish" });
    expect(published.baseline).toBe(approved.markdown);
    expect(published.review?.number).toBe(42);
    expect(published.review?.sharedMarkdown).toBe(approved.markdown);
    expect(published.review?.status).toBe("merged");
  });
  it("creates a new PR from a closed review without losing the current draft", () => {
    const closed = createPublicationPreview("draft", "base", { reviewState: "closed", now });
    const edited = publicationFlowReducer(closed, { type: "edit", markdown: "revised draft" });
    const shared = publicationFlowReducer(edited, { type: "review" });
    expect(shared.review?.number).toBe(43);
    expect(shared.review?.status).toBe("pending");
    expect(shared.review?.sharedMarkdown).toBe("revised draft");
    expect(shared.review?.reviewedMarkdown).toBeNull();
    expect(shared.reviewHistory).toEqual([closed.review]);
    expect(shared.markdown).toBe("revised draft");
    expect(shared.baseline).toBe("base");
    expect(canPublishFlow(edited)).toBe(false);
  });
  it.each(["merged"] as const)("does not reuse a %s PR for another share or publication", reviewState => {
    const terminal = createPublicationPreview("draft", "base", { reviewState, now });
    const edited = publicationFlowReducer(terminal, { type: "edit", markdown: "another change" });
    expect(publicationFlowReducer(edited, { type: "review" })).toEqual(edited);
    expect(canPublishFlow(edited)).toBe(false);
  });
  it("discards only the local draft and preserves the shared PR", () => {
    const shared = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "review" });
    const discarded = publicationFlowReducer(shared, { type: "discard", now });
    expect(discarded.markdown).toBe("base");
    expect(discarded.review).toEqual(shared.review);
    expect(discarded.backup?.markdown).toBe("draft");
    expect(discarded.backup?.expiresAt).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });
  it("restores a discarded new document without changing the confirmed version", () => {
    const discarded = publicationFlowReducer(createPublicationFlow("new document", ""), { type: "discard", now });
    expect(discarded.markdown).toBe("");
    const restored = publicationFlowReducer(discarded, { type: "restore", now: now + 1000 });
    expect(restored.markdown).toBe("new document");
    expect(restored.baseline).toBe("");
    expect(restored.discarded).toBe(false);
  });
  it("does not restore after the seven-day deadline", () => {
    const discarded = publicationFlowReducer(createPublicationFlow("draft", "base"), { type: "discard", now });
    expect(publicationFlowReducer(discarded, { type: "restore", now: now + 7 * 24 * 60 * 60 * 1000 })).toEqual(discarded);
  });
});
