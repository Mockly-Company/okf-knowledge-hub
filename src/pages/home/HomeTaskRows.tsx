import { GitPullRequest, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReviewTask, IssueTask } from "./HomeTasks";
import { TaskTime } from "./TaskTime";

export function ReviewTaskRow({ review, onOpen }: { review: ReviewTask; onOpen?: (id: string) => void }) {
  const hasRequestTime = Number.isFinite(Date.parse(review.requestedAt ?? ""));
  return <li>
    <Tooltip followCursor content={<span className="home-task-title-tooltip">{review.title}</span>}>
    <Button variant="ghost" className="home-task-row" disabled={!onOpen} onClick={() => onOpen?.(review.id)}>
      <GitPullRequest className="home-task-row__icon" aria-hidden="true" size={20} />
      <span className="home-task-row__body">
        <strong>{review.title}</strong>
        <span className="home-task-row__source home-task-row__metadata"><span title={review.repository}>{review.repository}</span><span className="home-task-row__reference">PR #{review.number}</span></span>
      </span>
      <span className="home-task-row__aside home-task-row__metadata"><span className="home-task-row__extra">요청자 {review.requester}</span><span className="home-task-row__date">{hasRequestTime ? <TaskTime value={review.requestedAt!} /> : "요청 시각 없음"}</span></span>
    </Button>
    </Tooltip>
  </li>;
}

export function IssueTaskRow({ issue }: { issue: IssueTask }) {
  const deadline = new Date(issue.dueDate ?? "");
  const hasDeadline = Number.isFinite(deadline.getTime());
  return <li>
    <Tooltip followCursor content={<span className="home-task-title-tooltip">{issue.title}</span>}>
    <a className="home-task-row" href={issue.url} target="_blank" rel="noreferrer">
      <CircleDot className="home-task-row__icon" aria-hidden="true" size={20} />
      <span className="home-task-row__body">
        <strong>{issue.title}</strong>
        <span className="home-task-row__source home-task-row__metadata"><span title={issue.repository}>{issue.repository}</span><span className="home-task-row__reference">#{issue.number}</span></span>
      </span>
      <span className="home-task-row__aside home-task-row__metadata">
          <span className="home-task-row__project" data-tone={issue.projectStatus ? issue.projectStatusTone ?? "neutral" : "neutral"} aria-label={issue.projectStatus ? `GitHub Project 상태: ${issue.projectStatus}` : undefined}>{issue.projectStatus ?? "Project 상태 없음"}</span>
          <span className="home-task-row__date">{hasDeadline ? <time dateTime={issue.dueDate!} title={new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeZone: "UTC" }).format(deadline)}>마감 {deadline.getUTCMonth() + 1}.{deadline.getUTCDate()}</time> : "마감일 없음"}</span>
      </span>
      <span className="sr-only">GitHub에서 새 탭으로 열기</span>
    </a>
    </Tooltip>
  </li>;
}
