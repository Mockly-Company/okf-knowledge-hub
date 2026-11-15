import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { cn } from "@/lib/utils";
import type {
  BoardAssignee,
  WorkspaceTeamAssignees,
  WorkspaceTeamAssigneesSnapshot,
} from "./model";
import {
  TEAM_ROLES,
  areTeamAssigneesEqual,
  cloneTeamAssignees,
  collectConfiguredFallbackMembers,
  findMissingTeamRoles,
  findStaleAssignedLogins,
  hasRoleLogin,
  removeLoginFromAllRoles,
  sortTeamMembers,
  toggleRoleMember,
} from "./teamAssignees";

export interface TeamAssigneeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: WorkspaceTeamAssigneesSnapshot | null;
  isLoading: boolean;
  fetchError: string | null;
  isRefreshing?: boolean;
  isSaving: boolean;
  saveError: string | null;
  onRefreshMembers: () => void;
  onSave: (assignees: WorkspaceTeamAssignees) => Promise<void> | void;
}

function MemberAvatar({ member }: { member: BoardAssignee }) {
  const label = member.name?.trim() || member.login;
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        className="size-8 shrink-0 rounded-full border border-[var(--color-border)] object-cover"
      />
    );
  }
  const initial = (label.slice(0, 1) || "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-pressed)] text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]"
    >
      {initial}
    </span>
  );
}

