import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import {
  WorkspaceSetupFlow,
  type WorkspaceSetupMode,
} from "./WorkspaceSetupFlow";

export function WorkspaceConnectDialog({
  open,
  onOpenChange,
  initialMode = "project-with-docs",
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialMode?: WorkspaceSetupMode;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" aria-label="새 워크스페이스 연결">
        <DialogHeader>
          <div className="grid gap-[var(--space-1)]">
            <DialogTitle>새 워크스페이스 연결</DialogTitle>
            <DialogDescription>
              새 GitHub Project + 문서 저장소 묶음이나 단독 문서 저장소를 추가합니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="닫기" />
        </DialogHeader>
        <DialogBody className="pt-[var(--space-2)]">
          <WorkspaceSetupFlow
            initialMode={initialMode}
            docsRepositoryGateway={docsRepositoryGateway}
            repositoryGateway={repositoryGateway}
            onComplete={() => onOpenChange(false)}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
