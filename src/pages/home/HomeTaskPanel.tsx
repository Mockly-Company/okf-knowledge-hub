import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HomeTaskData } from "./HomeTasks";
import { TaskTime } from "./TaskTime";

export function HomeTaskPanel({ title, count, data, empty, children }: { title: string; count: number; data: HomeTaskData; empty: string; children: ReactNode }) {
  const [page, setPage] = useState(0);
  const pagination = useRef<HTMLElement>(null);
  const movePage = (next: number) => { setPage(next); pagination.current?.focus({ preventScroll: true }); };
  const available = data.status === "ready" || data.status === "stale" || data.status === "empty";
  const visibleCount = data.status === "empty" ? 0 : count;
  const totalPages = Math.ceil(visibleCount / 5);
  const pageIndex = Math.min(page, Math.max(0, totalPages - 1));
  const rows = Children.toArray(children).slice(pageIndex * 5, pageIndex * 5 + 5);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || totalPages < 2 || !available) return;
    let width = 0;
    let height = 0;
    const reserveHeight = () => {
      const nextWidth = element.getBoundingClientRect().width;
      if (width !== nextWidth) {
        element.style.minHeight = "";
        height = 0;
        width = nextWidth;
      }
      height = Math.max(height, element.getBoundingClientRect().height);
      element.style.minHeight = `${height}px`;
    };
    reserveHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reserveHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [totalPages, available]);
  return <section className="home-task-panel" aria-label={title} aria-busy={data.status === "loading"}>
    <header className="home-task-panel__header">
      <div><h2>{title}</h2></div>
      {available && <span className="home-task-panel__count">{data.status === "stale" ? `저장된 항목 ${visibleCount}개` : `${visibleCount}개`}</span>}
    </header>
    {data.status === "stale" && <div className="home-task-panel__notice" role="status">최신 상태를 확인하지 못했습니다. 저장된 목록입니다.{data.updatedAt && <span>마지막 동기화 · <TaskTime value={data.updatedAt} format="absolute" /></span>}</div>}
    {!available ? <div className="home-task-panel__empty" role={data.status === "error" ? "alert" : data.status === "loading" ? "status" : undefined}>
      <Inbox aria-hidden="true" size={22} />
      <strong>{data.status === "loading" ? "GitHub에서 불러오는 중입니다." : data.status === "error" ? "목록을 불러오지 못했습니다." : "GitHub 목록이 아직 연결되지 않았습니다."}</strong>
      <p>{data.status === "error" ? "연결 상태와 저장소 접근 권한을 확인해 주세요." : data.status === "loading" ? "요청된 리뷰와 담당 항목을 확인하고 있습니다." : "연결 후 내 GitHub 계정 기준으로 표시합니다."}</p>
    </div> : visibleCount === 0 ? <div className="home-task-panel__empty"><Inbox aria-hidden="true" size={22} /><strong>{empty}</strong><p>{data.status === "stale" ? "마지막으로 저장된 목록 기준입니다." : "GitHub에서 확인한 내역입니다."}</p></div> : <>
      <ul ref={list} className="home-task-panel__list">{rows}</ul>
      {totalPages > 1 && <nav ref={pagination} tabIndex={-1} className="home-task-panel__pagination" aria-label={`${title} 페이지`}>
        <span aria-live="polite" aria-atomic="true">{pageIndex * 5 + 1}–{Math.min(pageIndex * 5 + 5, visibleCount)} / {visibleCount}개</span>
        <div><Button variant="ghost" aria-label="이전 페이지" disabled={pageIndex === 0} onClick={() => movePage(pageIndex - 1)}><ChevronLeft aria-hidden="true" size={16} />이전</Button><Button variant="ghost" aria-label="다음 페이지" disabled={pageIndex >= totalPages - 1} onClick={() => movePage(pageIndex + 1)}>다음<ChevronRight aria-hidden="true" size={16} /></Button></div>
      </nav>}
    </>}
  </section>;
}
