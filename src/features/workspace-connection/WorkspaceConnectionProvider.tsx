import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { hubWorkspaceQueryKey } from "@/features/active-project/ActiveProjectProvider";
import { projectBoardKeys } from "@/features/project-board/queryKeys";
import type { WorkspaceConnectionGateway } from "./WorkspaceConnectionGateway";
import {
  accountSessionReducer,
  createInitialAccountSessionState,
  type AccountSessionState,
} from "./account-session";
import type { AppError, AuthState, AuthStatusEvent } from "./types";

export type AuthSessionOrigin = "initial" | "login" | null;

/**
 * GitHub 계정 연결 상태. 문서 저장소는 프로젝트별로 Documents 화면에서 고르므로
 * 여기서는 로그인·로그아웃만 다룬다.
 */
export interface WorkspaceConnectionContextValue {
  account: AccountSessionState;
  /** 처음 계정 상태를 읽는 동안 참이다. */
  isCurrentWorkspaceLoading: boolean;
  /** 인증 세션이 수립될 때마다 증가한다(앱 시작 복원·신규 로그인). */
  authSessionVersion: number;
  /** 현재 인증 세션의 시작 원인. 앱 시작 복원이면 initial, 대화형 신규 로그인이면 login. */
  authSessionOrigin: AuthSessionOrigin;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  logoutGithub(): Promise<void>;
  openVerificationUrl(url: string): Promise<void>;
}

const WorkspaceConnectionContext =
  createContext<WorkspaceConnectionContextValue | null>(null);

function operationId(): string {
  return crypto.randomUUID();
}

const secretBoundaryMarkers = ["access_token", "refresh_token", "device_code", "ghu_", "ghr_"];

function containsSecretBoundaryMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return secretBoundaryMarkers.some((marker) => normalized.includes(marker));
}

/** 백엔드 오류를 화면에 보여도 되는 값만 남긴다. 토큰 조각은 버린다. */
function asAppError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const candidate = error as AppError;
    const details = Object.fromEntries(
      Object.entries(candidate.details ?? {}).filter(
        ([key, value]) =>
          typeof value === "string" &&
          !containsSecretBoundaryMarker(key) &&
          !containsSecretBoundaryMarker(value),
      ),
    );
    return {
      code: candidate.code,
      message:
        typeof candidate.message === "string" && !containsSecretBoundaryMarker(candidate.message)
          ? candidate.message
          : "연결 작업을 완료할 수 없습니다.",
      recovery: candidate.recovery,
      details,
    };
  }
  return {
    code: "github_unavailable",
    message: "연결 작업을 완료할 수 없습니다.",
    recovery: "retry",
    details: {},
  };
}

function sanitizeAuthStatusEvent(event: AuthStatusEvent): AuthStatusEvent {
  return event.status === "failed" ? { ...event, error: asAppError(event.error) } : event;
}

interface WorkspaceConnectionProviderProps extends PropsWithChildren {
  gateway: WorkspaceConnectionGateway;
}

