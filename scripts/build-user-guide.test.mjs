import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { renderGuide } from "./build-user-guide.mjs";

test("renders Markdown and a matching, uniquely anchored table of contents", () => {
  const document = new JSDOM(renderGuide("# 사용 안내\n\n## 문서 작성\n\n**자동 저장**을 확인합니다.\n\n## 문서 작성\n\n두 번째 설명입니다.")).window.document;
  assert.equal(document.querySelector(".chapter-title")?.textContent, "사용 안내");
  assert.equal(document.querySelector("main strong")?.textContent, "자동 저장");
  const links = [...document.querySelectorAll("nav a")];
  assert.equal(links.length, 2);
  assert.notEqual(links[0].hash, links[1].hash);
  for (const link of links) assert.ok(document.getElementById(decodeURIComponent(link.hash.slice(1))));
});

test("keeps tables contained and provides the exact Markdown as an offline download", () => {
  const markdown = "# 안내\n\n## 상태\n\n| 상태 | 의미 |\n| --- | --- |\n| 승인 | 검토 완료 |\n";
  const document = new JSDOM(renderGuide(markdown)).window.document;
  assert.ok(document.querySelector(".table-scroll table"));
  const download = document.querySelector("a[download]");
  assert.equal(Buffer.from(download.href.split(",")[1], "base64").toString("utf8"), markdown);
  assert.equal(document.querySelectorAll("style, script:not([src]), img[src^=http]").length, 0);
  assert.equal(document.querySelector("link[rel=stylesheet]")?.getAttribute("href"), "user-guide/assets/guide.css");
});

test("does not execute embedded HTML from the Markdown source", () => {
  const document = new JSDOM(renderGuide('# 안내\n\n<script src="https://example.invalid/x.js"></script>')).window.document;
  assert.equal(document.querySelectorAll('script[src^="https:"]').length, 0);
});

const chapters = [
  { id: "start", label: "시작하기", markdown: "# 시작하기\n\n## 첫 작업\n\n시작 안내" },
  { id: "documents", label: "문서", markdown: "# 문서 안내\n\n## 기존 문서 편집하기\n\n편집 안내" },
  { id: "projects", label: "프로젝트", markdown: "# 프로젝트 안내\n\n## 준비 상태\n\n준비 중" },
];

function interactiveGuide(hash = "", narrow = false) {
  const dom = new JSDOM(renderGuide(chapters), { url: `https://local.test/user-guide.html${hash}`, runScripts: "outside-only" });
  dom.window.matchMedia = () => ({ matches: narrow, addEventListener() {} });
  dom.window.eval(readFileSync(new URL("../docs/user-guide/assets/guide.js", import.meta.url), "utf8"));
  return dom;
}

test("switches category panels and their table of contents without mixing content", () => {
  const { window } = interactiveGuide();
  const { document } = window;
  assert.equal(document.querySelectorAll('[role="tab"]').length, 3);
  assert.ok(document.querySelector('aside [role="tablist"][aria-orientation="vertical"]'));
  assert.equal(document.querySelector('.reading [role="tablist"]'), null);
  document.getElementById("tab-documents").click();
  assert.equal(document.getElementById("documents").hidden, false);
  assert.equal(document.getElementById("start").hidden, true);
  assert.equal(document.querySelector('[data-toc-for="start"]').hidden, true);
  assert.equal(document.getElementById("tab-documents").getAttribute("aria-selected"), "true");
  document.getElementById("tab-documents").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(document.getElementById("projects").hidden, false);
  assert.equal(document.activeElement.id, "tab-projects");
});

test("collapses the mobile guide menu after selecting a category and focuses its content", () => {
  const { document } = interactiveGuide("", true).window;
  const menu = document.querySelector(".guide-menu");
  assert.equal(menu.open, false);
  menu.open = true;
  document.getElementById("tab-documents").click();
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, document.querySelector("#documents .chapter-title"));
  assert.match(document.querySelector(".guide-menu summary").textContent, /문서/);
});

test("opens the right tab for an existing document-section deep link", () => {
  const { document } = interactiveGuide(`#${encodeURIComponent("기존-문서-편집하기")}`).window;
  assert.equal(document.getElementById("documents").hidden, false);
  assert.equal(document.getElementById("start").hidden, true);
});
