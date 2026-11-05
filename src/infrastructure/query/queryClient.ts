import { QueryClient } from "@tanstack/react-query";

/**
 * 앱 공용 QueryClient 팩토리. 매번 새 인스턴스를 만든다.
 * 데스크톱 로컬 우선 기본값: 포커스 재조회 끔(명시적 새로고침 버튼이
 * 대신한다), 재시도 없음(실패는 재연결·수동 재시도로 복구), 30초 stale.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: false,
      },
    },
  });
}
