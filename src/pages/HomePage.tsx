import {
  Activity,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Inbox,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ComponentType, ReactNode } from "react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { Button } from "@/components/ui/button";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";

const issueSummaries = [
  {
    label: "열린 Issue",
    icon: CircleDot,
    iconClass: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
  },
  {
    label: "진행 중인 Issue",
    icon: CircleDashed,
    iconClass: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  },
  {
    label: "이번 주 완료 Issue",
    icon: CircleCheck,
    iconClass: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  },
] as const;

const requestCategories = [
  "검토 필요",
  "결정 필요",
  "작업 시작 가능",
  "응답 필요",
] as const;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ "aria-hidden"?: boolean; strokeWidth?: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-40 place-items-center px-[var(--space-6)] py-[var(--space-8)] text-center">
      <div className="grid max-w-[420px] justify-items-center gap-[var(--space-2)]">
        <span className="grid size-10 place-items-center rounded-[var(--radius-md)] bg-[var(--color-canvas)] text-[var(--color-text-muted)]">
          <Icon aria-hidden={true} strokeWidth={1.75} />
        </span>
        <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
          {title}
        </strong>
        <span className="font-[number:var(--font-weight-description)] text-[var(--color-text-muted)]">
          {description}
        </span>
      </div>
    </div>
  );
}

function DashboardPanel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
      aria-label={title}
    >
      <div className="border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-3)]">
        <SectionHeader title={title} description={description} actions={actions} />
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  const { account } = useWorkspaceConnection();
  const accountUser =
    account.status === "authenticated" || account.status === "logging_out"
      ? account.user
      : null;
  const today = new Date();
  const greeting = accountUser
    ? `안녕하세요, @${accountUser.login}님`
    : "안녕하세요";

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="home-title"
    >
      <div className="mx-auto max-w-[1280px]">
        <PageHeader
          titleId="home-title"
          title="프로젝트 진행 상황"
          description={greeting}
          actions={
            <time
              dateTime={localDateKey(today)}
              className="pt-[var(--space-2)] font-[number:var(--font-weight-description)] text-[var(--color-text-muted)]"
            >
              {new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" }).format(today)}
            </time>
          }
        />

        <section
          className="mt-[var(--space-8)] grid gap-[var(--space-3)] md:grid-cols-3"
          aria-label="Issue 요약"
        >
          {issueSummaries.map(({ label, icon: Icon, iconClass }) => (
            <article
              key={label}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
            >
              <div className="flex items-center justify-between gap-[var(--space-3)]">
                <span className="font-[number:var(--font-weight-control)] text-[var(--color-text-default)]">
                  {label}
                </span>
                <span
                  className={`grid size-8 place-items-center rounded-[var(--radius-md)] ${iconClass}`}
                >
                  <Icon aria-hidden="true" strokeWidth={1.75} />
                </span>
              </div>
              <div className="mt-[var(--space-3)] text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)]">
                —
              </div>
              <p className="m-0 mt-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                Project 데이터 없음
              </p>
            </article>
          ))}
        </section>

        <div className="mt-[var(--space-4)] grid gap-[var(--space-4)] xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
          <DashboardPanel
            title="기능 진행 상황"
            description="연결된 GitHub Issue 완료 수 기준"
            actions={
              <Button asChild variant="ghost">
                <Link to="/project">Project에서 보기</Link>
              </Button>
            }
          >
            <EmptyState
              icon={ChartNoAxesColumnIncreasing}
              title="연결된 기능별 Issue가 아직 없습니다."
              description="Project와 제품 구조가 연결되면 완료 수와 전체 수를 함께 표시합니다."
            />
          </DashboardPanel>

          <DashboardPanel
            title="내가 확인할 항목"
            description="검토, 결정, 작업 시작과 응답 요청"
          >
            <div className="p-[var(--space-4)]">
              <ul className="m-0 grid list-none gap-[var(--space-2)] p-0 sm:grid-cols-2">
                {requestCategories.map((category) => (
                  <li
                    key={category}
                    aria-label={`${category}: 0개`}
                    className="flex min-h-16 items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)]"
                  >
                    <span className="flex min-w-0 items-center gap-[var(--space-2)]">
                      <Inbox
                        className="shrink-0 text-[var(--color-text-muted)]"
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                      <span>
                        <strong className="block font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                          {category}
                        </strong>
                        <span className="block text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                          연결된 항목 없음
                        </span>
                      </span>
                    </span>
                    <span className="font-[number:var(--font-weight-page-title)] text-[var(--color-text-muted)]">
                      0
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-[var(--space-3)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                연결된 확인 항목 없음
              </p>
            </div>
          </DashboardPanel>
        </div>

        <DashboardPanel
          title="최근 활동"
          description="발생 시간을 포함한 워크스페이스 활동"
          className="mt-[var(--space-4)]"
        >
          <EmptyState
            icon={Activity}
            title="표시할 활동 기록이 아직 없습니다."
            description="Issue, Pull Request와 문서 활동이 연결되면 시간순으로 표시합니다."
          />
        </DashboardPanel>
      </div>
    </section>
  );
}
