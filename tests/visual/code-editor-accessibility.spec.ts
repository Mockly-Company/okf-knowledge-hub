import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const width of [390, 1024, 1440]) {
  for (const story of ["pages-documenteditor--publication-flow", "patterns-app-frame-preview--default&args=screen:editor"]) {
    test(`code scroll keyboard and accessibility: ${story} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/iframe.html?id=${story}&viewMode=story`);
      const block = page.getByRole("group", { name: "코드 블록", exact: true }).first();
      const scroller = block.getByRole("group", { name: "코드 가로 스크롤" });
      await block.getByRole("button", { name: "코드 블록 삭제" }).focus();
      await page.keyboard.press("Tab");
      await expect(scroller).toBeFocused();
      const overflows = await scroller.evaluate(e => e.scrollWidth > e.clientWidth);
      if (overflows) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scroller.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
        await expect(scroller).toBeFocused();
      }
      await page.keyboard.press("Tab");
      const input = block.getByRole("textbox", { name: "코드 내용" });
      await expect(input).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.type(" keyboard-check");
      await expect(input).toContainText("keyboard-check");
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        return (await axe.run(document.querySelector("#storybook-root")!)).violations;
      });
      expect(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    });
  }
}
