import { useState, type PropsWithChildren, type ReactElement } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createQueryClient } from "@/infrastructure/query/queryClient";

/**
 * 테스트용 QueryClient. 재시도를 꺼서 실패가 즉시 드러난다.
 * 테스트마다 새 인스턴스를 쓴다(캐시 공유 금지).
 */
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return client;
}

export function TestQueryProvider({
  children,
  client,
}: PropsWithChildren<{ client?: QueryClient }>): ReactElement {
  const [resolved] = useState(() => client ?? createTestQueryClient());
  return (
    <QueryClientProvider client={resolved}>{children}</QueryClientProvider>
  );
}
