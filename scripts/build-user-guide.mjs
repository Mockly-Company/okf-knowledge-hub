import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const textOf = value => Array.isArray(value) ? value.map(textOf).join("") : isValidElement(value) ? textOf(value.props.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";

function renderChapter(chapter) {
  const toc = [];
  const ids = new Map();
  const heading = level => ({ children }) => {
    const text = textOf(children);
    // Keep existing document-section links working.
    const prefix = chapter.id === "documents" ? "" : chapter.id + "-";
    const base = prefix + (text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-") || "section");
    const count = (ids.get(base) ?? 0) + 1;
    ids.set(base, count);
    const id = count === 1 ? base : base + "-" + count;
    if (level === 2) toc.push({ id, text });
    return createElement("h" + (level + 1), { id, tabIndex: -1, className: level === 1 ? "chapter-title" : undefined, "data-guide-section": level === 2 ? "" : undefined }, children);
  };
  const body = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm], skipHtml: true,
    components: {
      h1: heading(1), h2: heading(2), h3: heading(3),
      table: ({ children }) => createElement("div", { className: "table-scroll", tabIndex: 0, role: "group", "aria-label": "표 가로 스크롤" }, createElement("table", null, children)),
    },
  }, chapter.markdown));
  const links = toc.map(item => '<a data-section-link href="#' + encodeURIComponent(item.id) + '">' + escape(item.text) + "</a>").join("\n");
  const download = Buffer.from(chapter.markdown, "utf8").toString("base64");
  return {
    navigation: '<nav data-toc-for="' + escape(chapter.id) + '" aria-label="' + escape(chapter.label) + ' 목차"><p class="toc-group">' + escape(chapter.label) + "</p>" + links + "</nav>",
    panel: '<section class="chapter" id="' + escape(chapter.id) + '" role="tabpanel" tabindex="0" aria-labelledby="tab-' + escape(chapter.id) + '"><div class="chapter-tools"><a href="data:text/markdown;charset=utf-8;base64,' + download + '" download="okhub-guide-' + escape(chapter.id) + '.md">이 가이드의 Markdown 내려받기</a></div>' + body + "</section>",
  };
}

export function renderGuide(input) {
  const chapters = typeof input === "string" ? [{ id: "documents", label: "문서", markdown: input }] : input;
  const rendered = chapters.map(renderChapter);
  const tabs = chapters.map((chapter, index) => '<button type="button" role="tab" id="tab-' + escape(chapter.id) + '" aria-controls="' + escape(chapter.id) + '" aria-selected="' + (index === 0) + '" tabindex="' + (index === 0 ? 0 : -1) + '">' + escape(chapter.label) + "</button>").join("\n");
  return [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="description" content="OkHub 기능별 사용 가이드: 시작하기, 문서 작성과 리뷰, 프로젝트"><title>OkHub 사용 가이드</title>',
    '<link rel="stylesheet" href="user-guide/assets/guide.css"><script src="user-guide/assets/guide.js" defer></script></head>',
    '<body><a class="skip" href="#content">본문으로 건너뛰기</a><div class="layout">',
    '<aside class="sidebar"><div class="sidebar-inner"><div class="brand"><span class="brand-mark" aria-hidden="true">OK</span>OkHub</div>',
    '<details class="guide-menu" open><summary><span>가이드 메뉴</span><span data-current-guide>시작하기</span></summary>',
    '<div class="guide-categories" role="tablist" aria-label="가이드 분류" aria-orientation="vertical">', tabs,
    '</div><div class="sidebar-label" id="toc-label">사용 가이드 목차</div><div class="toc">',
    rendered.map(item => item.navigation).join("\n"),
    '</div></details></div></aside><div class="reading"><header class="tools"><span class="scope">OkHub · 기능별 사용 안내</span><button type="button" id="print">인쇄 / PDF</button></header>',
    '<h1 class="guide-title">사용 가이드</h1><main id="content" tabindex="-1">', rendered.map(item => item.panel).join("\n"),
    '</main><footer class="footer">OkHub · 기능별 사용 가이드</footer></div></div>',
    '<noscript><p class="noscript">JavaScript가 꺼져 있어 모든 분류를 순서대로 표시합니다.</p></noscript></body></html>\n',
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(new URL("../docs/user-guide/sections.json", import.meta.url), "utf8"));
  const chapters = await Promise.all(config.map(async chapter => ({ ...chapter, markdown: await readFile(new URL("../docs/user-guide/" + chapter.file, import.meta.url), "utf8") })));
  const output = new URL("../docs/user-guide.html", import.meta.url);
  const html = renderGuide(chapters);
  if (process.argv.includes("--check")) {
    if (await readFile(output, "utf8") !== html) throw new Error("사용 가이드 HTML을 다시 생성해주세요: node scripts/build-user-guide.mjs");
    console.log("사용 가이드 HTML이 분류별 Markdown 원본과 일치합니다.");
  } else {
    await writeFile(output, html, "utf8");
    console.log(fileURLToPath(output));
  }
}
