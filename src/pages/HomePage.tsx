import { useNavigate } from "react-router-dom";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { HomeTasks, unavailableHomeTasks, type HomeTaskData } from "./home/HomeTasks";
import { HomeInsights, type HomeInsightData } from "./home/HomeInsights";

export function HomePage({ tasks = unavailableHomeTasks, insights, onOpenReview, onOpenDocuments, actions, notice }: {
  actions?: ReactNode;
  notice?: ReactNode;
  tasks?: HomeTaskData;
  insights?: HomeInsightData;
  onOpenReview?: (id: string) => void;
  onOpenDocuments?: () => void;
}) {
  const { account } = useWorkspaceConnection();
  const navigate = useNavigate();
  const workspace = useRef<HTMLDivElement>(null);
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const accountUser = account.status === "authenticated" || account.status === "logging_out" ? account.user : null;

  return <div ref={workspace} className="home-workspace" style={panelWidth ? { gridTemplateColumns: `minmax(0, 1fr) ${panelWidth}px` } : undefined}><section className="home-page min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]" aria-labelledby="home-title">
    <div>
      <PageHeader titleId="home-title" title="내 작업" actions={actions} description={accountUser ? `안녕하세요, @${accountUser.login}님` : "안녕하세요"} />
      {notice}
      <HomeInsights data={insights} panelHost={panelHost} workspace={workspace} onPanelWidth={setPanelWidth} />
      <div className="home-content"><HomeTasks data={tasks} onOpenReview={onOpenReview} onOpenDocuments={onOpenDocuments ?? (() => navigate("/documents"))} /></div>
    </div>
  </section><div ref={setPanelHost} className="home-workspace__panel" hidden={!panelWidth} /></div>;
}
