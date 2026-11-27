import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentAsset } from "../model";
import { DesignLinksBar } from "./DesignLinksBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const svgAsset: DocumentAsset = {
  kind: "svg",
  source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
};

describe("DesignLinksBar", () => {
  it("renders duplicate design entries as separate cards without React key collisions", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const duplicate = { title: "목록 시안", image: "assets/list.svg" };

    render(
      <DesignLinksBar
        designs={[duplicate, { ...duplicate }]}
        documentPath="docs/domains/documents/screen-spec.md"
        readAsset={vi.fn(async () => svgAsset)}
      />,
    );

    expect(await screen.findAllByAltText("목록 시안")).toHaveLength(2);
    expect(
      consoleError.mock.calls.some((args) =>
        String(args[0]).includes("same key"),
      ),
    ).toBe(false);
  });
});
