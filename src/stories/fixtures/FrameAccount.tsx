import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";

/** Account identity only; account actions remain in Settings. */
export function FrameAccount({ collapsed }: { collapsed: boolean }) {
  const { account } = useWorkspaceConnection();
  const user = account.status === "authenticated" || account.status === "logging_out" ? account.user : null;
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [user?.id, user?.avatarUrl]);
  const label = user ? `@${user.login}` : account.status === "loading" ? "계정 불러오는 중" : account.status === "login_beginning" || account.status === "waiting_for_user" ? "GitHub 연결 중" : "GitHub 재로그인 필요";
  const description = user ? "GitHub 계정" : account.status === "loading" ? "" : "Settings에서 연결";
  const identity = <div className="frame-prototype__account" data-collapsed={collapsed} role="group" aria-label={`GitHub 계정: ${label}`} tabIndex={collapsed ? 0 : undefined}>
    <span className="frame-prototype__avatar" aria-hidden="true">
      {user && !avatarFailed ? <img src={user.avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : user ? Array.from(user.login.trim())[0]?.toLocaleUpperCase() ?? "GH" : "GH"}
    </span>
    {!collapsed && <span className="frame-prototype__account-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span>}
  </div>;
  return collapsed ? <Tooltip content={`${label}${description ? ` · ${description}` : ""}`}>{identity}</Tooltip> : identity;
}
