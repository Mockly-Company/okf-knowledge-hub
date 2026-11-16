import { ArrowLeft, ArrowRight, ExternalLink, Map as MapIcon, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { normalizeDocumentPath } from "../model";

export interface OpenDocumentTab {
  path: string;
  title: string;
}

export function DocumentWorkbenchTabs({
  openTabs,
  activePath,
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
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack(): void;
  onGoForward(): void;
  onSelectHome(): void;
  onSelectTab(path: string): void;
  onCloseTab(path: string): void;
  onOpenNewWindow?(path: string): void;
}) {
  if (openTabs.length === 0 && activePath === null) {
    return null;
  }

  const normalizedActive = activePath
    ? normalizeDocumentPath(activePath).toLowerCase()
    : null;

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

      <div className="document-workbench-tabs__list" role="tablist" aria-label="문서 탭 목록">
        <UnstyledButton
          type="button"
          role="tab"
          aria-selected={normalizedActive === null}
          data-active={normalizedActive === null}
          className="document-workbench-tab document-workbench-tab--home"
          onClick={onSelectHome}
        >
          <MapIcon aria-hidden="true" size={14} />
          <span>문서 맵</span>
        </UnstyledButton>

        {openTabs.map((tab) => {
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
                role="tab"
                aria-selected={isActive}
                data-active={isActive}
                className="document-workbench-tab"
                onClick={() => onSelectTab(tab.path)}
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
