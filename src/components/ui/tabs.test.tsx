import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TabsList, TabsTrigger } from "./tabs";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resizes the indicator when tab padding changes without resizing the list", async () => {
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
  await waitFor(() => {
    expect(screen.getByTestId("tab-indicator")).toHaveStyle({ width: "80px" });
  });
  width = 112;
  resize(tab);
  await waitFor(() => {
    expect(screen.getByTestId("tab-indicator")).toHaveStyle({ width: "112px" });
  });
});

it("throttles ResizeObserver, scroll, and window resize events via requestAnimationFrame", () => {
  const observers: { callback: () => void }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) {
      observers.push({ callback });
    }
    observe() {}
    disconnect() {}
  });
  let rafId = 0;
  const rafQueue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue.delete(id);
  });

  render(<TabsList><TabsTrigger selected>문서 편집</TabsTrigger><TabsTrigger selected={false}>Markdown 원문</TabsTrigger></TabsList>);
  const list = screen.getByRole("tablist");
  const tab = screen.getByRole("tab", { name: "문서 편집" });
  let width = 90;
  const measureSpy = vi
    .spyOn(tab, "getBoundingClientRect")
    .mockImplementation(() => ({ left: 0, width } as DOMRect));
  measureSpy.mockClear();

  act(() => {
    observers.forEach((observer) => observer.callback());
    list.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    width = 140;
    observers.forEach((observer) => observer.callback());
    window.dispatchEvent(new Event("resize"));
  });

  expect(measureSpy).not.toHaveBeenCalled();
  expect(rafQueue.size).toBe(1);

  act(() => {
    const callbacks = Array.from(rafQueue.values());
    rafQueue.clear();
    callbacks.forEach((cb) => cb(16));
  });

  expect(measureSpy).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("tab-indicator")).toHaveStyle({ width: "140px" });
});
