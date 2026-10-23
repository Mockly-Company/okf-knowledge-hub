import type { HomeTaskState } from "./HomeTasks";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Clock3, ListTodo, GitMerge, ArrowUpRight, ChevronRight, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TaskTime } from "./TaskTime";
import { useInsightPanelWidth } from "./useInsightPanelWidth";
import "./home-insights.css";
type Reference = { id: string; title: string; repository: string; number: number; url: string };
export type ProjectAnalysisSource = { projectName: string; asOf: string; complete: boolean; pendingReviews: (Reference & { requestedAt: string })[]; inProgressIssues: (Reference & { updatedAt: string })[]; completed: (Reference & { kind: "pr" | "issue"; completedAt: string })[] };
type Evidence = Reference & { kind: "pr" | "issue"; timestamp: string };
type Group = { id: string; title: string; basis: string; items: Evidence[] };
export type HomeInsightData = { status: HomeTaskState; projectName?: string; asOf?: string; incomplete?: boolean; groups: Group[] };
/** Read-only derived results. Callers supply complete project-scoped GitHub snapshots;
 * inProgressIssues must use explicitly mapped Project status IDs, not name heuristics. */
export function analyzeHomeProject(source: ProjectAnalysisSource): HomeInsightData {
  const now = Date.parse(source.asOf);
  const valid = Number.isFinite(now) && [...source.pendingReviews.map(item => item.requestedAt), ...source.inProgressIssues.map(item => item.updatedAt), ...source.completed.map(item => item.completedAt)].every(value => Number.isFinite(Date.parse(value)));
  if (!source.complete || !valid) return { status: "unavailable", incomplete: true, groups: [] };
  const day = 86_400_000;
  const sort = (items: Evidence[], newest = false) => items.sort((a, b) => (Date.parse(a.timestamp) - Date.parse(b.timestamp)) * (newest ? -1 : 1) || a.id.localeCompare(b.id));
  return { status: "ready", projectName: source.projectName, asOf: source.asOf, groups: [
    { id: "waiting", title: "3일 이상 기다리는 리뷰", basis: "열린 PR에 현재 남아 있는 리뷰 요청 중, 마지막 리뷰 요청 시각부터 기준 시각까지 72시간 이상 지난 항목입니다. PR 업데이트 시각으로 요청 시각을 추정하지 않습니다.", items: sort(source.pendingReviews.filter(item => now - Date.parse(item.requestedAt) >= 3 * day).map(item => ({ ...item, kind: "pr", timestamp: item.requestedAt }))) },
    { id: "inactive", title: "7일 이상 업데이트 없는 작업", basis: "진행 중으로 명시적으로 연결한 Project 상태에 속한 열린 Issue 중, GitHub 업데이트 시각부터 168시간 이상 지난 항목입니다. 업데이트가 없다는 사실이며 차단되거나 지연됐다는 판정은 아닙니다.", items: sort(source.inProgressIssues.filter(item => now - Date.parse(item.updatedAt) >= 7 * day).map(item => ({ ...item, kind: "issue", timestamp: item.updatedAt }))) },
    { id: "completed", title: "최근 7일 병합·종료", basis: "기준 시각 직전 168시간 안에 병합된 PR과 종료된 Issue입니다. PR 병합과 Issue 종료를 서로 다른 항목으로 표시하며, 고유한 업무 완료 수로 해석하지 않습니다. 취소로 종료된 Issue도 포함될 수 있습니다.", items: sort(source.completed.filter(item => { const age = now - Date.parse(item.completedAt); return age >= 0 && age <= 7 * day; }).map(item => ({ ...item, timestamp: item.completedAt })), true) },
  ] };
}

