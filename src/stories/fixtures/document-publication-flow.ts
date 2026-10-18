/** In-memory Storybook model. Never calls the app gateway or GitHub. */
export type PublicationReviewState = "none" | "pending" | "changes_requested" | "approved" | "merged" | "closed";
export type PublicationBlocker = "none" | "review" | "checks_pending" | "checks" | "conflict" | "permission";
export interface PublicationFlow {
  markdown: string;
  baseline: string;
  published: boolean;
  discarded: boolean;
  review: { number: number; status: Exclude<PublicationReviewState, "none">; sharedMarkdown: string; reviewedMarkdown: string | null } | null;
  reviewHistory: NonNullable<PublicationFlow["review"]>[];
  backup: { markdown: string; expiresAt: number } | null;
}
export type PublicationFlowAction =
  | { type: "edit"; markdown: string }
  | { type: "review" | "approve" | "start_edit" }
  | { type: "publish"; blocker?: PublicationBlocker }
  | { type: "discard" | "restore"; now: number };

export function createPublicationFlow(markdown: string, baseline: string): PublicationFlow {
  return { markdown, baseline, published: false, discarded: false, review: null, reviewHistory: [], backup: null };
}

export function nextPublicationReviewNumber(state: PublicationFlow) {
  return Math.max(41, state.review?.number ?? 41, ...state.reviewHistory.map(review => review.number)) + 1;
}

export function createPublicationPreview(markdown: string, baseline: string, options: { reviewState?: PublicationReviewState; unpublishedChanges?: boolean; discarded?: boolean; expired?: boolean; now: number }): PublicationFlow {
  let state = createPublicationFlow(markdown, baseline);
  const reviewState = options.reviewState ?? "none";
  if (reviewState !== "none") state.review = { number: 42, status: reviewState, sharedMarkdown: markdown, reviewedMarkdown: reviewState === "approved" || reviewState === "changes_requested" ? markdown : null };
  if (reviewState === "merged") state = { ...state, baseline: markdown, published: true };
  if (options.unpublishedChanges && reviewState !== "merged" && reviewState !== "closed") state.markdown = `${markdown}\n\n추가로 작성한 내용입니다.`;
  if (options.discarded) state = publicationFlowReducer(state, { type: "discard", now: options.expired ? options.now - 8 * 86400000 : options.now });
  return state;
}

export function canPublishFlow(state: PublicationFlow, blocker: PublicationBlocker = "none") {
  return blocker === "none" && !state.discarded && state.markdown !== state.baseline && state.review?.status !== "merged" && state.review?.status !== "closed";
}

export function publicationFlowReducer(state: PublicationFlow, action: PublicationFlowAction): PublicationFlow {
  switch (action.type) {
    case "start_edit": return state.published ? { ...state, markdown: state.baseline, published: false, review: null, reviewHistory: state.review ? [...state.reviewHistory, state.review] : state.reviewHistory } : state;
    case "edit": return { ...state, markdown: action.markdown, published: false };
    case "review": {
      if (state.discarded || state.review?.status === "merged") return state;
      const closed = state.review?.status === "closed";
      return { ...state,
        reviewHistory: closed && state.review ? [...state.reviewHistory, state.review] : state.reviewHistory,
        review: state.review && !closed ? { ...state.review, sharedMarkdown: state.markdown } : { number: nextPublicationReviewNumber(state), status: "pending", sharedMarkdown: state.markdown, reviewedMarkdown: null },
      };
    }
    case "approve": return state.review && state.review.status !== "closed" && state.review.status !== "merged" ? { ...state, review: { ...state.review, status: "approved", reviewedMarkdown: state.review.sharedMarkdown } } : state;
    case "publish": return canPublishFlow(state, action.blocker) ? { ...state, baseline: state.markdown, published: true, review: state.review ? { ...state.review, sharedMarkdown: state.markdown, status: "merged" } : null } : state;
    case "discard": return { ...state, backup: { markdown: state.markdown, expiresAt: action.now + 7 * 24 * 60 * 60 * 1000 }, markdown: state.baseline, discarded: true, published: false };
    case "restore": return state.discarded && state.backup && action.now < state.backup.expiresAt ? { ...state, markdown: state.backup.markdown, discarded: false, backup: null } : state;
  }
}
