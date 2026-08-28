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
    `http://127.0.0.1:${address.port}/iframe.html?id=ui-button--primary&viewMode=story`,
    { waitUntil: "networkidle" },
  );

  const primaryButton = page.getByRole("button", { name: "저장", exact: true });

  try {
    await primaryButton.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const previewText = await page.locator("body").innerText();
    throw new Error(`UI/Button Primary did not render. Preview output:\n${previewText}`, {
      cause: error,
    });
  }

  console.log("Built Storybook smoke passed: UI/Button Primary rendered.");

  await page.goto(
    `http://127.0.0.1:${address.port}/iframe.html?id=pages-documentspage--multiline-search-result&viewMode=story`,
    { waitUntil: "networkidle" },
  );

  await page.getByRole("searchbox", { name: "문서 검색" }).fill("응답 DTO");

  const documentResult = page.getByRole("button", {
    name: /여러 줄로 이어지는 지도 검색 API 계약 제목/,
  });
  await documentResult.waitFor({ state: "visible", timeout: 10_000 });

  const copy = documentResult.locator(".document-search__result-copy");
  const icon = documentResult.locator("svg").first();
  const [rowBox, copyBox, iconBox] = await Promise.all([
    documentResult.boundingBox(),
    copy.boundingBox(),
    icon.boundingBox(),
  ]);

  if (!rowBox || !copyBox || !iconBox) {
    throw new Error("Multiline document result did not expose row, copy, and icon bounds");
  }

  if (
    rowBox.height <= 36 ||
    copyBox.x <= rowBox.x ||
    copyBox.y > iconBox.y ||
    copyBox.x + copyBox.width > rowBox.x + rowBox.width ||
    copyBox.y + copyBox.height > rowBox.y + rowBox.height
  ) {
    throw new Error("Multiline document result escaped or failed to start-align within its row");
  }

  console.log("Built Storybook smoke passed: multiline document result stays contained.");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
