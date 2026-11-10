import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const captures = "/tmp/okhub-audit-captures";
mkdirSync(captures, { recursive: true });
test.describe.configure({ mode: "parallel" });

const screens = [
  ["pages-homepage--default", "#home-title"],
  ["pages-projectpage--default", '[aria-label="계층 보기"]'],
  ["pages-settingspage--display", "fieldset"],
  ["pages-settingspage--connections", ".github-account-card"],
  ["pages-settingspage--app-information", "dl"],
  ["pages-settingspage--logout-confirmation", '[role="alertdialog"]'],
  ["pages-documentspage--home", ".document-search__result-row"],
  ["pages-documentspage--search-results", "mark"],
  ["pages-documentspage--empty-search", ".document-search__empty"],
  ["pages-documentdetail--default", ".mermaid-block__svg svg"],
  ["pages-documenteditor--rich", '[contenteditable="true"]'],
  ["pages-documenteditor--source", "textarea"],
  ["pages-documenteditor--save-error", '[role="alert"]'],
  ["pages-newdocument--default", '[role="dialog"]'],
  ["patterns-appshell--reauthentication-required", '[data-feedback-variant="banner"]'],
  ["patterns-appsidebar--tree-expanded", '[role="treeitem"][aria-selected="true"]'],
  ["documents-markdowndocument--typography-and-lists", ".markdown-document ul"],
  ["documents-markdowndocument--alerts-and-details", '.markdown-story[data-interactions="complete"]'],
  ["documents-markdowndocument--code-and-table", ".markdown-table-scroll"],
  ["documents-mermaidblock--expanded", '[role="dialog"][data-interactions="complete"]'],
] as const;

for (const density of ["default", "compact"]) {
  for (const [width, height] of [[1440, 900], [1024, 768], [1023, 768], [768, 768], [720, 600]]) {
    for (const [story, ready] of screens) {
      test(`${story} ${density} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=displayDensity:${density}`);
        await page.locator(ready).first().waitFor({ state: "visible" });
        if (story === "pages-documentspage--home" || story === "pages-documentdetail--default") {
          await page.locator('#storybook-root[data-review-ready="true"]').waitFor();
        }
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("html")).toHaveAttribute("data-density", density);
        // Overlay sidebar behavior is inspected separately; reveal page content here.
        const collapse = page.getByRole("button", { name: "사이드바 접기" });
        if (width < 1024 && await collapse.isVisible() && !await page.locator('[role="dialog"], [role="alertdialog"]').count()) await collapse.click();
        const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("html, .app-shell__main")].map((element) => ({ width: element.clientWidth, content: element.scrollWidth })));
        for (const box of overflow) expect(box.content).toBeLessThanOrEqual(box.width + 1);
        const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
        if (await dialog.count()) {
          const box = await dialog.first().boundingBox();
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
          await expect(dialog.first().getByRole("button", { name: /취소|닫기/ }).first()).toBeVisible();
        }
        await page.screenshot({ path: `${captures}/${story}-${density}-${width}.png`, animations: "disabled" });
      });
    }
  }
}

test("all toast tones share a borderless surface", async ({ page }) => {
  for (const tone of ["success", "warning", "error"]) {
    await page.goto(`/iframe.html?id=ui-statusfeedback--${tone}-toast&viewMode=story`);
    const toast = page.locator('[data-feedback-variant="toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS("border-top-width", "0px");
    await expect(toast).toHaveCSS("border-bottom-width", "0px");
  }
});

test("sidebar changes from reserved column to overlay at 1023px", async ({ page }) => {
  await page.goto('/iframe.html?id=pages-homepage--default');
  const sidebar = page.locator('.frame-prototype__sidebar');
  await expect(sidebar).toBeVisible();
  for (const width of [1440, 1024, 1023, 768, 720]) {
    await page.setViewportSize({ width, height: 768 });
    // The modal drawer intentionally hides the background from accessibility queries.
    const mainRegion = page.getByRole('main', { name: '작업 공간', includeHidden: true });
    if (width >= 1024) {
      await expect(sidebar).toBeVisible();
      const navigation = await sidebar.boundingBox();
      await expect.poll(async () => (await mainRegion.boundingBox())?.x).toBe(navigation!.width);
      const main = await mainRegion.boundingBox();
      expect(navigation!.width).toBe(264);
      expect(main!.x).toBe(navigation!.width);
    } else {
      await expect(sidebar).toHaveCount(0);
      await page.getByRole('button', { name: '탐색 메뉴 열기' }).click();
      const drawer = page.getByRole('dialog', { name: '탐색 메뉴' });
      await expect(drawer).toHaveCSS('position', 'fixed');
      await expect.poll(async () => (await mainRegion.boundingBox())?.x).toBe(0);
      const main = await mainRegion.boundingBox();
      expect(main!.x).toBe(0);
      expect(main!.width).toBe(width);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '탐색 메뉴 열기' })).toBeFocused();
    }
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '탐색 메뉴' })).toBeVisible();
  await expect(page.getByRole('button', { name: '탐색 메뉴 닫기' })).toBeFocused();
});

