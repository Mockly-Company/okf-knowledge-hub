import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagramDialog } from "./DiagramDialog";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><text>safe</text></svg>';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(width = 1008, height = 528) {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("diagram-dialog__canvas") ? width : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("diagram-dialog__canvas") ? height : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const scale = this.classList.contains("diagram-dialog__canvas") ? 0.95 : 0;
    return { width: width * scale, height: height * scale, x: 0, y: 0, top: 0, left: 0, right: width * scale, bottom: height * scale, toJSON: () => ({}) };
  });
  const view = render(<DiagramDialog svg={svg} open onOpenChange={vi.fn()} />);
  const canvas = screen.getByRole("region", { name: "다이어그램 캔버스" });
  const drawing = screen.getByText("safe").closest("svg")!.parentElement!;
  return { ...view, canvas, drawing, user: userEvent.setup() };
}

function pointer(target: HTMLElement, type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number, pointerId = 7) {
  const event = createEvent[type](target, { clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}

describe("DiagramDialog", () => {
  it("centers at 100% on opening using untransformed layout dimensions before any toolbar action", () => {
    const { drawing } = setup();
    expect(drawing).toHaveStyle({ transform: "translate(184px, 104px) scale(1)" });
  });

  it("steps zoom by 25%, clamps to 50–300%, and resets to 100%", async () => {
    const { user } = setup();
    const increase = screen.getByRole("button", { name: "확대" });
    const decrease = screen.getByRole("button", { name: "축소" });
    expect(screen.getByText("100%")).toBeVisible();
    await user.click(increase);
    expect(screen.getByText("125%")).toBeVisible();
    for (let i = 0; i < 12; i++) await user.click(increase);
    expect(screen.getByText("300%")).toBeVisible();
    expect(increase).toBeDisabled();
    for (let i = 0; i < 12; i++) await user.click(decrease);
    expect(screen.getByText("50%")).toBeVisible();
    expect(decrease).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "100%로 초기화" }));
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("fits with 24px margins and zooms around the canvas center", async () => {
    const { user, drawing } = setup();
    await user.click(screen.getByRole("button", { name: "화면에 맞춤" }));
    expect(screen.getByText("150%")).toBeVisible();
    expect(drawing).toHaveStyle({ width: "640px", height: "320px", transform: "translate(24px, 24px) scale(1.5)" });
    await user.click(screen.getByRole("button", { name: "확대" }));
    expect(drawing).toHaveStyle({ transform: "translate(-56px, -16px) scale(1.75)" });
    await user.click(screen.getByRole("button", { name: "100%로 초기화" }));
    expect(drawing).toHaveStyle({ transform: "translate(184px, 104px) scale(1)" });
  });

  it.each([[100, 80, "50%"], [3000, 2000, "300%"]])("clamps fit in a %s×%s canvas", async (width, height, percent) => {
    const { user } = setup(width, height);
    await user.click(screen.getByRole("button", { name: "화면에 맞춤" }));
    expect(screen.getByText(percent)).toBeVisible();
  });

  it.each(["pointerUp", "pointerCancel"] as const)("pans only the captured pointer and stops after %s", async (end) => {
    const { user, canvas, drawing } = setup();
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn().mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "화면에 맞춤" }));
    pointer(canvas, "pointerDown", 100, 100);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    pointer(canvas, "pointerMove", 180, 150, 9);
    expect(drawing).toHaveStyle({ transform: "translate(24px, 24px) scale(1.5)" });
    pointer(canvas, "pointerMove", 180, 150);
    expect(drawing).toHaveStyle({ transform: "translate(104px, 74px) scale(1.5)" });
    pointer(canvas, end, 180, 150);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    pointer(canvas, "pointerMove", 200, 200);
    expect(drawing).toHaveStyle({ transform: "translate(104px, 74px) scale(1.5)" });
  });
});