export function TeamAssigneeSettingsDialog({
  open,
  onOpenChange,
  snapshot,
  isLoading,
  fetchError,
  isRefreshing = false,
  isSaving,
  saveError,
  onRefreshMembers,
  onSave,
}: TeamAssigneeSettingsDialogProps) {
  const [draft, setDraft] = useState<WorkspaceTeamAssignees | null>(() =>
    open && snapshot ? cloneTeamAssignees(snapshot.assignees) : null,
  );
  const initializedRef = useRef(Boolean(open && snapshot));

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      setDraft(null);
      return;
    }
    if (snapshot && !initializedRef.current) {
      initializedRef.current = true;
      setDraft(cloneTeamAssignees(snapshot.assignees));
    }
  }, [open, snapshot]);

  const membersFailed = Boolean(fetchError || snapshot?.memberFetchFailed);

  const displayMembers = useMemo(() => {
    if (!snapshot && !draft) {
      return [];
    }
    const baseMembers = snapshot?.members ?? [];
    if (membersFailed && draft) {
      return collectConfiguredFallbackMembers(draft, baseMembers);
    }
    return sortTeamMembers(baseMembers);
  }, [draft, membersFailed, snapshot]);

  const staleLogins = useMemo(() => {
    if (!draft || membersFailed) {
      return [];
    }
    return findStaleAssignedLogins(draft, snapshot?.members ?? []);
  }, [draft, membersFailed, snapshot?.members]);

  const missingRoles = useMemo(() => {
    if (!draft || isLoading) {
      return [];
    }
    return findMissingTeamRoles(draft, snapshot?.members ?? [], {
      treatAllConfiguredAsValid: membersFailed,
    });
  }, [draft, isLoading, membersFailed, snapshot?.members]);

  const isDirty = useMemo(() => {
    if (!draft || !snapshot) {
      return false;
    }
    return !areTeamAssigneesEqual(draft, snapshot.assignees);
  }, [draft, snapshot]);

  const showEmptyState =
    !isLoading && !membersFailed && displayMembers.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSaving && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent size="wide" aria-label="담당 설정">
        <DialogHeader>
          <div className="min-w-0 flex-1">
            <DialogTitle>담당 설정</DialogTitle>
            <DialogDescription>
              팀 멤버마다 맡을 역할을 고르세요. AI가 백로그를 나눌 때 여기
              설정된 사람에게만 배정합니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="담당 설정 닫기" disabled={isSaving} />
        </DialogHeader>

        <DialogBody className="mt-[var(--space-4)] grid content-start gap-[var(--space-4)] pr-[var(--space-1)]">
          {isLoading && !snapshot ? (
            <p
              role="status"
              className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]"
            >
              팀 멤버를 불러오는 중…
            </p>
          ) : null}

          {membersFailed ? (
            <StatusFeedback
              variant="banner"
              tone="error"
              actionPlacement="end"
              action={
                <Button
                  type="button"
                  variant="secondary"
                  loading={isRefreshing}
                  disabled={isRefreshing || isSaving}
                  onClick={onRefreshMembers}
                >
                  다시 시도
                </Button>
              }
            >
              멤버 목록을 불러오지 못했습니다. 현재 설정만 표시합니다.
            </StatusFeedback>
          ) : null}

          {missingRoles.length > 0 ? (
            <StatusFeedback variant="banner" tone="warning">
              <div className="grid gap-[var(--space-1)]">
                {missingRoles.map((role) => (
                  <p key={role.key} className="m-0">
                    {`${role.label} 담당자가 없습니다. AI가 해당 백로그를 만들 때 먼저 물어봅니다.`}
                  </p>
                ))}
              </div>
            </StatusFeedback>
          ) : null}

          {saveError ? (
            <StatusFeedback variant="banner" tone="error">
              담당 설정을 저장하지 못했습니다.
            </StatusFeedback>
          ) : null}

          {showEmptyState ? (
            <p className="m-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              담당 가능한 멤버가 없습니다. 저장소에 멤버를 초대한 뒤
              새로고침하세요.
            </p>
          ) : null}

          {displayMembers.length > 0 && draft ? (
            <ul className="m-0 grid list-none gap-[var(--space-2)] p-0">
              {displayMembers.map((member) => {
                const displayName = member.name?.trim() || member.login;
                return (
                  <li
                    key={member.login}
                    data-member-login={member.login}
                    aria-label={`${displayName} (@${member.login})`}
                    className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)]"
                  >
                    <div className="flex min-w-0 items-center gap-[var(--space-3)]">
                      <MemberAvatar member={member} />
                      <div className="min-w-0">
                        <div className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                          {displayName}
                        </div>
                        <div className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                          @{member.login}
                        </div>
                      </div>
                    </div>

                    <div
                      role="group"
                      aria-label={`${member.login} 역할`}
                      className="flex flex-wrap items-center gap-[var(--space-1)]"
                    >
                      {TEAM_ROLES.map((role) => {
                        const pressed = hasRoleLogin(draft[role.key], member.login);
                        return (
                          <Button
                            key={role.key}
                            type="button"
                            variant="secondary"
                            aria-pressed={pressed}
                            disabled={isSaving}
                            onClick={() =>
                              setDraft((prev) =>
                                prev
                                  ? toggleRoleMember(prev, role.key, member.login)
                                  : prev,
                              )
                            }
                            className={cn(
                              "px-2.5 text-[length:var(--font-meta-size)]",
                              pressed
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary-text)] data-[loading=false]:hover:border-[var(--color-primary)] data-[loading=false]:hover:bg-[var(--color-primary-soft)]"
                                : "bg-[var(--color-canvas)] text-[var(--color-text-default)]",
                            )}
                          >
                            {role.label}
                          </Button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {staleLogins.length > 0 && draft ? (
            <section
              aria-label="지정할 수 없는 담당자"
              className="grid gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                  저장소에서 권한을 확인할 수 없는 계정
                </span>
              </div>
              <div className="grid gap-[var(--space-2)]">
                {staleLogins.map((login) => (
                  <div
                    key={login}
                    className="flex items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)]"
                  >
                    <div className="flex items-center gap-[var(--space-2)]">
                      <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                        @{login}
                      </span>
                      <StatusBadge tone="warning">지정 불가</StatusBadge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isSaving}
                      onClick={() =>
                        setDraft((prev) =>
                          prev ? removeLoginFromAllRoles(prev, login) : prev,
                        )
                      }
                    >
                      제거
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-[var(--space-4)] justify-between border-t border-[var(--color-border)] pt-[var(--space-3)]">
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading || isRefreshing || isSaving}
            loading={isRefreshing}
            onClick={onRefreshMembers}
          >
            <RefreshCw aria-hidden="true" strokeWidth={1.75} />
            멤버 목록 새로고침
          </Button>

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!draft || !isDirty || isSaving}
              loading={isSaving}
              onClick={() => {
                if (draft) {
                  void onSave(cloneTeamAssignees(draft));
                }
              }}
            >
              저장
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
