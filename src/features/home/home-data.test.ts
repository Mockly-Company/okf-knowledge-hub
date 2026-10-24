import { describe, expect, it } from "vitest";
import { toHomeData, safeGithubUrl } from "./home-data";
import type { HomeSnapshot } from "./HomeGateway";
const base: HomeSnapshot = { scopeKey: "account:workspace", asOfUnixMs: Date.parse("2026-10-24T12:00:00Z"), reviews: [], issues: [], tasksError: false, analysis: null, analysisError: false, configuration: { project: null, preferences: null } };
describe("actual Home data projection", () => {
  it("distinguishes a confirmed empty response from incomplete data", () => {
    expect(toHomeData(base).tasks.status).toBe("empty");
    expect(toHomeData({ ...base, tasksError: true }).tasks.status).toBe("error");
    expect(toHomeData(base).insights.status).toBe("unavailable");
    expect(toHomeData({ ...base, analysisError: true }).insights.status).toBe("error");
  });
  it("uses the approved exact 72/168 hour boundaries and source timestamps", () => {
    const reference = { id: "1", title: "실제 PR", repository: "team/docs", number: 1, url: "https://github.com/team/docs/pull/1" };
    const result = toHomeData({ ...base, analysis: { projectName: "Hub", complete: true, pendingReviews: [{...reference, requestedAt: "2026-10-21T12:00:00Z"}], inProgressIssues: [{...reference, updatedAt: "2026-10-17T12:00:00Z"}], completed: [{...reference, kind: "pr", completedAt: "2026-10-24T11:00:00Z"}] } });
    expect(result.insights.groups.map(group => group.items.length)).toEqual([1, 1, 1]);
  });
  it("never hides missing request timestamps by using updatedAt", () => {
    const reference = { id: "1", title: "PR", repository: "team/docs", number: 1, url: "https://github.com/team/docs/pull/1", updatedAt: "2026-10-24T12:00:00Z", requester: "someone", requestedAt: null };
    expect(toHomeData({ ...base, reviews: [reference] }).tasks.reviews[0].requestedAt).toBeNull();
  });
  it.each(["javascript:alert(1)", "https://github.com.evil.test/a", "https://evil.test/a", "https://user:secret@github.com/a"])("rejects unsafe external URL %s", url => expect(safeGithubUrl(url)).toBe(false));
});
