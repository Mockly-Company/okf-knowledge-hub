import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Map as MapIcon, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { normalizeDocumentPath } from "../model";

export interface OpenDocumentTab {
  path: string;
  title: string;
}

/** WAI-ARIA horizontal tablist keyboard navigation (ArrowLeft / ArrowRight / Home / End). */
export function handleHorizontalTabKeyDown(
  event: KeyboardEvent<HTMLElement>,
  currentIndex: number,
  totalTabs: number,
  onSelectIndex: (nextIndex: number) => void,
): void {
  if (totalTabs <= 0) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % totalTabs;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + totalTabs) % totalTabs;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = totalTabs - 1;
  }
  if (nextIndex === null) return;

  event.preventDefault();
  onSelectIndex(nextIndex);
  const tablist = event.currentTarget.closest('[role="tablist"]');
  const tabs = tablist?.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs?.[nextIndex]?.focus();
}

export function DocumentWorkbenchTabs({
  openTabs,
  activePath,
  panelId,
  pendingFocusTarget = null,
  onPendingFocusHandled,
  onKeyboardSelectTarget,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onSelectHome,
  onSelectTab,
  onCloseTab,
  onOpenNewWindow,
}: {
  openTabs: readonly OpenDocumentTab[];
  activePath: string | null;
  panelId?: string;
  pendingFocusTarget?: "home" | string | null;
  onPendingFocusHandled?(): void;
  onKeyboardSelectTarget?(target: "home" | string): void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack(): void;
  onGoForward(): void;
  onSelectHome(): void;
  onSelectTab(path: string): void;
  onCloseTab(path: string): void;
  onOpenNewWindow?(path: string): void;
}) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const normalizedActive = activePath
    ? normalizeDocumentPath(activePath).toLowerCase()
    : null;
  const normalizedPending =
    pendingFocusTarget === null
      ? null
      : pendingFocusTarget === "home"
        ? "home"
        : normalizeDocumentPath(pendingFocusTarget).toLowerCase();
  const focusTargetReached =
    normalizedPending !== null &&
    ((normalizedPending === "home" && normalizedActive === null) ||
      (normalizedPending !== "home" && normalizedActive === normalizedPending));

  useEffect(() => {
    if (!focusTargetReached) return;
    const activeTab = tablistRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    activeTab?.focus();
    onPendingFocusHandled?.();
  }, [focusTargetReached, normalizedPending, onPendingFocusHandled]);

  if (openTabs.length === 0 && activePath === null) {
    return null;
  }

  const activeTabIndex =
    normalizedActive === null
      ? -1
      : openTabs.findIndex(
          (tab) => normalizeDocumentPath(tab.path).toLowerCase() === normalizedActive,
        );
  const homeSelected = normalizedActive === null || activeTabIndex === -1;
  const totalTabs = 1 + openTabs.length;
  const selectByFlatIndex = (index: number) => {
    if (index === 0) {
      onKeyboardSelectTarget?.("home");
      onSelectHome();
      return;
    }
    const target = openTabs[index - 1];
    if (target) {
      onKeyboardSelectTarget?.(target.path);
      onSelectTab(target.path);
    }
  };

  return (
    <div
      className="document-workbench-tabs"
      role="navigation"
      aria-label="열린 문서 탭"
    >
      <div className="document-workbench-tabs__history">
        <IconButton
          type="button"
          label="이전 문서"
          tooltip={false}
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <ArrowLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          type="button"
          label="다음 문서"
          tooltip={false}
          disabled={!canGoForward}
          onClick={onGoForward}
        >
          <ArrowRight aria-hidden="true" />
        </IconButton>
      </div>

      <div
        ref={tablistRef}
        className="document-workbench-tabs__list"
        role="tablist"
        aria-label="문서 탭 목록"
      >
        <UnstyledButton
          type="button"
          id={panelId ? `${panelId}-tab-0` : undefined}
          role="tab"
          aria-selected={normalizedActive === null}
          aria-controls={panelId}
          tabIndex={homeSelected ? 0 : -1}
          data-active={normalizedActive === null}
          className="document-workbench-tab document-workbench-tab--home"
          onClick={onSelectHome}
          onKeyDown={(event) =>
            handleHorizontalTabKeyDown(event, 0, totalTabs, selectByFlatIndex)
          }
        >
          <MapIcon aria-hidden="true" size={14} />
          <span>문서 맵</span>
        </UnstyledButton>

        {openTabs.map((tab, tabIndex) => {
          const isActive =
            normalizedActive === normalizeDocumentPath(tab.path).toLowerCase();
          return (
            <div
              key={tab.path.toLowerCase()}
              className="document-workbench-tab-group"
              data-active={isActive}
            >
              <UnstyledButton
                type="button"
                id={panelId ? `${panelId}-tab-${tabIndex + 1}` : undefined}
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                data-active={isActive}
                className="document-workbench-tab"
                onClick={() => onSelectTab(tab.path)}
                onKeyDown={(event) =>
                  handleHorizontalTabKeyDown(
                    event,
                    tabIndex + 1,
                    totalTabs,
                    selectByFlatIndex,
                  )
                }
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onCloseTab(tab.path);
                  }
                }}
              >
                <span className="document-workbench-tab__title">{tab.title}</span>
              </UnstyledButton>
              <IconButton
                type="button"
                label="탭 닫기"
                tooltip={false}
                className="document-workbench-tab__close"
                onClick={() => onCloseTab(tab.path)}
              >
                <X aria-hidden="true" size={12} />
              </IconButton>
            </div>
          );
        })}
      </div>

      {activePath && onOpenNewWindow ? (
        <Button
          type="button"
          variant="ghost"
          className="document-workbench-tabs__popout"
          onClick={() => onOpenNewWindow(activePath)}
        >
          <ExternalLink aria-hidden="true" />
          새 창으로 열기
        </Button>
      ) : null}
    </div>
  );
}
