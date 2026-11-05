import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createTestQueryClient, TestQueryProvider } from "./queryTestUtils";

function Probe() {
  const { data } = useQuery({ queryKey: ["probe"], queryFn: async () => "ok" });
  return <p>{data ?? "loading"}</p>;
}

describe("queryTestUtils", () => {
  it("renders queries with a test client", async () => {
    render(
      <TestQueryProvider>
        <Probe />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("disables retries so failures surface immediately", () => {
    const client = createTestQueryClient();

    expect(client.getDefaultOptions().queries?.retry).toBe(false);
  });
});
