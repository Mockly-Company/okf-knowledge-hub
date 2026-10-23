import { Activity, GitPullRequest, GitMerge, CircleDot, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { TaskTime } from "./TaskTime";

export type ActivityItem = { id: string; actor: string; action: "review_requested" | "approved" | "merged" | "issue_opened" | "issue_closed"; title: string; repository: string; number: number; occurredAt: string; url: string; reviewId?: string };
export type HomeActivityData = { status: import("./HomeTasks").HomeTaskState; updatedAt?: string; items: ActivityItem[] };
export const unavailableHomeActivity: HomeActivityData = { status: "unavailable", items: [] };
const events = {
  review_requested: { label: "검토 요청", Icon: GitPullRequest },
  approved: { label: "리뷰 승인", Icon: CircleCheck },
  merged: { label: "PR 병합", Icon: GitMerge },
  issue_opened: { label: "Issue 생성", Icon: CircleDot },
  issue_closed: { label: "Issue 종료", Icon: CircleCheck },
};

export function HomeActivity({ data, onOpenReview }: { data: HomeActivityData; onOpenReview?: (id: string) => void }) {
  const available = data.status === "ready" || data.status === "stale" || data.status === "empty";
  const items = data.status === "empty" ? [] : [...data.items].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id)).slice(0, 5);
  return <section className="home-task-panel home-activity-panel" aria-label="최근 활동" aria-busy={data.status === "loading"}>
    <header className="home-task-panel__header"><div><h2>최근 활동</h2></div></header>
    {data.status === "stale" && <div className="home-task-panel__notice" role="status">최신 상태를 확인하지 못했습니다. 저장된 활동입니다.{data.updatedAt && <span>마지막 동기화 · <TaskTime value={data.updatedAt} format="absolute" /></span>}</div>}
    {!available ? <div className="home-task-panel__empty" role={data.status === "error" ? "alert" : data.status === "loading" ? "status" : undefined}><Activity aria-hidden="true" size={22} /><strong>{data.status === "loading" ? "최근 활동을 불러오는 중입니다." : data.status === "error" ? "최근 활동을 불러오지 못했습니다." : "활동 목록이 아직 연결되지 않았습니다."}</strong><p>{data.status === "error" ? "연결 상태와 저장소 접근 권한을 확인해 주세요." : "GitHub에 공유된 활동을 표시합니다."}</p></div> : items.length === 0 ? <div className="home-task-panel__empty"><Activity aria-hidden="true" size={22} /><strong>최근 활동이 없습니다.</strong><p>{data.status === "stale" ? "마지막으로 저장된 활동 기준입니다." : "GitHub에서 확인한 내역입니다."}</p></div> : <ul className="home-task-panel__list">{items.map(item => {
      const { Icon, label } = events[item.action];
      const kind = item.action.startsWith("issue_") ? "Issue" : "PR";
      const body = <>
        <Icon className="home-task-row__icon" aria-hidden="true" size={18} />
        <span className="home-task-row__body">
          <strong>{item.title}</strong>
          <span className="home-task-row__source home-task-row__metadata"><span title={item.repository}>{item.repository}</span><span className="home-task-row__reference">{kind} #{item.number}</span></span>
        </span>
        <span className="home-task-row__aside home-task-row__metadata">
          <span className="home-activity-row__event"><span className="home-activity-row__actor">{item.actor} · </span>{label}</span>
          <TaskTime value={item.occurredAt} />
        </span>
      </>;
      return <li key={item.id}><Tooltip content={<span className="home-task-title-tooltip">{item.title}</span>}>{item.reviewId && onOpenReview ? <Button variant="ghost" className="home-task-row home-activity-row" onClick={() => onOpenReview(item.reviewId!)}>{body}</Button> : <a className="home-task-row home-activity-row" href={item.url} target="_blank" rel="noreferrer">{body}<span className="sr-only">GitHub에서 새 탭으로 열기</span></a>}</Tooltip></li>;
    })}</ul>}
  </section>;
}