test("feedback action follows its container width at a fixed desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const story of ["warning-banner-action", "error-content-action"]) {
    await page.goto(`/iframe.html?id=ui-statusfeedback--${story}&viewMode=story`);
    const feedback = page.locator('[data-feedback-action-placement="end"]');
    await expect(feedback).toBeVisible();
    for (const width of [900, 400, 900]) {
      await feedback.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, width);
      const title = await feedback.locator("strong").boundingBox();
      const action = await feedback.locator("[data-feedback-action]").boundingBox();
      const box = await feedback.boundingBox();
      expect(title && action && box).toBeTruthy();
      if (width === 400) expect(action!.y).toBeGreaterThan(title!.y + title!.height);
      else expect(Math.abs(action!.y - title!.y)).toBeLessThan(24);
      expect(action!.x + action!.width).toBeLessThanOrEqual(box!.x + box!.width);
      expect(action!.x + action!.width).toBeGreaterThan(box!.x + box!.width - 20);
    }
  }
});

for (const density of ["default", "compact"]) {
  test(`editor keeps semantic lists and density-aware controls ${density}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=pages-documenteditor--rich&globals=displayDensity:${density}`);
    const editor = page.getByRole('textbox', { name: 'editable markdown', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.locator("h1")).toBeHidden();
    expect(await editor.locator("ul").count()).toBeGreaterThan(0);
    for (const list of await editor.locator("ul").all()) await expect(list).toHaveCSS("list-style-type", "disc");
    await expect(page.locator('.mdxeditor-toolbar svg').first()).toHaveCSS("width", density === "compact" ? "14px" : "16px");
    await expect(page.getByLabel("문서 제목")).toHaveCSS("padding-left", "4px");
  });

  test(`Mermaid labels center and arrow tips meet node boundaries ${density}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=documents-mermaidblock--default&globals=displayDensity:${density}`);
    const svg = page.locator('.mermaid-block__svg svg');
    await expect(svg).toBeVisible();
    const geometry = await svg.evaluate((svg) => {
      const nodes = [...svg.querySelectorAll('.node')].map(node => ({shape: node.querySelector('.label-container')!.getBoundingClientRect(), label: node.querySelector('text')!.getBoundingClientRect()}));
      const tips = [...svg.querySelectorAll<SVGPathElement>('.flowchart-link')].map(edge => {
        const point = edge.getPointAtLength(edge.getTotalLength());
        const markerId = edge.getAttribute('marker-end')!.match(/#([^)]*)/)![1];
        const marker = document.getElementById(markerId) as unknown as SVGMarkerElement;
        const matrix = edge.getScreenCTM()!;
        const tip = new DOMPoint(point.x + (10 - marker.refX.baseVal.value) * marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width, point.y).matrixTransform(matrix);
        return Math.min(...nodes.filter(node => node.shape.x > edge.getBoundingClientRect().x).map(node => Math.abs(node.shape.x - tip.x)));
      });
      return { tips, centers: nodes.map(node => Math.abs(node.shape.x + node.shape.width / 2 - node.label.x - node.label.width / 2)) };
    });
    for (const gap of geometry.tips) expect(gap).toBeLessThan(1);
    for (const offset of geometry.centers) expect(offset).toBeLessThan(1);
    await page.screenshot({ path: `${captures}/mermaid-${density}.png`, animations: "disabled" });
  });
}
