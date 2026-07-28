import { describe, expect, it } from "vitest";
import type {
  AppError,
  DeviceAuthorization,
  GithubUserSummary,
} from "./types";
import {
  accountSessionReducer,
  createInitialAccountSessionState,
  type AccountSessionState,
} from "./account-session";

const user: GithubUserSummary = {
  id: 7,
  login: "hyeeun",
  avatarUrl: "https://example.test/avatar.png",
};

const authorization: DeviceAuthorization = {
  requestId: "1d6071d0-eace-44cb-b6d3-a88c8f28ba93",
  userCode: "ABCD-EFGH",
  verificationUri: "https://github.com/login/device",
  expiresAtUnix: 2_000,
  intervalSeconds: 5,
};

const error: AppError = {
  code: "github_unavailable",
  message: "GitHub에 연결할 수 없습니다.",
  recovery: "retry",
  details: {},
};

describe("accountSessionReducer", () => {
  it("loads the authenticated GitHub identity for application-wide display", () => {
    const state = accountSessionReducer(createInitialAccountSessionState(), {
      type: "authLoaded",
      auth: { status: "authenticated", user },
    });

    expect(state).toEqual({ status: "authenticated", user, error: null });
  });

  it("retains the authenticated identity while logout is running", () => {
    const authenticated: AccountSessionState = {
      status: "authenticated",
      user,
      error: null,
    };

    expect(
      accountSessionReducer(authenticated, { type: "logoutStarted" }),
    ).toEqual({ status: "logging_out", user, error: null });
  });

  it("returns to signed out only after logout succeeds", () => {
    const loggingOut: AccountSessionState = {
      status: "logging_out",
      user,
      error: null,
    };

    expect(
      accountSessionReducer(loggingOut, { type: "logoutSucceeded" }),
    ).toEqual({ status: "signed_out", error: null });
  });

  it("restores the authenticated identity when logout fails", () => {
    const loggingOut: AccountSessionState = {
      status: "logging_out",
      user,
      error: null,
    };

    expect(
      accountSessionReducer(loggingOut, { type: "logoutFailed", error }),
    ).toEqual({ status: "authenticated", user, error });
  });

  it("owns a login request before storing its public authorization", () => {
    const requestId = authorization.requestId;
    const beginning = accountSessionReducer(
      { status: "signed_out", error: null },
      { type: "loginBeginStarted", requestId },
    );
    const waiting = accountSessionReducer(beginning, {
      type: "loginStarted",
      requestId,
      authorization,
    });

    expect(beginning).toEqual({ status: "login_beginning", requestId, error: null });
    expect(waiting).toEqual({ status: "waiting_for_user", authorization, error: null });
  });

  it("ignores a login command result for another request", () => {
    const beginning: AccountSessionState = {
      status: "login_beginning",
      requestId: authorization.requestId,
      error: null,
    };

    expect(
      accountSessionReducer(beginning, {
        type: "loginStarted",
        requestId: "947149af-6fb9-45e6-bb49-c15765339834",
        authorization: {
          ...authorization,
          requestId: "947149af-6fb9-45e6-bb49-c15765339834",
        },
      }),
    ).toBe(beginning);
  });

  it("ignores a terminal auth event for another request", () => {
    const waiting: AccountSessionState = {
      status: "waiting_for_user",
      authorization,
      error: null,
    };

    expect(
      accountSessionReducer(waiting, {
        type: "authEventReceived",
        event: {
          status: "authenticated",
          requestId: "947149af-6fb9-45e6-bb49-c15765339834",
          user,
        },
      }),
    ).toBe(waiting);
  });

  it("accepts only the owned terminal auth event", () => {
    const waiting: AccountSessionState = {
      status: "waiting_for_user",
      authorization,
      error: null,
    };

    expect(
      accountSessionReducer(waiting, {
        type: "authEventReceived",
        event: {
          status: "authenticated",
          requestId: authorization.requestId,
          user,
        },
      }),
    ).toEqual({ status: "authenticated", user, error: null });
  });
});
