import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppError, RecoveryAction } from "../types";

const recoveryLabels: Record<RecoveryAction, string> = {
  restart_login: "로그인 다시 시작",
  reinstall_github_app: "GitHub 앱 설치 관리",
  choose_another_directory: "다른 위치 선택",
  connect_existing_clone: "기존 clone 연결",
  clean_working_tree: "정리 방법 보기",
  open_workspace_file: "워크스페이스 파일 열기",
  update_okhub: "OkHub 업데이트 확인",
  retry: "다시 시도",
};

interface ConnectionErrorProps {
  error: AppError;
  localPath?: string | null;
  onRecover(action: RecoveryAction): void;
}

export function ConnectionError({ error, localPath, onRecover }: ConnectionErrorProps) {
  return (
    <section className="connection-error" aria-labelledby="connection-error-title">
      <CircleAlert aria-hidden="true" strokeWidth={1.75} />
      <div>
        <h2 id="connection-error-title">연결을 완료하지 못했습니다</h2>
        <p>{error.message}</p>
        {localPath ? <code>{localPath}</code> : null}
        {error.recovery ? (
          <Button variant="secondary" onClick={() => onRecover(error.recovery!)}>
            {recoveryLabels[error.recovery]}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
