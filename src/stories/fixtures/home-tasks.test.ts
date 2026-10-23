import { describe, expect, it } from "vitest";
import { homeInsightExample, homeTaskExample } from "./home-tasks";

describe("shared home example snapshot", () => {
  it("uses the same PR identity, title and request time in lists and derived summary", () => {
    const tasks = homeTaskExample("ready", "many");
    const waiting = homeInsightExample().groups.find(group => group.id === "waiting")!;
    for (const evidence of waiting.items) {
      const review = tasks.reviews.find(item => item.repository === evidence.repository && item.number === evidence.number)!;
      expect(review).toBeDefined();
      expect(evidence).toMatchObject({ id: review.id, title: review.title, timestamp: review.requestedAt });
      expect(evidence.url).toBe(`https://github.com/${review.repository}/pull/${review.number}`);
    }
    expect(waiting.items.length).toBe(tasks.reviews.filter(item => Date.parse("2026-10-22T15:00:00Z") - Date.parse(item.requestedAt!) >= 72 * 3_600_000).length);
    for (const review of tasks.reviews) expect(Date.parse(review.updatedAt)).toBeGreaterThanOrEqual(Date.parse(review.requestedAt!));
  });

  it("only includes explicitly in-progress Issues, sharing their title and update time", () => {
    const tasks = homeTaskExample("ready", "many");
    const inactive = homeInsightExample().groups.find(group => group.id === "inactive")!;
    for (const evidence of inactive.items) {
      const issue = tasks.issues.find(item => item.repository === evidence.repository && item.number === evidence.number)!;
      expect(issue).toBeDefined();
      expect(issue.projectStatus).toBe("In progress");
      expect(evidence).toMatchObject({ id: issue.id, title: issue.title, url: issue.url, timestamp: issue.updatedAt });
    }
    expect(inactive.items.length).toBeGreaterThan(0);
    expect(inactive.items.some(item => item.number === 31)).toBe(false);
  });

  it("uses subsets of the same snapshot for short lists without leaking mutations", () => {
    const few = homeTaskExample();
    const many = homeTaskExample("ready", "many");
    expect(few.reviews).toEqual(many.reviews.slice(0, 1));
    expect(few.issues).toEqual(many.issues.slice(0, 2));
    few.reviews[0].title = "changed";
    expect(homeTaskExample().reviews[0].title).not.toBe("changed");
    expect(homeInsightExample("empty").groups.every(group => group.items.length === 0)).toBe(true);
  });
});
