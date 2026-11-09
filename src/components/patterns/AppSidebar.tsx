import {
  FolderOpen,
  House,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import { useState, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconButton } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { DocumentTree } from "@/features/documents/components/DocumentTree";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { cn } from "@/lib/utils";

const navigationItems = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/documents", label: "Documents", icon: FolderOpen, end: false },
  { to: "/project", label: "Ticket", icon: SquareKanban, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
  { to: "/ai", label: "AI", icon: Sparkles, end: false },
] as const;

interface AppSidebarProps {
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
  onCollapse(): void;
}

/** invoke 실패 원문을 한 줄 사유로 바꾼다. 문자열·Error·Tauri 객체를 모두 받는다. */
function describeFailure(error: unknown): string {
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.trim() !== ""
  ) {
    return (error as { message: string }).message;
  }
  return "알 수 없는 오류";
}

/** 프로젝트 명·owner·번호 부분일치. 빈 쿼리는 전체(미연결) 표시. */
function matchesProjectQuery(
  project: ResolvedGithubProject,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return (
    project.title.toLowerCase().includes(needle) ||
    project.owner.toLowerCase().includes(needle) ||
    String(project.number).includes(needle) ||
    `#${project.number}`.includes(needle)
  );
}

export function AppSidebar({ collapseButtonRef, onCollapse }: AppSidebarProps) {
  const location = useLocation();
  const {
    state: documentsState,
    selectDocument,
    showDocumentsHome,
    openNewDocument,
  } = useDocuments();
  const { account } = useWorkspaceConnection();
  const activeProject = useOptionalActiveProject();
  const isWorkAliasPath =
    location.pathname === "/work" ||
    location.pathname.startsWith("/work/");
  // 실패한 아바타 URL을 기억한다. 계정·URL이 바뀌면 자연히 다시 시도한다.
  // (effect로 플래그를 되돌리면 늦게 실행된 effect가 방금 난 실패를 지우는 경쟁이 생긴다.)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    ResolvedGithubProject[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  // 연결은 됐는데 선택만 실패한 항목. "다시 선택" 재시도용으로 기억한다.
  const [failedSelection, setFailedSelection] =
    useState<ResolvedGithubProject | null>(null);
  const accountUser =
    account.status === "authenticated" || account.status === "logging_out"
      ? account.user
      : null;
  const avatarFailed =
    accountUser !== null && failedAvatarUrl === accountUser.avatarUrl;
  const accountInitial = accountUser
    ? (Array.from(accountUser.login.trim())[0]?.toLocaleUpperCase() ?? "GH")
    : "GH";

  // 이름 검색은 전체 목록을 가져와 화면에서 거른다.
  // 백엔드 owner 필터는 exact-match라 프로젝트 명 검색에 쓸 수 없다.
  const runSearch = async () => {
    if (!activeProject) return;
    setIsSearching(true);
    setSearchError(null);
    setFailedSelection(null);
    try {
      const list = await activeProject.searchProjects();
      setSearchResults(list.projects);
      setSearchTruncated(list.truncated);
    } catch (error) {
      setSearchError(
        `Project 목록을 가져오지 못했습니다. (사유: ${describeFailure(error)})`,
      );
      setSearchResults([]);
      setSearchTruncated(false);
    } finally {
      setIsSearching(false);
    }
  };

  const chooseSearchResult = async (resolved: ResolvedGithubProject) => {
    if (!activeProject) return;
    setSearchError(null);
    setFailedSelection(null);
    try {
      await activeProject.linkProject(resolved);
    } catch (error) {
      setSearchError(
        `프로젝트 연결에 실패했습니다. (사유: ${describeFailure(error)})`,
      );
      return;
    }
    try {
      await activeProject.selectProject(resolved.id);
    } catch (error) {
      // 연결은 됐으니 결과에서 빠진다. 선택만 다시 시도하면 된다.
      setFailedSelection(resolved);
      setSearchError(
        `프로젝트를 연결했지만 선택하지 못했습니다. (사유: ${describeFailure(error)})`,
      );
      return;
    }
    setSearchResults((prev) =>
      prev ? prev.filter((candidate) => candidate.id !== resolved.id) : prev,
    );
    setShowAddPanel(false);
  };

  const retryFailedSelection = async () => {
    if (!activeProject || !failedSelection) return;
    setSearchError(null);
    try {
      await activeProject.selectProject(failedSelection.id);
      setFailedSelection(null);
      setShowAddPanel(false);
    } catch (error) {
      setSearchError(
        `프로젝트를 연결했지만 선택하지 못했습니다. (사유: ${describeFailure(error)})`,
      );
    }
  };

  const linkedIds = new Set(
    (activeProject?.projects ?? []).map((project) => project.id),
  );
  // 입력이 바뀌면 재조회 없이 즉시 다시 거른다(자동완성처럼 동작).
  const matchingResults = (searchResults ?? []).filter((result) =>
    matchesProjectQuery(result, searchQuery),
  );
  const visibleResults = matchingResults.filter(
    (result) => !linkedIds.has(result.id),
  );
  const linkedMatchCount =
    matchingResults.length - visibleResults.length;

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <span className="app-sidebar__logo" aria-hidden="true">
          OK
        </span>
        <strong>OkHub</strong>
        <IconButton
          ref={collapseButtonRef}
          label="사이드바 접기"
          className="app-sidebar__collapse"
          onClick={onCollapse}
        >
          <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="app-sidebar__section app-sidebar__section--primary">
        {activeProject ? (
          <div
            className="grid gap-[var(--space-2)] px-[var(--space-2)] pb-[var(--space-2)]"
            aria-label="활성 프로젝트 선택"
          >
            <Select
              value={activeProject.activeProjectId ?? ""}
              onValueChange={(value) =>
                void activeProject.selectProject(value).catch(() => undefined)
              }
              placeholder={
                activeProject.isListing
                  ? "프로젝트 불러오는 중"
                  : "프로젝트 선택"
              }
              aria-label="활성 프로젝트"
              disabled={activeProject.isSelecting}
            >
              {activeProject.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title} · {project.owner} #{project.number}
                </option>
              ))}
            </Select>
            {activeProject.selectError ? (
              <p role="alert" className="m-0 text-[var(--color-error)]">
                {activeProject.selectError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAddPanel((open) => !open)}
              aria-expanded={showAddPanel}
            >
              <Plus aria-hidden="true" strokeWidth={1.75} />
              프로젝트 추가
            </Button>
            {showAddPanel ? (
              <div
                className="grid min-w-0 max-w-full gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--space-2)]"
                role="group"
                aria-label="프로젝트 추가"
              >
                <div className="flex min-w-0 gap-[var(--space-2)]">
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="프로젝트 명으로 검색"
                    aria-label="프로젝트 명"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void runSearch()}
                    disabled={isSearching}
                    className="shrink-0"
                  >
                    <Search aria-hidden="true" strokeWidth={1.75} />
                    검색
                  </Button>
                </div>
                {searchError ? (
                  <div className="grid gap-[var(--space-2)]">
                    <p role="alert" className="m-0 text-[var(--color-text-muted)]">
                      {searchError}
                    </p>
                    {failedSelection ? (
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void retryFailedSelection()}
                          disabled={activeProject.isSelecting}
                        >
                          다시 선택
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {searchTruncated ? (
                  <p role="status" className="m-0 text-[var(--color-text-muted)]">
                    프로젝트가 많아 일부만 검색했습니다.
                  </p>
                ) : null}
                {searchResults ? (
                  visibleResults.length === 0 ? (
                    <p className="m-0 text-[var(--color-text-muted)]">
                      {linkedMatchCount > 0
                        ? "이미 연결된 프로젝트입니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  ) : (
                    <div className="grid max-h-64 min-w-0 gap-[var(--space-1)] overflow-y-auto">
                      {visibleResults.map((result) => {
                        const label = `${result.title} · ${result.owner} #${result.number}`;
                        return (
                          <Button
                            key={result.id}
                            type="button"
                            variant="secondary"
                            onClick={() => void chooseSearchResult(result)}
                            disabled={activeProject.isSelecting}
                            title={label}
                            className="w-full min-w-0 justify-start"
                          >
                            <span className="min-w-0 flex-1 truncate text-left">
                              {label}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <nav aria-label="주 메뉴" className="app-sidebar__nav">
          {navigationItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={to === "/documents" ? showDocumentsHome : undefined}
              className={({ isActive }) =>
                cn(
                  "app-sidebar__link",
                  (isActive || (to === "/project" && isWorkAliasPath)) &&
                    "app-sidebar__link--active",
                )
              }
            >
              <Icon aria-hidden="true" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <hr className="app-sidebar__primary-divider" />
        {location.pathname.startsWith("/documents") ? (
          <div className="app-sidebar__documents">
            <DocumentTree
              entries={documentsState.catalog.roots}
              selectedPath={documentsState.selectedPath}
              onSelectDocument={selectDocument}
              onNewDocument={openNewDocument}
            />
          </div>
        ) : null}
      </div>
      <div className="app-sidebar__user">
        {account.status === "loading" ? (
          <>
            <span
              className="app-sidebar__avatar app-sidebar__skeleton"
              aria-hidden="true"
            />
            <span
              className="app-sidebar__user-copy app-sidebar__user-copy--loading"
              aria-label="GitHub 계정 불러오는 중"
            >
              <span className="app-sidebar__skeleton" />
              <span className="app-sidebar__skeleton" />
            </span>
          </>
        ) : (
          <>
            <span className="app-sidebar__avatar" aria-hidden="true">
              {accountUser && !avatarFailed ? (
                <img
                  src={accountUser.avatarUrl}
                  alt=""
                  onError={() => setFailedAvatarUrl(accountUser.avatarUrl)}
                />
              ) : (
                accountInitial
              )}
            </span>
            <span className="app-sidebar__user-copy">
              <strong>
                {accountUser
                  ? `@${accountUser.login}`
                  : account.status === "login_beginning" ||
                      account.status === "waiting_for_user"
                    ? "GitHub 연결 중"
                    : "GitHub 재로그인 필요"}
              </strong>
              <small>{accountUser ? "GitHub 계정" : "Settings에서 연결"}</small>
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
