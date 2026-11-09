import { useQuery } from "@tanstack/react-query";
import { StatusFeedback } from "@/components/ui/status-feedback";
import type { PullOutcome } from "@/features/docs-repository/DocsRepositoryGateway";
import { docsPullKey } from "@/features/docs-repository/useDocsRepositorySync";

export const PULL_SKIPPED_NOTICE = "작업 중인 변경이 있어 최신 내용을 받지 않았습니다.";

/** 마지막 받기를 건너뛰었으면 알린다. 결과는 useDocsRepositorySync가 채운다. */
export function DocsPullNotice() {
  const outcome = useQuery<PullOutcome | null>({
    queryKey: docsPullKey,
    queryFn: () => null,
    enabled: false,
  }).data;
  if (!outcome?.startsWith("skipped")) {
    return null;
  }
  return (
    <StatusFeedback variant="banner" tone="info" className="documents-page__notice">
      <span>{PULL_SKIPPED_NOTICE}</span>
    </StatusFeedback>
  );
}
