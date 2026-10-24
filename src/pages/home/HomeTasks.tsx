import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { HomeTaskPanel } from "./HomeTaskPanel";
import { ReviewTaskRow, IssueTaskRow } from "./HomeTaskRows";
import "./home-tasks.css";

export type HomeTaskState = "ready" | "empty" | "loading" | "error" | "stale" | "unavailable";
export type ReviewTask = { url?: string; id: string; title: string; repository: string; number: number; requester: string; requestedAt?: string | null; updatedAt: string };
export type ProjectStatusTone = "neutral" | "info" | "warning" | "primary";
export type IssueTask = { id: string; title: string; repository: string; number: number; url: string; projectStatus?: string; projectStatusTone?: ProjectStatusTone; dueDate?: string | null; updatedAt: string };
export type HomeTaskData = { status: HomeTaskState; updatedAt?: string; reviews: ReviewTask[]; issues: IssueTask[] };
export const unavailableHomeTasks: HomeTaskData = { status: "unavailable", reviews: [], issues: [] };

function earliestFirst<T extends { repository: string; number: number; id: string }>(items: T[], date: (item: T) => string | null | undefined): T[] {
  const timestamp = (item: T) => { const value = Date.parse(date(item) ?? ""); return Number.isFinite(value) ? value : Infinity; };
  return [...items].sort((a, b) => timestamp(a) - timestamp(b) || (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : 0) || a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}


export function HomeTasks({ data, onOpenReview, onOpenDocuments, children }: { data: HomeTaskData; onOpenReview?: (id: string) => void; onOpenDocuments?: () => void; children?: ReactNode }) {
  return <div className="home-tasks" aria-label="내 작업">
    <HomeTaskPanel key={`reviews:${JSON.stringify([data.status, data.updatedAt, data.reviews])}`} title="나에게 요청된 리뷰" count={data.reviews.length} data={data} empty="요청된 리뷰가 없습니다.">
      {earliestFirst(data.reviews, review => review.requestedAt).map(review => <ReviewTaskRow key={review.id} review={review} onOpen={onOpenReview} />)}
    </HomeTaskPanel>
    <HomeTaskPanel key={`issues:${JSON.stringify([data.status, data.updatedAt, data.issues])}`} title="내 담당 Issue" count={data.issues.length} data={data} empty="담당한 열린 Issue가 없습니다.">
      {earliestFirst(data.issues, issue => issue.dueDate).map(issue => <IssueTaskRow key={issue.id} issue={issue} />)}
    </HomeTaskPanel>
    {children}
    {onOpenDocuments && (data.status === "empty" || (data.status === "ready" && data.reviews.length === 0 && data.issues.length === 0)) && <div className="home-task-next"><p>지금 확인할 작업이 없어요. 문서를 둘러보거나 새 문서를 작성해 보세요.</p><Button variant="secondary" onClick={onOpenDocuments}>문서 둘러보기</Button></div>}
  </div>;
}
