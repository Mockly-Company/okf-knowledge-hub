import { describe, expect, it } from "vitest";
import { createQueryClient } from "./queryClient";

describe("createQueryClient", () => {
  it("uses desktop-friendly defaults", () => {
    const client = createQueryClient();

    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // 로컬 IPC 실패(인증·할당량·미연결·오프라인)는 즉시 재시도로 낫지
      // 않는다. 재연결 시 자동 재조회 + 수동 재시도로 복구한다.
      retry: false,
    });
  });

  it("creates independent clients", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