export function WorkspaceConnectionProvider({
  gateway,
  children,
}: WorkspaceConnectionProviderProps) {
  const queryClient = useContext(QueryClientContext);
  const [account, dispatchAccount] = useReducer(
    accountSessionReducer,
    undefined,
    createInitialAccountSessionState,
  );
  const [authSession, setAuthSession] = useState<{
    version: number;
    origin: AuthSessionOrigin;
  }>({ version: 0, origin: null });
  const accountRef = useRef(account);

  // 같은 렌더 안에서 연달아 들어온 동작도 최신 상태 기준으로 받아들일지 정한다.
  const dispatchAccepted = useCallback(
    (action: Parameters<typeof accountSessionReducer>[1]) => {
      const current = accountRef.current;
      const next = accountSessionReducer(current, action);
      if (next === current) return false;
      accountRef.current = next;
      dispatchAccount(action);

      const enteredAuthenticated =
        next.status === "authenticated" &&
        current.status !== "logging_out" &&
        (current.status !== "authenticated" ||
          current.user.id !== next.user.id ||
          current.user.login !== next.user.login);
      if (enteredAuthenticated) {
        const origin: AuthSessionOrigin =
          current.status === "loading" ? "initial" : "login";
        setAuthSession((prev) => ({ version: prev.version + 1, origin }));
      } else if (
        (current.status === "authenticated" || current.status === "logging_out") &&
        (next.status === "signed_out" || next.status === "reauthentication_required")
      ) {
        setAuthSession((prev) => ({ version: prev.version, origin: null }));
      }
      return true;
    },
    [],
  );

  const prevAccountStatusRef = useRef(account.status);
  useEffect(() => {
    const prevStatus = prevAccountStatusRef.current;
    prevAccountStatusRef.current = account.status;
    if (!queryClient) {
      return;
    }
    const leftAuthenticated =
      (prevStatus === "authenticated" || prevStatus === "logging_out") &&
      (account.status === "signed_out" ||
        account.status === "reauthentication_required");
    if (leftAuthenticated) {
      queryClient.clear();
    }
  }, [account.status, queryClient]);

  const lastInvalidatedLoginVersionRef = useRef(0);
  useEffect(() => {
    if (
      !queryClient ||
      authSession.origin !== "login" ||
      authSession.version === 0 ||
      lastInvalidatedLoginVersionRef.current === authSession.version
    ) {
      return;
    }
    lastInvalidatedLoginVersionRef.current = authSession.version;
    void queryClient.invalidateQueries({ queryKey: hubWorkspaceQueryKey });
    void queryClient.invalidateQueries({ queryKey: projectBoardKeys.linkedProjects });
  }, [authSession.origin, authSession.version, queryClient]);

  const startLogin = useCallback(async () => {
    const requestId = operationId();
    if (!dispatchAccepted({ type: "loginBeginStarted", requestId })) return;
    try {
      const authorization = await gateway.beginGithubAuth(requestId);
      dispatchAccepted({ type: "loginStarted", requestId, authorization });
    } catch (error) {
      dispatchAccepted({ type: "loginBeginFailed", requestId, error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const cancelLogin = useCallback(async () => {
    const current = accountRef.current;
    const requestId =
      current.status === "login_beginning"
        ? current.requestId
        : current.status === "waiting_for_user"
          ? current.authorization.requestId
          : null;
    if (requestId === null) return;
    try {
      await gateway.cancelGithubAuth(requestId);
    } finally {
      dispatchAccepted({
        type: "authEventReceived",
        event: { status: "cancelled", requestId },
      });
    }
  }, [dispatchAccepted, gateway]);

  const logoutGithub = useCallback(async () => {
    if (!dispatchAccepted({ type: "logoutStarted" })) return;
    try {
      await gateway.logoutGithub();
      dispatchAccepted({ type: "logoutSucceeded" });
    } catch (error) {
      dispatchAccepted({ type: "logoutFailed", error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const openVerificationUrl = useCallback(
    async (url: string) => {
      await gateway.openExternal(url);
    },
    [gateway],
  );

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      // 이벤트를 먼저 구독해야 상태를 읽는 사이에 끝난 로그인을 놓치지 않는다.
      try {
        const registered = await gateway.onAuthStatus((event) => {
          dispatchAccepted({ type: "authEventReceived", event: sanitizeAuthStatusEvent(event) });
        });
        if (!active) {
          registered();
          return;
        }
        unlisten = registered;
      } catch (error) {
        dispatchAccepted({ type: "authLoadFailed", error: asAppError(error) });
        return;
      }
      let auth: AuthState;
      try {
        auth = await gateway.getAuthState();
      } catch (error) {
        if (active) dispatchAccepted({ type: "authLoadFailed", error: asAppError(error) });
        return;
      }
      if (active) dispatchAccepted({ type: "authLoaded", auth });
    };
    void setup();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [dispatchAccepted, gateway]);

  const value = useMemo<WorkspaceConnectionContextValue>(
    () => ({
      account,
      isCurrentWorkspaceLoading: account.status === "loading",
      authSessionVersion: authSession.version,
      authSessionOrigin: authSession.origin,
      startLogin,
      cancelLogin,
      logoutGithub,
      openVerificationUrl,
    }),
    [
      account,
      authSession.origin,
      authSession.version,
      cancelLogin,
      logoutGithub,
      openVerificationUrl,
      startLogin,
    ],
  );

  return (
    <WorkspaceConnectionContext.Provider value={value}>{children}</WorkspaceConnectionContext.Provider>
  );
}

/** provider 없이 렌더되는 단위 테스트·스토리용. 없으면 null. */
export function useOptionalWorkspaceConnection(): WorkspaceConnectionContextValue | null {
  return useContext(WorkspaceConnectionContext);
}

export function useWorkspaceConnection(): WorkspaceConnectionContextValue {
  const value = useContext(WorkspaceConnectionContext);
  if (!value) throw new Error("useWorkspaceConnection must be used inside WorkspaceConnectionProvider");
  return value;
}
