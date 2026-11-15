import { CircleAlert, Compass, FileText, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AppFallbackKind = "not_found" | "error";

export interface AppFallbackScreenProps {
  kind?: AppFallbackKind;
  title?: string;
  description?: string;
  detail?: string | null;
  onGoHome: () => void;
  onGoDocuments?: () => void;
  onRetry?: () => void;
}

const RESIDUAL_SECRET_MARKERS = [
  "access_token",
  "refresh_token",
  "id_token",
  "auth_token",
  "device_code",
  "client_secret",
  "private_key",
  "authorization",
  "password",
  "passwd",
  "secret",
  "api_key",
  "api-key",
  "apikey",
  "x-api-key",
  "bearer ",
  "token",
];

const RESIDUAL_PREFIX_PATTERN =
  /(?:^|[^a-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-|sk-)/i;

function maskSensitivePatterns(input: string): string {
  return (
    input
      // URL userinfo credentials: https://user:token@github.com/...
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
      // Windows local paths: C:\Users\alice\..., C:/Users/alice/..., path=D:/..., file:///C:/...
      .replace(/(^|[^a-z0-9])(?:\\\\\?\\)?[a-z]:[\\/][^\s)"'`,;&]+/gi, "$1[REDACTED]")
      // POSIX sensitive local paths: /Users/alice/..., path=/Users/alice/..., file:///private/..., "/home/..."
      .replace(
        /(^|[^a-z0-9])\/(?:users|home|private|var|tmp)\/[^\s)"'`,;&]+/gi,
        "$1[REDACTED]",
      )
      // Authorization headers: Authorization: Bearer xxx / authorization=token xxx
      .replace(
        /\b(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s,;'"`)]+/gi,
        "$1[REDACTED]",
      )
      // Standalone Bearer scheme: Bearer xxx
      .replace(/\b(bearer\s+)[^\s,;'"`)]+/gi, "$1[REDACTED]")
      // Known token prefixes (GitHub classic/OAuth/App/PAT, GitLab, Slack, OpenAI/API sk-, JWT)
      .replace(
        /(^|[^a-z0-9])(?:gh[pousr]_[a-z0-9_]*|github_pat_[a-z0-9_]*|glpat-[a-z0-9_-]*|xox[baprs]-[a-z0-9-]*|sk-[a-z0-9_-]+|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi,
        "$1[REDACTED]",
      )
      // Key=value or key: value assignments (including query params like ?token=xyz or api_key: xyz)
      .replace(
        /\b(access_token|refresh_token|id_token|auth_token|device_code|client_secret|private_key|x-api-key|api[-_]?key|password|passwd|secret|token)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&;'"`)]+)/gi,
        "$1$2[REDACTED]",
      )
  );
}

export function sanitizeDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;

  const masked = maskSensitivePatterns(trimmed);
  const remainder = masked
    .replace(
      /(?:\b[a-z0-9_-]+\s*[:=]\s*|\b(?:bearer|authorization)\s*:?\s*)?\[REDACTED\]/gi,
      "",
    )
    .toLowerCase();

  if (
    RESIDUAL_SECRET_MARKERS.some((marker) => remainder.includes(marker)) ||
    RESIDUAL_PREFIX_PATTERN.test(remainder)
  ) {
    return null;
  }
  return masked;
}

const DEFAULT_COPY: Record<
  AppFallbackKind,
  { badge: string; title: string; description: string }
> = {
  not_found: {
    badge: "404 · 경로 없음",
    title: "요청한 화면을 찾을 수 없습니다",
    description:
      "주소가 잘못되었거나 이동할 수 없는 경로입니다. 홈 대시보드나 문서 화면으로 돌아가 작업을 이어가세요.",
  },
  error: {
    badge: "오류 발생",
    title: "화면을 표시하는 중 문제가 발생했습니다",
    description:
      "예기치 않은 오류가 발생해 화면을 불러오지 못했습니다. 다시 시도하거나 홈으로 돌아가 주세요.",
  },
};

export function AppFallbackScreen({
  kind = "not_found",
  title,
  description,
  detail,
  onGoHome,
  onGoDocuments,
  onRetry,
}: AppFallbackScreenProps) {
  const defaults = DEFAULT_COPY[kind];
  const resolvedTitle = title ?? defaults.title;
  const resolvedDescription = description ?? defaults.description;
  const safeDetail = sanitizeDetail(detail);
  const Icon = kind === "error" ? CircleAlert : Compass;

  return (
    <section
      role={kind === "error" ? "alert" : "region"}
      aria-labelledby="app-fallback-title"
      className="flex min-h-[min(100%,28rem)] w-full items-center justify-center bg-[var(--color-surface)] px-[var(--page-padding-inline)] py-[var(--space-8)]"
    >
      <div className="grid w-full max-w-[34rem] gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-6)] shadow-[var(--shadow-feedback)]">
        <div className="flex items-start gap-[var(--space-3)]">
          <div
            aria-hidden="true"
            className={
              kind === "error"
                ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-error-soft)] text-[var(--color-error)]"
                : "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-info-soft)] text-[var(--color-info)]"
            }
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
          </div>
          <div className="grid min-w-0 gap-[var(--space-1)]">
            <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-muted)]">
              {defaults.badge}
            </span>
            <h1
              id="app-fallback-title"
              className="m-0 text-[length:var(--font-h2-size)] leading-[var(--font-h2-line)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)]"
            >
              {resolvedTitle}
            </h1>
            <p className="m-0 mt-[var(--space-1)] text-[length:var(--font-body-size)] leading-[var(--font-body-line)] text-[var(--color-text-default)]">
              {resolvedDescription}
            </p>
          </div>
        </div>

        {safeDetail ? (
          <p className="m-0 break-all rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
            {safeDetail}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-[var(--space-2)] pt-[var(--space-1)]">
          <Button type="button" onClick={onGoHome}>
            <Home aria-hidden="true" />
            홈으로 돌아가기
          </Button>
          {onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          ) : null}
          {onGoDocuments ? (
            <Button type="button" variant="secondary" onClick={onGoDocuments}>
              <FileText aria-hidden="true" />
              문서로 이동
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
