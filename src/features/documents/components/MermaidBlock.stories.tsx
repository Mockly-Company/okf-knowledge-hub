import type { Meta, StoryObj } from "@storybook/react-vite";
import mermaid from "mermaid";
import { expect, screen, spyOn, waitFor, within } from "storybook/test";
import { mermaidFixtures } from "@/stories/fixtures/markdown";
import { MermaidBlock } from "./MermaidBlock";
import "../documents.css";

const meta = {
  title: "Documents/MermaidBlock",
  component: MermaidBlock,
  parameters: { layout: "padded" },
  args: { source: mermaidFixtures.default },
} satisfies Meta<typeof MermaidBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const expand = await canvas.findByRole("button", { name: "다이어그램 크게 보기" });
    await userEvent.tab();
    await expect(expand).toHaveFocus();
    await expect(expand).not.toHaveAttribute("title");
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const diagram = canvasElement.querySelector(".mermaid-block__svg")!;
    await expect(expand.getBoundingClientRect().bottom).toBeLessThanOrEqual(diagram.getBoundingClientRect().top);
  },
};

export const Expanded: Story = {
  play: async ({ canvas, userEvent }) => {
    const expand = await canvas.findByRole("button", { name: "다이어그램 크게 보기" });
    await userEvent.tab();
    await expect(expand).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "다이어그램 크게 보기" });
    const controls = within(dialog);
    const fit = controls.getByRole("button", { name: "화면에 맞춤" });
    await waitFor(() => expect(fit).toHaveFocus());
    await expect(controls.getByLabelText("확대 비율")).toHaveTextContent("100%");
    await userEvent.click(controls.getByRole("button", { name: "확대" }));
    await expect(controls.getByLabelText("확대 비율")).toHaveTextContent("125%");
    await userEvent.click(controls.getByRole("button", { name: "축소" }));
    await expect(controls.getByLabelText("확대 비율")).toHaveTextContent("100%");
    await userEvent.click(fit);
    await userEvent.click(controls.getByRole("button", { name: "100%로 초기화" }));
    await expect(controls.getByLabelText("확대 비율")).toHaveTextContent("100%");
    await userEvent.tab();
    await expect(controls.getByRole("button", { name: "다이어그램 닫기" })).toHaveFocus();
    await userEvent.tab();
    await expect(fit).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(controls.getByRole("button", { name: "다이어그램 닫기" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(expand).toHaveFocus();
    // Leave this semantic state open for visual review and the global axe gate.
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("dialog", { name: "다이어그램 크게 보기" })).toBeVisible());
    screen.getByRole("dialog", { name: "다이어그램 크게 보기" }).setAttribute("data-interactions", "complete");
  },
};

export const Loading: Story = {
  args: { source: mermaidFixtures.loading },
  beforeEach: () => {
    // Hold only the renderer boundary; no network, timeout, or production-only API.
    const render = spyOn(mermaid, "render").mockImplementation(() => new Promise(() => {}));
    return () => render.mockRestore();
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("다이어그램을 렌더링하는 중…")).toBeVisible();
    await expect(canvasElement.querySelector(".mermaid-block")).toHaveAttribute("aria-busy", "true");
    await expect(canvas.queryByRole("button", { name: "다이어그램 크게 보기" })).not.toBeInTheDocument();
  },
};

export const InvalidSource: Story = {
  args: { source: mermaidFixtures.invalid },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("다이어그램을 표시할 수 없습니다.");
    await expect(canvas.getByText(/A\[끝나지 않은 노드/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "다이어그램 크게 보기" })).not.toBeInTheDocument();
  },
};

export const WideDiagram: Story = {
  args: { source: mermaidFixtures.wide },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const expand = await canvas.findByRole("button", { name: "다이어그램 크게 보기" });
    const block = canvasElement.querySelector<HTMLElement>(".mermaid-block")!;
    await expect(block.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(expand);
    const dialog = await screen.findByRole("dialog", { name: "다이어그램 크게 보기" });
    await userEvent.click(within(dialog).getByRole("button", { name: "화면에 맞춤" }));
    await expect(Number.parseInt(within(dialog).getByLabelText("확대 비율").textContent ?? "")).toBeLessThanOrEqual(100);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(expand).toHaveFocus());
  },
};
