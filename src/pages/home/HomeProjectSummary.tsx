import type { HomeTaskState } from "./HomeTasks";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TaskTime } from "./TaskTime";

export type HomeProjectData = {
  status: HomeTaskState;
  updatedAt?: string;
  project?: { name: string; statuses: { id: string; name: string; count: number }[] };
};

export function HomeProjectSummary({ data = { status: "unavailable" }, onOpen }: { data?: HomeProjectData; onOpen?: () => void }) {
  const available = data.status === "ready" || data.status === "stale";
  const project = available ? data.project : undefined;
  const message = data.status === "loading" ? "프로젝트 현황을 불러오는 중입니다." : data.status === "error" ? "프로젝트 현황을 불러오지 못했습니다." : data.status === "empty" || available ? "선택된 대표 프로젝트가 없습니다." : "대표 프로젝트가 아직 연결되지 않았습니다.";
  return <section className="home-project-summary" aria-label="프로젝트 현황" aria-busy={data.status === "loading"}>
    <div className="home-project-summary__main">
      <h2>{project?.name ?? "프로젝트 현황"}</h2>
      {project ? <dl className="home-project-summary__counts" aria-label="프로젝트 전체 상태별 항목 수">{project.statuses.map(status => <div key={status.id}><dt>{status.name}</dt><dd>{status.count}</dd></div>)}</dl> : <p role={data.status === "error" ? "alert" : data.status === "loading" ? "status" : undefined}>{message}</p>}
    </div>
    {onOpen ? <Button variant="ghost" onClick={onOpen}>프로젝트 보기</Button> : <Button asChild variant="ghost"><Link to="/project">프로젝트 보기</Link></Button>}
    {data.status === "stale" && <p className="home-project-summary__notice" role="status">최신 상태를 확인하지 못했습니다. 저장된 현황입니다.{data.updatedAt && <> 마지막 동기화 · <TaskTime value={data.updatedAt} format="absolute" /></>}</p>}
  </section>;
}
