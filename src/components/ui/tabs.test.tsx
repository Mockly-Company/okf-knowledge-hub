import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TabsList, TabsTrigger } from "./tabs";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resizes the indicator when tab padding changes without resizing the list", () => {
  const observers: { targets: Set<Element>; callback: () => void }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    entry: { targets: Set<Element>; callback: () => void };
    constructor(callback: () => void) {
      this.entry = { targets: new Set(), callback };
      observers.push(this.entry);
    }
    observe(element: Element) { this.entry.targets.add(element); }
    disconnect() { this.entry.targets.clear(); }
  });
  render(<TabsList><TabsTrigger selected>문서 편집</TabsTrigger><TabsTrigger selected={false}>Markdown 원문</TabsTrigger></TabsList>);
  const list = screen.getByRole("tablist");
  const tab = screen.getByRole("tab", { name: "문서 편집" });
  let width = 80;
  vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => ({ left: 0, width: 500 } as DOMRect));
  vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() => ({ left: 0, width } as DOMRect));
  const resize = (element: Element) => act(() => {
    for (const observer of observers) if (observer.targets.has(element)) observer.callback();
  });
  resize(list);
  expect(screen.getByTestId("tab-indicator")).toHaveStyle({ width: "80px" });
  width = 112;
  resize(tab);
  expect(screen.getByTestId("tab-indicator")).toHaveStyle({ width: "112px" });
});