const icons = [Clock3, ListTodo, GitMerge];
export function HomeInsights({ data = { status: "unavailable", groups: [] }, panelHost, workspace, onPanelWidth }: { data?: HomeInsightData; panelHost?: HTMLElement | null; workspace?: RefObject<HTMLElement | null>; onPanelWidth?: (width: number | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const { narrow, width, handle } = useInsightPanelWidth(workspace);
  const available = data.status === "ready" || data.status === "stale";
  const group = available ? data.groups.find(item => item.id === selected) : undefined;
  const close = () => { setSelected(null); opener.current?.focus({ preventScroll: true }); };
  useEffect(() => { onPanelWidth?.(group && !narrow ? width : null); }, [group, narrow, width, onPanelWidth]);
  useEffect(() => () => onPanelWidth?.(null), [onPanelWidth]);
  useEffect(() => {
    if (!group || narrow) return;
    closeButton.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { setSelected(null); opener.current?.focus({ preventScroll: true }); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [group?.id, narrow, panelHost]);
  const content = group && <>
    <header className="home-insights__panel-header"><div>{narrow ? <DialogTitle>{group.title}</DialogTitle> : <h2>{group.title}</h2>}<span>{group.items.length}건</span></div><IconButton ref={closeButton} label="분석 패널 닫기" tooltip={false} onClick={close}><X aria-hidden="true" /></IconButton></header>
    <div className="home-insights__panel-scroll">
      {data.status === "stale" && <p className="home-insights__notice" role="status">저장된 결과입니다.{data.asOf && <> · <TaskTime value={data.asOf} format="absolute" /></>}</p>}
      {group.items.length === 0 ? <p className="home-insights__scope">해당 항목이 없습니다.</p> : <ul className="home-insights__evidence">{group.items.map(item => <li key={`${item.kind}:${item.id}`}><a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong><ArrowUpRight size={16} aria-hidden="true" /><span>{item.repository} · {item.kind === "pr" ? "PR" : "Issue"} #{item.number}</span><span>{group.id === "waiting" ? "요청" : group.id === "inactive" ? "업데이트" : item.kind === "pr" ? "병합" : "종료"} <TaskTime value={item.timestamp} /></span><span className="sr-only">GitHub에서 새 탭으로 열기</span></a></li>)}</ul>}
    </div>
  </>;
  const desktopPanel = group && !narrow ? <aside className="home-insights__panel" aria-label={group.title} style={{ width }}>{handle}{content}</aside> : null;
  return <><section className="home-insights" aria-label="프로젝트 요약" aria-busy={data.status === "loading"}>
    <header className="home-insights__header"><div><h2>프로젝트 요약</h2>{data.projectName && <span>{data.projectName}</span>}</div></header>
    {data.status === "stale" && <p className="home-insights__notice" role="status">최신 상태를 확인하지 못했습니다. 저장된 분석입니다.{data.asOf && <> · <TaskTime value={data.asOf} format="absolute" /></>}</p>}
    {available ? <div className="home-insights__grid">{data.groups.map((item, index) => {
      const Icon = icons[index] ?? ListTodo;
      const tone = item.items.length === 0 ? "neutral" : item.id === "waiting" ? "warning" : item.id === "inactive" ? "primary" : "neutral";
      return <Button variant="ghost" key={item.id} className="home-insights__card" data-tone={tone} aria-expanded={group?.id === item.id} onClick={event => { opener.current = event.currentTarget; setSelected(item.id); }}><Icon size={18} aria-hidden="true" /><span>{item.title}</span><strong>{item.items.length}<small>건</small></strong><ChevronRight className="home-insights__detail" size={16} aria-hidden="true" /></Button>;
    })}</div> : <p className="home-insights__empty" role={data.status === "error" ? "alert" : data.status === "loading" ? "status" : undefined}>{data.incomplete ? "분석에 필요한 전체 항목을 확인하지 못했습니다." : data.status === "loading" ? "GitHub 항목을 분석 중입니다." : data.status === "error" ? "분석 결과를 불러오지 못했습니다." : "GitHub 분석이 아직 연결되지 않았습니다."}</p>}
  </section>
    {panelHost ? createPortal(desktopPanel, panelHost) : desktopPanel}
    <Dialog open={!!group && narrow} onOpenChange={open => { if (!open) close(); }}><DialogContent className="home-insights__drawer" aria-label={group?.title ?? "분석 항목"} aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus({ preventScroll: true }); }}>{content}</DialogContent></Dialog>
  </>;
}
