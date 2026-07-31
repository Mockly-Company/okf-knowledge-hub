import type {
  AppError,
  AuthState,
  AuthStatusEvent,
  DeviceAuthorization,
  GithubUserSummary,
} from "./types";

export type AccountSessionState =
  | { status: "loading"; error: null }
  | { status: "signed_out"; error: AppError | null }
  | { status: "reauthentication_required"; error: AppError | null }
  | {
      status: "authenticated";
      user: GithubUserSummary;
      error: AppError | null;
    }
  | { status: "login_beginning"; requestId: string; error: null }
  | {
      status: "waiting_for_user";
      authorization: DeviceAuthorization;
      error: null;
    }
  | { status: "logging_out"; user: GithubUserSummary; error: null };

export type AccountSessionAction =
  | { type: "authLoaded"; auth: AuthState }
  | { type: "authLoadFailed"; error: AppError }
  | { type: "loginBeginStarted"; requestId: string }
  | {
      type: "loginStarted";
      requestId: string;
      authorization: DeviceAuthorization;
    }
  | { type: "loginBeginFailed"; requestId: string; error: AppError }
  | { type: "authEventReceived"; event: AuthStatusEvent }
  | { type: "logoutStarted" }
  | { type: "logoutSucceeded" }
  | { type: "logoutFailed"; error: AppError };

export function createInitialAccountSessionState(): AccountSessionState {
  return { status: "loading", error: null };
}

function loadedAccountState(auth: AuthState): AccountSessionState {
  if (auth.status === "authenticated") {
    return { status: "authenticated", user: auth.user, error: null };
  }
  return { status: auth.status, error: null };
}

function activeLoginRequestId(state: AccountSessionState): string | null {
  if (state.status === "login_beginning") return state.requestId;
  if (state.status === "waiting_for_user") {
    return state.authorization.requestId;
  }
  return null;
}

export function accountSessionReducer(
  state: AccountSessionState,
  action: AccountSessionAction,
): AccountSessionState {
  switch (action.type) {
    case "authLoaded":
      return loadedAccountState(action.auth);
    case "authLoadFailed":
      return { status: "signed_out", error: action.error };
    case "loginBeginStarted":
      return state.status === "signed_out" ||
        state.status === "reauthentication_required"
        ? { status: "login_beginning", requestId: action.requestId, error: null }
        : state;
    case "loginStarted":
      return state.status === "login_beginning" &&
        state.requestId === action.requestId &&
        action.authorization.requestId === action.requestId
        ? {
            status: "waiting_for_user",
            authorization: action.authorization,
            error: null,
          }
        : state;
    case "loginBeginFailed":
      return state.status === "login_beginning" &&
        state.requestId === action.requestId
        ? { status: "signed_out", error: action.error }
        : state;
    case "authEventReceived": {
      if (action.event.status === "reauthentication_required") {
        return { status: "reauthentication_required", error: null };
      }
      if (action.event.requestId !== activeLoginRequestId(state)) return state;
      if (action.event.status === "authenticated") {
        return {
          status: "authenticated",
          user: action.event.user,
          error: null,
        };
      }
      if (action.event.status === "failed") {
        return { status: "signed_out", error: action.event.error };
      }
      if (action.event.status === "cancelled") {
        return { status: "signed_out", error: null };
      }
      return state;
    }
    case "logoutStarted":
      return state.status === "authenticated"
        ? { status: "logging_out", user: state.user, error: null }
        : state;
    case "logoutSucceeded":
      return state.status === "logging_out"
        ? { status: "signed_out", error: null }
        : state;
    case "logoutFailed":
      return state.status === "logging_out"
        ? { status: "authenticated", user: state.user, error: action.error }
        : state;
  }
}
