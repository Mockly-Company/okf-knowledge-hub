import { describe, expect, it } from "vitest";
import {
  buildCascadingSubIssuesFromIssue,
  buildDocumentBacklogDrafts,
  buildEpicStarterDrafts,
} from "./backlogDerivation";

const writableRepos = [
  {
    key: "docs",
    label: "문서 저장소 (Acme-Org/acme-docs)",
    fullName: "Acme-Org/acme-docs",
    role: "docs" as const,
  },
  {
    key: "web",
    label: "웹 앱 (Acme-Org/acme-web)",
    fullName: "Acme-Org/acme-web",
    role: "code" as const,
  },
];

describe("backlogDerivation", () => {
  it("creates an Epic + [기획] PRD + [디자인] 화면명세서 set (and optional developer handoff backlogs) targeting docs vs code repos properly", () => {
    const upperOnly = buildEpicStarterDrafts({
      epicTitle: "결제 환불 자동화",
      epicBody: "환불 승인부터 정산까지 자동화합니다.",
      documentPath: "docs/product/refund-prd.md",
      screenSpecPath: "docs/product/refund-screen-spec.md",
      repositories: writableRepos,
    });

    expect(upperOnly).toHaveLength(3);
    expect(upperOnly[0]).toMatchObject({
      title: "[Epic] 결제 환불 자동화",
      repositoryFullName: "Acme-Org/acme-docs",
      layer: "planning",
      kind: "기능",
    });
    expect(upperOnly[1]).toMatchObject({
      title: "[기획] 결제 환불 자동화 PRD·상세 기획서 작성",
      repositoryFullName: "Acme-Org/acme-docs",
      layer: "planning",
      parentBatchIndex: 0,
    });
    expect(upperOnly[2]).toMatchObject({
      title: "[디자인] 결제 환불 자동화 화면명세서·인터랙션 설계 문서 작성",
      repositoryFullName: "Acme-Org/acme-docs",
      layer: "design",
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    });
    expect(upperOnly[0].body).toContain("`docs/product/refund-prd.md`");
    expect(upperOnly[0].body).toContain("`docs/product/refund-screen-spec.md`");

    const fullRoleSet = buildEpicStarterDrafts({
      epicTitle: "결제 환불 자동화",
      includeDeveloperBacklog: true,
      repositories: writableRepos,
    });
    expect(fullRoleSet).toHaveLength(5);
    expect(fullRoleSet[3]).toMatchObject({
      layer: "backend",
      repositoryFullName: "Acme-Org/acme-web",
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    });
    expect(fullRoleSet[4]).toMatchObject({
      layer: "frontend",
      repositoryFullName: "Acme-Org/acme-web",
      parentBatchIndex: 0,
      dependsOnBatchIndex: 2,
    });
  });

  it("derives developer handoff [백엔드] -> [프론트엔드] sub-issues from [기획] and [프론트엔드] from [디자인]", () => {
    const fromPlanning = buildCascadingSubIssuesFromIssue({
      sourceIssueNumber: 42,
      sourceTitle: "[기획] 주문 취소 정책 수립",
      sourceLayer: "planning",
      sourceRepositoryFullName: "Acme-Org/acme-docs",
      priority: "P1",
      documentPath: "docs/product/cancel.md",
      repositories: writableRepos,
    });

    expect(fromPlanning).toHaveLength(2);
    expect(fromPlanning[0]).toMatchObject({
      title: "[백엔드] 주문 취소 정책 수립 도메인·API 구현",
      repositoryFullName: "Acme-Org/acme-web",
      layer: "backend",
      priority: "P1",
      parentIssueNumber: 42,
      dependsOn: 42,
    });
    expect(fromPlanning[1]).toMatchObject({
      title: "[프론트엔드] 주문 취소 정책 수립 UI·상태 연동 구현",
      repositoryFullName: "Acme-Org/acme-web",
      layer: "frontend",
      priority: "P1",
      parentIssueNumber: 42,
      dependsOnBatchIndex: 0,
    });

    const fromDesign = buildCascadingSubIssuesFromIssue({
      sourceIssueNumber: 55,
      sourceTitle: "[디자인] 취소 확인 모달 화면명세서",
      sourceLayer: "design",
      sourceRepositoryFullName: "Acme-Org/acme-docs",
      priority: "P2",
      repositories: writableRepos,
    });

    expect(fromDesign).toHaveLength(1);
    expect(fromDesign[0]).toMatchObject({
      title: "[프론트엔드] 취소 확인 모달 화면명세서 화면·컴포넌트 구현",
      repositoryFullName: "Acme-Org/acme-web",
      layer: "frontend",
      priority: "P2",
      parentIssueNumber: 55,
      dependsOn: 55,
    });
  });

  it("derives developer handoff backlog from an approved .md spec with mutual document links", () => {
    const drafts = buildDocumentBacklogDrafts({
      documentTitle: "팀 알림 설정 기획서",
      documentPath: "docs/product/notifications.md",
      markdown:
        "# 팀 알림 설정 기획서\n\n## 요약\n슬랙·웹훅 알림 채널을 설정합니다.\n",
      mode: "implementation",
      repositories: writableRepos,
    });

    expect(drafts).toHaveLength(3);
    expect(drafts[0].title).toBe("[Epic] 팀 알림 설정 기획서");
    expect(drafts[1].layer).toBe("backend");
    expect(drafts[1].parentBatchIndex).toBe(0);
    expect(drafts[2].layer).toBe("frontend");
    expect(drafts[2].parentBatchIndex).toBe(0);
    expect(drafts[2].dependsOnBatchIndex).toBe(1);
    expect(drafts[1].body).toContain("`docs/product/notifications.md`");
  });
});
