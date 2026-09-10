import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const storybookRoot = resolve("storybook-static");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    let filePath = resolve(storybookRoot, `.${requestedPath}`);

    if (filePath !== storybookRoot && !filePath.startsWith(`${storybookRoot}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    if ((await stat(filePath)).isDirectory()) {
      filePath = resolve(filePath, "index.html");
    }

    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});

const address = server.address();
if (!address || typeof address === "string") {
  server.close();
  throw new Error("Built Storybook smoke server did not expose a TCP port");
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${address.port}/iframe.html?id=ui-button--default&viewMode=story`,
    { waitUntil: "networkidle" },
  );

  const primaryButton = page.getByRole("button", { name: "저장", exact: true });

  try {
    await primaryButton.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const previewText = await page.locator("body").innerText();
    throw new Error(`UI/Button Default did not render. Preview output:\n${previewText}`, {
      cause: error,
    });
  }

  console.log("Built Storybook smoke passed: UI/Button Default rendered.");

  await page.goto(
    `http://127.0.0.1:${address.port}/iframe.html?id=documents-markdowndocument--code-and-table&viewMode=story`,
    { waitUntil: "networkidle" },
  );

  await page.getByRole("table").waitFor({ state: "visible", timeout: 10_000 });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await page.evaluate(() => {
      const article = document.querySelector(".markdown-document");
      const wrappers = [...document.querySelectorAll(".markdown-code-block__scroll, .markdown-table-scroll")];
      return {
        pageWidth: document.documentElement.scrollWidth,
        articleRight: article?.getBoundingClientRect().right ?? Infinity,
        wrappers: wrappers.map((element) => ({
          right: element.getBoundingClientRect().right,
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          overflow: getComputedStyle(element).overflowX,
        })),
      };
    });
    if (result.wrappers.length !== 2 || result.pageWidth > width || result.articleRight > width ||
      result.wrappers.some((wrapper) => wrapper.right > result.articleRight + 1 ||
        wrapper.contentWidth <= wrapper.width || wrapper.overflow !== "auto")) {
      throw new Error(`Markdown code/table overflow escaped at ${width}px: ${JSON.stringify(result)}`);
    }
    console.log(`Built Storybook smoke passed: code/table overflow contained at ${width}px.`);
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
