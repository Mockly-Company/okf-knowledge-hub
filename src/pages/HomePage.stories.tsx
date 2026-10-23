import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { AppFramePreview } from "@/stories/fixtures/AppFramePreview";
import { homeStateControl, homeListSizeControl } from "@/stories/fixtures/home-tasks";
import { withAppProviders } from "@/stories/decorators/AppProviders";

const meta = {
  id: "pages-homepage", title: "화면/홈", component: AppFramePreview,
  parameters: { layout: "fullscreen", docs: { description: { component: "공용 프레임 안에서 요청된 리뷰와 담당 Issue를 확인합니다. GitHub 조회와 Issue 링크는 예시 데이터이며, 실제 연동은 별도 구현합니다. Controls에서 목록 상태를 바꿀 수 있습니다." } } },
  decorators: [withAppProviders()],
  args: { screen: "home", homeState: "ready", homeInsightState: "ready", initialCollapsed: false, platform: "macos" },
  argTypes: { screen: { table: { disable: true } }, homeInsightState: { name: "분석 상태", options: ["ready", "empty", "unavailable", "loading", "error", "stale"], control: "select" }, homeState: homeStateControl, homeListSize: homeListSizeControl, initialCollapsed: { name: "데스크톱 최초 접힘", control: "boolean" }, platform: { name: "운영체제", options: ["macos", "windows"], control: "radio" } },
} satisfies Meta<typeof AppFramePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "내 작업" };
export const IssueStatusColorTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const badges = [...canvasElement.querySelectorAll<HTMLElement>(".home-task-row__project")];
    const colors = ["Backlog", "Ready", "In progress", "In review"].map(status => {
      const badge = badges.find(element => element.textContent === status);
      expect(badge).toBeTruthy();
      return getComputedStyle(badge!).backgroundColor;
    });
    await expect(new Set(colors).size).toBe(4);
    await expect(badges.find(element => element.textContent === "In progress")).toHaveAttribute("data-tone", "primary");
    await expect(badges.find(element => element.textContent === "In review")).toHaveAttribute("data-tone", "warning");
  },
};
export const InsightToneTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const cards = [...canvasElement.querySelectorAll(".home-insights__card")];
    await expect(getComputedStyle(cards[0]).getPropertyValue("--insight-accent").trim()).toBe(getComputedStyle(cards[0]).getPropertyValue("--color-warning").trim());
    await expect(getComputedStyle(cards[0]).getPropertyValue("--insight-background").trim()).toBe(getComputedStyle(cards[0]).getPropertyValue("--color-warning-soft").trim());
    await expect(getComputedStyle(cards[1]).getPropertyValue("--insight-accent").trim()).toBe(getComputedStyle(cards[1]).getPropertyValue("--color-primary-text").trim());
    await expect(getComputedStyle(cards[1]).getPropertyValue("--insight-background").trim()).toBe(getComputedStyle(cards[1]).getPropertyValue("--color-primary-soft").trim());
    await expect(getComputedStyle(cards[0]).backgroundColor).not.toBe(getComputedStyle(cards[1]).backgroundColor);
    await expect(getComputedStyle(cards[0].querySelector("strong")!).color).not.toBe(getComputedStyle(cards[1].querySelector("strong")!).color);
    await expect(getComputedStyle(cards[0].querySelector("span")!).color).toBe(getComputedStyle(cards[2].querySelector("span")!).color);
  },
};
export const EmptyInsightToneTest: Story = {
  args: { homeInsightState: "empty" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const cards = [...canvasElement.querySelectorAll(".home-insights__card")];
    for (const card of cards) {
      await expect(card.querySelector("strong")).toHaveTextContent("0건");
      await expect(getComputedStyle(card).backgroundColor).toBe(getComputedStyle(cards[2]).backgroundColor);
      await expect(getComputedStyle(card.querySelector("strong")!).color).toBe(getComputedStyle(cards[2].querySelector("strong")!).color);
    }
  },
};
export const InsightEvidenceTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const summary = within(canvas.getByRole("region", { name: "프로젝트 요약" }));
    const open = summary.getByRole("button", { name: /3일 이상 기다리는 리뷰/ });
    await expect(open).toHaveTextContent("6건");
    await expect(open).not.toHaveTextContent("항목 보기");
    const before = canvasElement.querySelector(".home-page")!.getBoundingClientRect().width;
    await userEvent.click(open);
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole(window.innerWidth < 1024 ? "dialog" : "complementary", { name: "3일 이상 기다리는 리뷰" });
    await expect(within(dialog).getAllByRole("link")).toHaveLength(6);
    for (const item of dialog.querySelectorAll(".home-insights__evidence > li")) {
      const row = item.querySelector("a")!.getBoundingClientRect();
      const bounds = item.getBoundingClientRect();
      const border = parseFloat(getComputedStyle(item).borderTopWidth);
      await expect(row.top - bounds.top - border).toBeGreaterThanOrEqual(4);
      await expect(bounds.bottom - row.bottom).toBeGreaterThanOrEqual(4);
    }
    await expect(within(dialog).queryByText("계산 기준")).not.toBeInTheDocument();
    await expect(within(dialog).getAllByRole("time")).toHaveLength(6);
    if (window.innerWidth >= 1024) {
      await expect(canvasElement.querySelector(".home-page")!.getBoundingClientRect().width).toBeLessThan(before);
      const separator = within(dialog).getByRole("separator", { name: "분석 패널 너비 조절" });
      const width = Number(separator.getAttribute("aria-valuenow"));
      separator.focus();
      await userEvent.keyboard("{ArrowLeft}");
      await expect(Number(separator.getAttribute("aria-valuenow"))).toBe(Math.min(width + 16, Number(separator.getAttribute("aria-valuemax"))));
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(open).toHaveFocus());
  },
};
export const TitleTruncationTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const title = "문서 검색 결과의 키보드 탐색과 스크린 리더 안내를 개선하고 접근성 회귀 테스트 기준을 정의합니다";
    const review = canvas.getByRole("button", { name: new RegExp(title) });
    const text = review.querySelector("strong")!;
    await expect(getComputedStyle(text).whiteSpace).toBe("nowrap");
    await expect(getComputedStyle(text).textOverflow).toBe("ellipsis");
    await expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    if (review.closest(".home-task-panel")!.clientWidth > 420) {
      const gap = review.querySelector(".home-task-row__aside")!.getBoundingClientRect().left - review.querySelector(".home-task-row__body")!.getBoundingClientRect().right;
      await expect(gap).toBeGreaterThanOrEqual(24);
    }
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.hover(review);
    const row = review.getBoundingClientRect();
    const pointer = { clientX: row.left + 24, clientY: row.top + row.height / 2 };
    await userEvent.pointer({ target: review, coords: pointer });
    const tooltip = await page.findByRole("tooltip");
    await expect(tooltip).toHaveTextContent(title);
    if (pointer.clientX + 12 + tooltip.offsetWidth <= window.innerWidth - 8) {
      await waitFor(() => expect(Math.abs(tooltip.getBoundingClientRect().left - pointer.clientX - 12)).toBeLessThanOrEqual(1));
    } else {
      await waitFor(() => expect(tooltip.getBoundingClientRect().left).toBeGreaterThanOrEqual(8));
      await expect(tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth - 8);
    }
    await userEvent.pointer({ target: review, coords: { clientX: pointer.clientX + 40, clientY: pointer.clientY } });
    if (pointer.clientX + 52 + tooltip.offsetWidth <= window.innerWidth - 8) {
      await waitFor(() => expect(Math.abs(tooltip.getBoundingClientRect().left - pointer.clientX - 52)).toBeLessThanOrEqual(1));
    } else {
      await expect(tooltip.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
      await expect(tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth - 8);
    }
    await userEvent.unhover(review);
    await userEvent.keyboard("{Escape}");
    review.focus();
    await expect(await page.findByRole("tooltip")).toHaveTextContent(title);
  },
};
export const ReviewEntryTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("region", { name: "나에게 요청된 리뷰" })).toBeVisible();
    await expect(within(canvas.getByRole("region", { name: "내 담당 Issue" })).getByRole("link", { name: /문서 검색 결과에 키보드 탐색 추가/ })).toHaveAttribute("href", "https://github.com/mockly/product/issues/28");
    const review = within(canvas.getByRole("region", { name: "나에게 요청된 리뷰" })).getByRole("button", { name: /지도 검색 API 계약/ });
    const smallPanel = review.closest(".home-task-panel")!;
    await expect(smallPanel.querySelectorAll("li")).toHaveLength(1);
    await expect(smallPanel.querySelector("nav")).toBeNull();
    await expect((smallPanel.querySelector("ul") as HTMLElement).style.minHeight).toBe("");
    const source = review.querySelector(".home-task-row__source")!.getBoundingClientRect();
    const timestamp = review.querySelector("time")!.getBoundingClientRect();
    if (review.closest(".home-task-panel")!.clientWidth > 420) await expect(timestamp.left).toBeGreaterThanOrEqual(source.right);
    else await expect(timestamp.left).toBeGreaterThanOrEqual(review.querySelector("strong")!.getBoundingClientRect().right);
    await userEvent.click(review);
    await expect(await canvas.findByRole("region", { name: "문서 리뷰" })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "제안 문서" })).toBeVisible();
  },
};
export const EmptyEntryTest: Story = {
  args: { homeState: "empty" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "문서 둘러보기" }));
    await expect(await canvas.findByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "새 문서" })).toBeVisible();
  },
};
export const PaginationTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvas }) => {
    const reviews = within(canvas.getByRole("region", { name: "나에게 요청된 리뷰" }));
    const issues = within(canvas.getByRole("region", { name: "내 담당 Issue" }));
    await expect(reviews.queryByText("리뷰 열기")).not.toBeInTheDocument();
    await expect(reviews.getAllByRole("listitem")).toHaveLength(5);
    const panel = canvas.getByRole("region", { name: "나에게 요청된 리뷰" });
    const before = panel.getBoundingClientRect().height;
    await userEvent.click(reviews.getByRole("button", { name: "다음 페이지" }));
    await expect(reviews.getByText("6–8 / 8개")).toBeVisible();
    await expect(issues.getByText("1–5 / 9개")).toBeVisible();
    await userEvent.click(issues.getByRole("button", { name: "다음 페이지" }));
    await expect(issues.getByText("6–9 / 9개")).toBeVisible();
    await expect(Math.abs(panel.getBoundingClientRect().height - before)).toBeLessThanOrEqual(1);
    await userEvent.click(reviews.getByRole("button", { name: /계정 권한 변경 정책/ }));
    await expect(await canvas.findByRole("heading", { level: 1, name: "계정 권한 변경 정책" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /PR #47/ })).toBeVisible();
  },
};
export const CompactLayoutTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    const content = canvasElement.querySelector(".home-content")!;
    const width = content.getBoundingClientRect().width;
    const review = canvas.getByRole("region", { name: "나에게 요청된 리뷰" }).getBoundingClientRect();
    const issue = canvas.getByRole("region", { name: "내 담당 Issue" }).getBoundingClientRect();
    await expect(canvas.queryByRole("region", { name: "최근 활동" })).not.toBeInTheDocument();
    if (width >= 640) {
      await expect(review.top).toBe(issue.top);
      await expect(issue.left).toBeGreaterThan(review.right);
    } else {
      await expect(issue.top).toBeGreaterThanOrEqual(review.bottom);
    }
    for (const item of canvasElement.querySelectorAll<HTMLElement>(".home-task-panel__list > li")) {
      const row = item.querySelector(".home-task-row")!;
      await expect(item.getBoundingClientRect().height - row.getBoundingClientRect().height).toBeLessThanOrEqual(9);
    }
    for (const list of canvasElement.querySelectorAll(".home-task-panel__list")) {
      const first = list.firstElementChild!;
      const row = first.querySelector(".home-task-row")!.getBoundingClientRect();
      const innerGap = first.getBoundingClientRect().bottom - row.bottom;
      await expect(row.top - list.getBoundingClientRect().top).toBe(innerGap);
      const lastRow = list.lastElementChild!.querySelector(".home-task-row")!.getBoundingClientRect();
      await expect(list.getBoundingClientRect().bottom - lastRow.bottom).toBe(innerGap);
    }
    await expect(canvas.queryByText("GitHub에서 열기", { exact: true })).not.toBeInTheDocument();
    for (const panel of canvasElement.querySelectorAll<HTMLElement>(".home-task-panel")) {
      if (panel.clientWidth > 420) continue;
      for (const source of panel.querySelectorAll(".home-task-row__source")) await expect(source).not.toBeVisible();
      for (const extra of panel.querySelectorAll(".home-task-row__extra, .home-activity-row__actor")) await expect(extra).not.toBeVisible();
      for (const row of panel.querySelectorAll(".home-task-row")) {
        await expect(row.querySelector(".home-task-row__date")).toBeVisible();
        await expect(row.querySelector("strong")).toBeVisible();
      }
    }
  },
};
export const TwoLineAlignmentTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const layout = canvasElement.querySelector<HTMLElement>(".home-tasks")!;
    layout.style.gridTemplateColumns = "minmax(0, 1fr)";
    await new Promise(requestAnimationFrame);
    for (const row of layout.querySelectorAll(".home-task-row")) {
      const title = row.querySelector("strong")!.getBoundingClientRect();
      const source = row.querySelector(".home-task-row__source")!.getBoundingClientRect();
      const aside = row.querySelector(".home-task-row__aside")!;
      const first = aside.firstElementChild!.getBoundingClientRect();
      const time = aside.lastElementChild!.getBoundingClientRect();
      await expect(Math.abs((title.top + title.height / 2) - (first.top + first.height / 2))).toBeLessThanOrEqual(1);
      await expect(Math.abs((source.top + source.height / 2) - (time.top + time.height / 2))).toBeLessThanOrEqual(1);
    }
  },
};
export const CompactRowHeightTest: Story = {
  args: { homeListSize: "many" }, tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const layout = canvasElement.querySelector<HTMLElement>(".home-tasks")!;
    layout.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    layout.style.maxWidth = "800px";
    await new Promise(requestAnimationFrame);
    for (const row of layout.querySelectorAll(".home-task-row")) {
      await expect(row.getBoundingClientRect().height).toBe(50);
    }
  },
};
export const PageInsetTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvasElement }) => {
    const page = canvasElement.querySelector<HTMLElement>(".home-page")!;
    page.style.width = "1800px";
    const bounds = page.getBoundingClientRect();
    const content = page.firstElementChild!.getBoundingClientRect();
    const style = getComputedStyle(page);
    await expect(content.left - bounds.left).toBe(parseFloat(style.paddingLeft));
    await expect(bounds.right - content.right).toBe(parseFloat(style.paddingRight));
  },
};
