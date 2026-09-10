import { expect, test, type Page } from "@playwright/test";

async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator(".markdown-document, .mermaid-block").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
}

test("comfortable markdown", async ({ page }) => {
  await openStory(page, "documents-markdowndocument--default");
  await expect(page.getByRole("button", { name: "다이어그램 크게 보기" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-density", "default");
  await expect(page.locator(".markdown-document")).toHaveScreenshot(
    "markdown-default.png",
    { animations: "disabled" },
  );
});

test("compact markdown", async ({ page }) => {
  await openStory(page, "documents-markdowndocument--compact-density");
  await expect(page.getByRole("button", { name: "다이어그램 크게 보기" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator(".markdown-document")).toHaveScreenshot(
    "markdown-compact.png",
    { animations: "disabled" },
  );
});

test("fenced search matches have consistent readable colors across syntax and plain text", async ({ page }) => {
  await openStory(page, "documents-markdowndocument--code-and-table");
  await page.evaluate(async () => {
    const fixturePath = "/tests/visual/fixtures/code-search-matches.tsx";
    const { renderCodeSearchMatches } = await import(fixturePath);
    renderCodeSearchMatches();
  });
  const fixture = page.getByTestId("code-search-matches");
  await expect(fixture.locator(".markdown-code-block")).toHaveCount(2);
  await expect(fixture.locator(".hljs-keyword mark")).toHaveText("const");
  await expect(fixture.locator(".hljs-string mark")).toHaveText('"ok"');
  const colors = await fixture.locator("mark").evaluateAll((marks) => marks.map((mark) => {
    const style = getComputedStyle(mark);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
        const srgb = channel / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return {
      color: style.color,
      background: style.backgroundColor,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  }));
  expect(colors.length).toBeGreaterThan(2);
  for (const color of colors) {
    expect(color.contrast).toBeGreaterThanOrEqual(4.5);
    expect(color.color).toBe(colors[0].color);
    expect(color.background).toBe(colors[0].background);
    expect(color.background).not.toBe("rgba(0, 0, 0, 0)");
  }
  for (const block of await fixture.locator(".markdown-code-block").all()) {
    await expect(block.locator("mark[data-search-match]")).toHaveCount(1);
    await expect(block.locator("code")).toHaveText('const value = "ok";');
  }
});

for (const [density, story, fontSize, lineHeight] of [
  ["default", "default", "13px", "20px"],
  ["compact", "compact-density", "12px", "18px"],
]) {
  test(`${density}: canonical code typography`, async ({ page }) => {
    await openStory(page, `documents-markdowndocument--${story}`);
    await expect(page.locator("html")).toHaveAttribute("data-density", density);
    const codeElements = page.locator(".markdown-code-block__scroll pre, .markdown-code-block__code, .markdown-document :not(pre) > code");
    expect(await codeElements.count()).toBeGreaterThan(2);
    for (const code of await codeElements.all()) {
      await expect(code).toHaveCSS("font-size", fontSize);
      await expect(code).toHaveCSS("line-height", lineHeight);
    }
  });
}

test("mobile: long invalid Mermaid source scrolls locally with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "documents-mermaidblock--invalid-source");
  await expect(page.getByRole("alert")).toHaveText("다이어그램을 표시할 수 없습니다.");
  const region = page.getByRole("region", { name: "다이어그램 원문 가로 스크롤" });
  await expect(region).toBeVisible();
  const bounds = await region.evaluate((element) => ({
    right: element.getBoundingClientRect().right,
    width: element.clientWidth,
    contentWidth: element.scrollWidth,
    overflow: getComputedStyle(element).overflowX,
  }));
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(bounds.contentWidth).toBeGreaterThan(bounds.width);
  expect(bounds.overflow).toBe("auto");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.keyboard.press("Tab");
  await expect(region).toBeFocused();
  await region.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(region.locator("code")).toContainText("long-invalid-source-");
  await expect(page.getByRole("button", { name: "다이어그램 크게 보기" })).toHaveCount(0);
});

// Viewport coverage is a test matrix, never a duplicate or viewport-pinned story.
for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "layout-boundary", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name}: code and table overflow stays local`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openStory(page, "documents-markdowndocument--code-and-table");
    await expect(page.getByRole("table")).toBeVisible();
    const wrappers = page.locator(".markdown-code-block__scroll, .markdown-table-scroll");
    await expect(wrappers).toHaveCount(2);
    for (const wrapper of await wrappers.all()) {
      const bounds = await wrapper.evaluate((element) => ({
        right: element.getBoundingClientRect().right,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
        overflow: getComputedStyle(element).overflowX,
      }));
      expect(bounds.right).toBeLessThanOrEqual(viewport.width);
      expect(bounds.contentWidth).toBeGreaterThan(bounds.width);
      expect(bounds.overflow).toBe("auto");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator("html")).toHaveAttribute("data-density", "default");
    const tableScroll = page.getByLabel("표 가로 스크롤");
    await expect(tableScroll).toBeFocused();
    await tableScroll.press("ArrowRight");
    await expect.poll(() => tableScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const codeScroll = page.getByRole("region", { name: "코드 가로 스크롤" });
    await codeScroll.focus();
    await codeScroll.press("ArrowRight");
    await expect.poll(() => codeScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test(`${viewport.name}: native details keyboard toggling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openStory(page, "documents-markdowndocument--alerts-and-details");
    const summary = page.locator(".markdown-document__details-summary");
    const details = page.locator(".markdown-document__details");
    await expect(page.locator(".markdown-story")).toHaveAttribute("data-interactions", "complete");
    await summary.focus();
    await expect(summary).toBeFocused();
    await expect(details).toHaveAttribute("open", "");
    await summary.press("Enter");
    await expect(details).not.toHaveAttribute("open");
    await summary.press("Space");
    await expect(details).toHaveAttribute("open", "");
    await expect(page.getByText(/MAP_PROVIDER_UNAVAILABLE/)).toBeVisible();
  });

  test(`${viewport.name}: heading and footnote links navigate to real targets`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openStory(page, "documents-markdowndocument--typography-and-lists");
    await expect(page.getByRole("link", { name: "API 안내" })).toBeFocused();
    const headingLink = page.getByRole("link", { name: "응답 규칙으로 이동" });
    await headingLink.focus();
    await headingLink.press("Enter");
    await expect(page).toHaveURL(/#%EC%9D%91%EB%8B%B5-%EA%B7%9C%EC%B9%99$/);
    await expect(page.locator('[id="응답-규칙"]')).toBeInViewport();

    await openStory(page, "documents-markdowndocument--images-and-footnotes");
    const reference = page.locator("a[data-footnote-ref]");
    const back = page.locator("a[data-footnote-backref]");
    await expect(back).toBeFocused();
    await reference.focus();
    await reference.press("Enter");
    const destination = await reference.getAttribute("href");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(destination);
    await expect(page.locator(`[id="${destination!.slice(1)}"]`)).toBeInViewport();
    await back.focus();
    await back.press("Enter");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(await back.getAttribute("href"));
    await expect(reference).toBeInViewport();
  });

  test(`${viewport.name}: wide diagram remains contained and expands`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openStory(page, "documents-mermaidblock--wide-diagram");
    const expand = page.getByRole("button", { name: "다이어그램 크게 보기" });
    await expect(expand).toBeVisible();
    // The story play function may exercise and close its dialog first.
    await expect(expand).toBeFocused();
    await expand.press("Enter");
    const dialog = page.getByRole("dialog", { name: "다이어그램 크게 보기" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "화면에 맞춤" }).click();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(expand).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
