# OkHub Foundation, Design System, and App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS와 Windows에서 실행할 수 있는 Tauri 2 앱 골격에 승인된 OkHub 디자인 토큰, Default/Compact 표시 밀도, 공통 사이드바와 Settings 화면을 구현한다.

**Architecture:** 저장소 루트에 Vite React SPA를 두고 `src-tauri/`에 얇은 데스크톱 shell을 둔다. UI는 `components/ui` primitive와 `components/patterns` 제품 조합을 분리하며, 표시 밀도는 `PreferencesRepository` port 뒤에서 Tauri Store에 저장하고 브라우저 개발 모드에서는 localStorage adapter를 사용한다.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, shadcn 방식의 Radix primitive, Lucide, Pretendard Variable, Tauri Store, Vitest, Testing Library, axe-core

## Global Constraints

- 초기 제품은 Light 테마만 지원한다.
- Primary는 `#009E8E`, 흰 배경의 Primary 텍스트는 `#007D72`, Primary 배경의 작은 텍스트는 `#082B28`을 사용한다.
- 로고 마크의 `OK`에만 흰색 `#FFFFFF`을 사용한다.
- 기본 서체는 `Pretendard Variable`; fallback은 `Pretendard`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`이다.
- 아이콘은 Lucide, 기본 `16px`, Compact `14px`, 기본 `strokeWidth=1.75`를 사용한다.
- 표시 밀도 초기값은 `Default`; 사용자는 `Default`와 `Compact`를 선택한다.
- 표시 밀도는 기기 로컬 설정에만 저장하고 Git과 `.okf/workspace.yml`에 기록하지 않는다.
- 앱의 전역 메뉴는 `Home / Documents / Project / Settings`이다.
- 사이드바는 완전히 접을 수 있고 macOS `Command + Backslash`, Windows `Ctrl + Backslash`로 전환한다.
- primitive는 `src/components/ui`, 제품 조합은 `src/components/patterns`에 둔다.
- macOS와 Windows를 지원하고 플랫폼별 절대 경로를 소스에 하드코딩하지 않는다.
- Node.js는 `22.12.0` 이상, pnpm은 major `10`, Rust는 `1.77.2` 이상을 사용한다.
- `.superpowers/`, `AGENTS.md`, `.DS_Store`는 stage하지 않는다.
- 이 저장소에서는 각 commit 단계 직전에 반드시 사용자 승인을 다시 받는다. 승인이 없으면 테스트 통과 상태에서 멈추고 변경 파일만 보고한다.

---

## File Structure

```text
package.json                         # JS 의존성, 개발·검증 명령
.gitignore                          # JS/Rust build와 local-only 파일 제외
components.json                      # shadcn 생성 규칙과 alias
vite.config.ts                       # React, Tailwind, Vitest와 @ alias
src/
├─ main.tsx                          # Pretendard/CSS 로드와 React 진입점
├─ app/
│  ├─ App.tsx                        # repository 선택과 최상위 provider/router
│  ├─ App.test.tsx                   # 앱 smoke test
│  └─ AppRoutes.tsx                  # HashRouter 내부 route 표
├─ components/
│  ├─ ui/
│  │  ├─ button.tsx                  # shadcn 방식 Button variant
│  │  └─ tooltip.tsx                 # 접근 가능한 icon tooltip
│  └─ patterns/
│     ├─ AppShell.tsx                # sidebar + main outlet
│     ├─ AppShell.test.tsx
│     ├─ AppSidebar.tsx              # navigation, collapse, user footer
│     └─ PagePlaceholder.tsx         # 미구현 화면의 의도적 빈 상태
├─ features/preferences/
│  ├─ display-density.ts             # DisplayDensity 타입·parser
│  ├─ display-density.test.ts
│  ├─ PreferencesRepository.ts       # 저장 port
│  ├─ PreferencesProvider.tsx        # 로드·적용·저장과 React context
│  └─ PreferencesProvider.test.tsx
├─ infrastructure/preferences/
│  ├─ BrowserPreferencesRepository.ts
│  ├─ BrowserPreferencesRepository.test.ts
│  ├─ TauriPreferencesRepository.ts
│  └─ createPreferencesRepository.ts
├─ pages/
│  ├─ HomePage.tsx
│  ├─ DocumentsPage.tsx
│  ├─ ProjectPage.tsx
│  ├─ SettingsPage.tsx
│  ├─ SettingsPage.test.tsx
│  └─ DesignSystemPage.tsx            # 개발용 component preview
├─ styles/
│  ├─ tokens.css                      # 승인된 역할 기반 token
│  ├─ color-contrast.test.ts          # WCAG AA token 대비 검사
│  └─ globals.css                     # reset, density, shell layout
├─ test/
│  ├─ setup.ts
│  └─ FakePreferencesRepository.ts
└─ lib/utils.ts                       # Tailwind class 병합
src-tauri/
├─ Cargo.toml
├─ build.rs
├─ tauri.conf.json
├─ capabilities/default.json
└─ src/
   ├─ lib.rs                          # Store plugin 등록과 run
   └─ main.rs                         # desktop binary 진입점
```

## Task 1: React/Vite 테스트 가능 골격

**Files:**
- Modify: `.gitignore`
- Create: `package.json`
- Create: `components.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/app/App.test.tsx`
- Create: `src/app/App.tsx`
- Create: `src/main.tsx`
- Create: `src/styles/globals.css`
- Generated: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 없음
- Produces: `App(): JSX.Element`, `@/* -> src/*` alias, `pnpm test:run`, `pnpm build`, `pnpm tauri`

- [ ] **Step 1: 패키지 manifest를 만들고 의존성을 설치한다**

Replace `.gitignore` with:

```gitignore
.superpowers/
/AGENTS.md
.DS_Store
node_modules/
dist/
src-tauri/target/
*.log
```

Create `package.json`:

```json
{
  "name": "okf-knowledge-hub",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "tauri": "tauri"
  }
}
```

Run:

```bash
pnpm add react@19 react-dom@19 react-router-dom@7 @tauri-apps/api@2 @tauri-apps/plugin-store@2 @radix-ui/react-slot @radix-ui/react-tooltip class-variance-authority clsx lucide-react tailwind-merge pretendard@1
pnpm add -D typescript@5 vite@7 @vitejs/plugin-react@5 @tailwindcss/vite@4 tailwindcss@4 @tauri-apps/cli@2 vitest@4 jsdom@27 @testing-library/react@16 @testing-library/jest-dom@6 @testing-library/user-event@14 @types/react@19 @types/react-dom@19 @types/node@22 axe-core@4
```

Expected: 두 명령이 exit code 0으로 끝나고 `pnpm-lock.yaml`이 생성된다.

- [ ] **Step 2: Vite, TypeScript, shadcn 경로 설정을 만든다**

Create `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Create `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["vite.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OkHub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: 먼저 실패하는 앱 smoke test를 작성한다**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the OkHub application landmark", () => {
    render(<App />);
    expect(screen.getByRole("main", { name: "OkHub" })).toBeInTheDocument();
  });
});
```

Run: `pnpm test:run src/app/App.test.tsx`
Expected: FAIL because `src/app/App.tsx` does not exist.

- [ ] **Step 4: 최소 앱 진입점을 구현한다**

Create `src/app/App.tsx`:

```tsx
export function App() {
  return <main aria-label="OkHub">OkHub</main>;
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/globals.css";
import { App } from "@/app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `src/styles/globals.css`:

```css
@import "tailwindcss";

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

body {
  font-family: "Pretendard Variable", Pretendard, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}
```

- [ ] **Step 5: test와 web build를 검증한다**

Run: `pnpm test:run src/app/App.test.tsx`
Expected: 1 test PASS.

Run: `pnpm build`
Expected: TypeScript와 Vite build가 exit code 0, `dist/index.html` 생성.

- [ ] **Step 6: 사용자 승인을 받은 경우에만 Task 1을 commit한다**

```bash
git add .gitignore package.json pnpm-lock.yaml components.json index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts src
git commit -m "chore: scaffold React application"
```

## Task 2: Tauri 2 데스크톱 shell

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `pnpm dev`, `pnpm build`
- Produces: `okhub_lib::run()`, Tauri Store `store:default` capability, desktop title `OkHub`

- [ ] **Step 1: Rust test를 포함한 Tauri crate를 작성한다**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "okhub"
version = "0.1.0"
description = "A Git-native OKF knowledge workspace"
authors = ["OkHub contributors"]
edition = "2021"
rust-version = "1.77.2"

[lib]
name = "okhub_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
```

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `src-tauri/src/lib.rs`:

```rust
pub const APP_TITLE: &str = "OkHub";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("failed to run OkHub");
}

#[cfg(test)]
mod tests {
    use super::APP_TITLE;

    #[test]
    fn application_title_matches_product_name() {
        assert_eq!(APP_TITLE, "OkHub");
    }
}
```

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    okhub_lib::run();
}
```

- [ ] **Step 2: Tauri 설정과 최소 권한을 작성한다**

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OkHub",
  "version": "0.1.0",
  "identifier": "com.okhub.desktop",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "OkHub",
        "width": 1280,
        "height": 800,
        "minWidth": 960,
        "minHeight": 640,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default desktop capability for OkHub",
  "windows": ["main"],
  "permissions": ["core:default", "store:default"]
}
```

- [ ] **Step 3: Rust test와 desktop compile을 검증한다**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `application_title_matches_product_name ... ok` and exit code 0.

Run: `pnpm tauri build --debug --no-bundle`
Expected: frontend build와 Rust compile이 exit code 0. 플랫폼 installer 생성은 이 단계에서 실행하지 않는다.

- [ ] **Step 4: 사용자 승인을 받은 경우에만 Task 2를 commit한다**

```bash
git add src-tauri
git commit -m "chore: add Tauri desktop shell"
```

## Task 3: 디자인 토큰과 Button primitive

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/color-contrast.test.ts`
- Modify: `src/styles/globals.css`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/button.test.tsx`

**Interfaces:**
- Consumes: Tailwind CSS, CVA, `cn()`
- Produces: CSS tokens, `Button`, `buttonVariants`, `ButtonProps`

- [ ] **Step 1: Button variant와 접근 가능한 이름 test를 먼저 작성한다**

Create `src/components/ui/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { Button } from "./button";

describe("Button", () => {
  it("renders a primary action", () => {
    render(<Button>연결하기</Button>);
    expect(screen.getByRole("button", { name: "연결하기" })).toHaveAttribute(
      "data-variant",
      "primary",
    );
  });

  it("supports a named icon action", () => {
    render(
      <Button variant="icon" aria-label="설정 열기">
        <Settings aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
  });
});
```

Create `src/styles/color-contrast.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing color token: ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright + 0.05) / (dark + 0.05);
}

describe("OkHub color tokens", () => {
  const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

  it.each([
    ["--color-on-primary", "--color-primary"],
    ["--color-primary-text", "--color-surface"],
    ["--color-success", "--color-surface"],
    ["--color-info", "--color-surface"],
    ["--color-warning", "--color-surface"],
    ["--color-error", "--color-surface"],
  ])("keeps %s readable on %s", (foreground, background) => {
    expect(contrast(token(css, foreground), token(css, background))).toBeGreaterThanOrEqual(4.5);
  });
});
```

Run: `pnpm test:run src/components/ui/button.test.tsx src/styles/color-contrast.test.ts`
Expected: FAIL because `button.tsx` and `tokens.css` do not exist.

- [ ] **Step 2: 승인된 역할 기반 token을 구현한다**

Create `src/styles/tokens.css`:

```css
:root {
  color-scheme: light;
  --color-primary: #009e8e;
  --color-primary-hover: #008d7f;
  --color-primary-text: #007d72;
  --color-primary-soft: #e5f5f3;
  --color-on-primary: #082b28;
  --color-on-logo: #ffffff;
  --color-text-strong: #16181d;
  --color-text-default: #343941;
  --color-text-muted: #737985;
  --color-border: #e2e5e9;
  --color-canvas: #f6f7f9;
  --color-surface: #ffffff;
  --color-success: #16845b;
  --color-success-soft: #e9f7f1;
  --color-info: #2563b5;
  --color-info-soft: #eaf2ff;
  --color-warning: #a15c00;
  --color-warning-soft: #fff4df;
  --color-error: #b23b4a;
  --color-error-soft: #fff0f1;
  --color-error-hover: #ffe2e5;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-overlay: 0 12px 28px rgba(25, 30, 38, 0.13);
  --font-ui-size: 13px;
  --font-ui-line: 20px;
  --font-document-size: 16px;
  --font-document-line: 28px;
  --font-h1-size: 28px;
  --font-h1-line: 36px;
  --control-height: 36px;
  --icon-size: 16px;
}

:root[data-density="compact"] {
  --font-ui-size: 12px;
  --font-ui-line: 18px;
  --font-document-size: 15px;
  --font-document-line: 25px;
  --font-h1-size: 24px;
  --font-h1-line: 32px;
  --control-height: 32px;
  --icon-size: 14px;
}
```

Replace `src/styles/globals.css` with:

```css
@import "tailwindcss";
@import "./tokens.css";

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

body {
  background: var(--color-canvas);
  color: var(--color-text-default);
  font-family: "Pretendard Variable", Pretendard, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: var(--font-ui-size);
  line-height: var(--font-ui-line);
}

button,
input,
textarea,
select {
  font: inherit;
}

:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 3: class 병합과 Button을 구현한다**

Create `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Create `src/components/ui/button.tsx`:

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex h-[var(--control-height)] items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-hover)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-strong)] hover:bg-[var(--color-canvas)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-default)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary-text)]",
        destructive:
          "border-transparent bg-[var(--color-error-soft)] text-[var(--color-error)] hover:bg-[var(--color-error-hover)]",
        icon:
          "w-[var(--control-height)] border-transparent bg-transparent p-0 text-[var(--color-text-default)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary-text)]",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        data-variant={variant}
        className={cn(buttonVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
```

- [ ] **Step 4: Button tests와 build를 검증한다**

Run: `pnpm test:run src/components/ui/button.test.tsx src/styles/color-contrast.test.ts`
Expected: 8 tests PASS.

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 5: 사용자 승인을 받은 경우에만 Task 3을 commit한다**

```bash
git add src/styles src/lib src/components/ui
git commit -m "feat: add OkHub design tokens and button"
```

## Task 4: 표시 밀도 domain과 저장 adapter

**Files:**
- Create: `src/features/preferences/display-density.ts`
- Create: `src/features/preferences/display-density.test.ts`
- Create: `src/features/preferences/PreferencesRepository.ts`
- Create: `src/infrastructure/preferences/BrowserPreferencesRepository.ts`
- Create: `src/infrastructure/preferences/BrowserPreferencesRepository.test.ts`
- Create: `src/infrastructure/preferences/TauriPreferencesRepository.ts`
- Create: `src/infrastructure/preferences/createPreferencesRepository.ts`
- Create: `src/test/FakePreferencesRepository.ts`

**Interfaces:**
- Consumes: Tauri Store `load("settings.json", { autoSave: false })`
- Produces: `DisplayDensity`, `parseDisplayDensity`, `PreferencesRepository`, `createPreferencesRepository()`

- [ ] **Step 1: density parser의 실패 test를 작성한다**

Create `src/features/preferences/display-density.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDisplayDensity } from "./display-density";

describe("parseDisplayDensity", () => {
  it.each(["default", "compact"])("accepts %s", (value) => {
    expect(parseDisplayDensity(value)).toBe(value);
  });

  it.each([undefined, null, "dense", 1])("falls back for %s", (value) => {
    expect(parseDisplayDensity(value)).toBe("default");
  });
});
```

Run: `pnpm test:run src/features/preferences/display-density.test.ts`
Expected: FAIL because `display-density.ts` does not exist.

- [ ] **Step 2: density type과 repository port를 구현한다**

Create `src/features/preferences/display-density.ts`:

```ts
export const DISPLAY_DENSITIES = ["default", "compact"] as const;
export type DisplayDensity = (typeof DISPLAY_DENSITIES)[number];
export const DEFAULT_DISPLAY_DENSITY: DisplayDensity = "default";

export function parseDisplayDensity(value: unknown): DisplayDensity {
  return value === "compact" || value === "default"
    ? value
    : DEFAULT_DISPLAY_DENSITY;
}
```

Create `src/features/preferences/PreferencesRepository.ts`:

```ts
import type { DisplayDensity } from "./display-density";

export interface PreferencesRepository {
  getDisplayDensity(): Promise<DisplayDensity>;
  setDisplayDensity(value: DisplayDensity): Promise<void>;
}
```

Run: `pnpm test:run src/features/preferences/display-density.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 3: 브라우저 adapter test를 작성한다**

Create `src/infrastructure/preferences/BrowserPreferencesRepository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { BrowserPreferencesRepository } from "./BrowserPreferencesRepository";

describe("BrowserPreferencesRepository", () => {
  beforeEach(() => localStorage.clear());

  it("returns default when nothing was stored", async () => {
    const repository = new BrowserPreferencesRepository(localStorage);
    await expect(repository.getDisplayDensity()).resolves.toBe("default");
  });

  it("persists compact density", async () => {
    const repository = new BrowserPreferencesRepository(localStorage);
    await repository.setDisplayDensity("compact");
    await expect(repository.getDisplayDensity()).resolves.toBe("compact");
  });
});
```

Run: `pnpm test:run src/infrastructure/preferences/BrowserPreferencesRepository.test.ts`
Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: browser/Tauri adapter와 runtime factory를 구현한다**

Create `src/infrastructure/preferences/BrowserPreferencesRepository.ts`:

```ts
import {
  parseDisplayDensity,
  type DisplayDensity,
} from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

const DISPLAY_DENSITY_KEY = "okhub.display-density";

export class BrowserPreferencesRepository implements PreferencesRepository {
  constructor(private readonly storage: Storage) {}

  async getDisplayDensity(): Promise<DisplayDensity> {
    return parseDisplayDensity(this.storage.getItem(DISPLAY_DENSITY_KEY));
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.storage.setItem(DISPLAY_DENSITY_KEY, value);
  }
}
```

Create `src/infrastructure/preferences/TauriPreferencesRepository.ts`:

```ts
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  parseDisplayDensity,
  type DisplayDensity,
} from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

const DISPLAY_DENSITY_KEY = "display-density";

export class TauriPreferencesRepository implements PreferencesRepository {
  private readonly store: Promise<Store> = load("settings.json", {
    autoSave: false,
  });

  async getDisplayDensity(): Promise<DisplayDensity> {
    const store = await this.store;
    return parseDisplayDensity(await store.get(DISPLAY_DENSITY_KEY));
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    const store = await this.store;
    await store.set(DISPLAY_DENSITY_KEY, value);
    await store.save();
  }
}
```

Create `src/infrastructure/preferences/createPreferencesRepository.ts`:

```ts
import { isTauri } from "@tauri-apps/api/core";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { BrowserPreferencesRepository } from "./BrowserPreferencesRepository";
import { TauriPreferencesRepository } from "./TauriPreferencesRepository";

export function createPreferencesRepository(): PreferencesRepository {
  return isTauri()
    ? new TauriPreferencesRepository()
    : new BrowserPreferencesRepository(window.localStorage);
}
```

Create `src/test/FakePreferencesRepository.ts`:

```ts
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

export class FakePreferencesRepository implements PreferencesRepository {
  public writes: DisplayDensity[] = [];

  constructor(private value: DisplayDensity = "default") {}

  async getDisplayDensity(): Promise<DisplayDensity> {
    return this.value;
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.value = value;
    this.writes.push(value);
  }
}
```

- [ ] **Step 5: adapter tests와 TypeScript build를 검증한다**

Run: `pnpm test:run src/features/preferences src/infrastructure/preferences`
Expected: 8 tests PASS.

Run: `pnpm build`
Expected: Tauri Store와 `isTauri` import를 포함해 exit code 0.

- [ ] **Step 6: 사용자 승인을 받은 경우에만 Task 4를 commit한다**

```bash
git add src/features/preferences src/infrastructure/preferences src/test/FakePreferencesRepository.ts
git commit -m "feat: persist local display density"
```

## Task 5: PreferencesProvider와 root density 적용

**Files:**
- Create: `src/features/preferences/PreferencesProvider.test.tsx`
- Create: `src/features/preferences/PreferencesProvider.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `PreferencesRepository`, `createPreferencesRepository()`
- Produces: `PreferencesProvider`, `usePreferences()`, root `data-density`

- [ ] **Step 1: 로드·적용·저장 동작 test를 먼저 작성한다**

Create `src/features/preferences/PreferencesProvider.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import {
  PreferencesProvider,
  usePreferences,
} from "./PreferencesProvider";

function Probe() {
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();
  return (
    <div>
      <output>{isLoading ? "loading" : displayDensity}</output>
      <button onClick={() => void setDisplayDensity("compact")}>compact</button>
    </div>
  );
}

describe("PreferencesProvider", () => {
  it("loads density and applies it to the document root", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository("compact")}>
        <Probe />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("compact")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
  });

  it("persists an explicit density change", async () => {
    const repository = new FakePreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <Probe />
      </PreferencesProvider>,
    );
    await screen.findByText("default");
    await userEvent.click(screen.getByRole("button", { name: "compact" }));
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
  });
});
```

Run: `pnpm test:run src/features/preferences/PreferencesProvider.test.tsx`
Expected: FAIL because `PreferencesProvider.tsx` does not exist.

- [ ] **Step 2: provider와 hook을 구현한다**

Create `src/features/preferences/PreferencesProvider.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  DEFAULT_DISPLAY_DENSITY,
  type DisplayDensity,
} from "./display-density";
import type { PreferencesRepository } from "./PreferencesRepository";

interface PreferencesContextValue {
  displayDensity: DisplayDensity;
  isLoading: boolean;
  setDisplayDensity(value: DisplayDensity): Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

interface PreferencesProviderProps extends PropsWithChildren {
  repository: PreferencesRepository;
}

export function PreferencesProvider({
  repository,
  children,
}: PreferencesProviderProps) {
  const [displayDensity, setDensityState] = useState<DisplayDensity>(
    DEFAULT_DISPLAY_DENSITY,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void repository.getDisplayDensity().then((value) => {
      if (!active) return;
      setDensityState(value);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    document.documentElement.dataset.density = displayDensity;
  }, [displayDensity]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      displayDensity,
      isLoading,
      async setDisplayDensity(nextValue) {
        await repository.setDisplayDensity(nextValue);
        setDensityState(nextValue);
      },
    }),
    [displayDensity, isLoading, repository],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return value;
}
```

- [ ] **Step 3: App에서 runtime repository를 한 번 생성한다**

Replace `src/app/App.tsx` with:

```tsx
import { useState } from "react";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";

export function App() {
  const [repository] = useState(createPreferencesRepository);
  return (
    <PreferencesProvider repository={repository}>
      <main aria-label="OkHub">OkHub</main>
    </PreferencesProvider>
  );
}
```

- [ ] **Step 4: provider와 앱 tests를 검증한다**

Run: `pnpm test:run src/features/preferences/PreferencesProvider.test.tsx src/app/App.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: 사용자 승인을 받은 경우에만 Task 5를 commit한다**

```bash
git add src/features/preferences/PreferencesProvider.tsx src/features/preferences/PreferencesProvider.test.tsx src/app/App.tsx
git commit -m "feat: apply display density preference"
```

## Task 6: 공통 AppShell, route와 sidebar

**Files:**
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/patterns/PagePlaceholder.tsx`
- Create: `src/components/patterns/AppSidebar.tsx`
- Create: `src/components/patterns/AppShell.tsx`
- Create: `src/components/patterns/AppShell.test.tsx`
- Create: `src/app/AppRoutes.tsx`
- Create: `src/pages/HomePage.tsx`
- Create: `src/pages/DocumentsPage.tsx`
- Create: `src/pages/ProjectPage.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/globals.css`

**Interfaces:**
- Consumes: `Button`, React Router, Lucide
- Produces: hash routes `/`, `/documents`, `/project`, `/settings`, `/dev/design-system`; collapsible `AppShell`

- [ ] **Step 1: navigation과 collapse test를 먼저 작성한다**

Create `src/components/patterns/AppShell.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<h1>프로젝트 진행 상황</h1>} />
          <Route path="documents" element={<h1>Documents</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("navigates without leaving the application", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("link", { name: "Documents" }));
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  });

  it("collapses and restores the sidebar", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "사이드바 열기" }));
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("toggles the sidebar with the platform shortcut", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });
});
```

Run: `pnpm test:run src/components/patterns/AppShell.test.tsx`
Expected: FAIL because `AppShell.tsx` does not exist.

- [ ] **Step 2: Tooltip과 placeholder primitive를 구현한다**

Create `src/components/ui/tooltip.tsx`:

```tsx
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { PropsWithChildren, ReactNode } from "react";

interface TooltipProps extends PropsWithChildren {
  content: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 rounded-[var(--radius-sm)] bg-[var(--color-text-strong)] px-2 py-1 text-xs text-white shadow-[var(--shadow-overlay)]"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[var(--color-text-strong)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
```

Create `src/components/patterns/PagePlaceholder.tsx`:

```tsx
interface PagePlaceholderProps {
  title: string;
  description: string;
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section className="p-8" aria-labelledby="page-title">
      <h1
        id="page-title"
        className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
      >
        {title}
      </h1>
      <p className="mt-2 text-[var(--color-text-muted)]">{description}</p>
    </section>
  );
}
```

- [ ] **Step 3: sidebar와 shell을 구현한다**

Create `src/components/patterns/AppSidebar.tsx`:

```tsx
import {
  FolderOpen,
  House,
  KanbanSquare,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/documents", label: "Documents", icon: FolderOpen, end: false },
  { to: "/project", label: "Project", icon: KanbanSquare, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

interface AppSidebarProps {
  onCollapse(): void;
}

export function AppSidebar({ onCollapse }: AppSidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <span className="app-sidebar__logo" aria-hidden="true">OK</span>
        <strong>OkHub</strong>
        <Tooltip content="사이드바 접기">
          <Button
            variant="icon"
            className="app-sidebar__collapse"
            aria-label="사이드바 접기"
            onClick={onCollapse}
          >
            <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </div>
      <div className="app-sidebar__workspace">연결된 워크스페이스 없음</div>
      <nav aria-label="주 메뉴" className="app-sidebar__nav">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn("app-sidebar__link", isActive && "app-sidebar__link--active")
            }
          >
            <Icon aria-hidden="true" strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="app-sidebar__user">
        <span className="app-sidebar__avatar" aria-hidden="true">GH</span>
        <span><strong>로그인 필요</strong><small>GitHub 계정</small></span>
      </div>
    </aside>
  );
}
```

Create `src/components/patterns/AppShell.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";

export function AppShell() {
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      {isSidebarOpen ? (
        <AppSidebar onCollapse={() => setSidebarOpen(false)} />
      ) : (
        <div className="app-shell__open-sidebar">
          <Tooltip content="사이드바 열기">
            <Button
              variant="icon"
              aria-label="사이드바 열기"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>
      )}
      <main aria-label="OkHub" className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: route와 초기 page를 구현한다**

Create `src/pages/HomePage.tsx`:

```tsx
import { PagePlaceholder } from "@/components/patterns/PagePlaceholder";

export function HomePage() {
  return <PagePlaceholder title="프로젝트 진행 상황" description="오늘의 진행과 확인할 요청을 한눈에 봅니다." />;
}
```

Create `src/pages/DocumentsPage.tsx`:

```tsx
import { PagePlaceholder } from "@/components/patterns/PagePlaceholder";

export function DocumentsPage() {
  return <PagePlaceholder title="Documents" description="프로젝트 문서를 찾고 읽습니다." />;
}
```

Create `src/pages/ProjectPage.tsx`:

```tsx
import { PagePlaceholder } from "@/components/patterns/PagePlaceholder";

export function ProjectPage() {
  return <PagePlaceholder title="Project" description="현재 Iteration의 Issue를 확인합니다." />;
}
```

Create `src/app/AppRoutes.tsx`:

```tsx
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DesignSystemPage } from "@/pages/DesignSystemPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="project" element={<ProjectPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dev/design-system" element={<DesignSystemPage />} />
      </Route>
    </Routes>
  );
}
```

At this step, create temporary route targets so TypeScript resolves before Tasks 7–8.

Create `src/pages/SettingsPage.tsx`:

```tsx
import { PagePlaceholder } from "@/components/patterns/PagePlaceholder";

export function SettingsPage() {
  return <PagePlaceholder title="Settings" description="OkHub의 기기별 설정을 관리합니다." />;
}
```

Create `src/pages/DesignSystemPage.tsx`:

```tsx
import { PagePlaceholder } from "@/components/patterns/PagePlaceholder";

export function DesignSystemPage() {
  return <PagePlaceholder title="Design system" description="OkHub component preview" />;
}
```

Replace `src/app/App.tsx` with:

```tsx
import { useState } from "react";
import { HashRouter } from "react-router-dom";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";
import { AppRoutes } from "./AppRoutes";

export function App() {
  const [repository] = useState(createPreferencesRepository);
  return (
    <PreferencesProvider repository={repository}>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </PreferencesProvider>
  );
}
```

- [ ] **Step 5: shell CSS를 추가한다**

Append to `src/styles/globals.css`:

```css
.app-shell {
  display: flex;
  min-height: 100vh;
  background: var(--color-canvas);
}

.app-shell__main {
  min-width: 0;
  flex: 1;
}

.app-shell__open-sidebar {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10;
}

.app-sidebar {
  position: sticky;
  top: 0;
  display: flex;
  width: 244px;
  height: 100vh;
  flex: 0 0 244px;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.app-sidebar__brand {
  display: flex;
  height: 64px;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
}

.app-sidebar__logo {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-logo);
  font-size: 11px;
  font-weight: 700;
}

.app-sidebar__collapse {
  width: var(--control-height);
  height: var(--control-height);
  margin-left: auto;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.app-sidebar__workspace {
  margin: 0 12px 12px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  color: var(--color-text-strong);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__nav {
  display: grid;
  gap: 4px;
  padding: 0 8px;
}

.app-sidebar__link {
  display: flex;
  min-height: var(--control-height);
  align-items: center;
  gap: 10px;
  border-radius: var(--radius-md);
  padding: 0 10px;
  color: var(--color-text-default);
  text-decoration: none;
}

.app-sidebar__link svg {
  width: var(--icon-size);
  height: var(--icon-size);
}

.app-sidebar__link:hover,
.app-sidebar__link--active {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}

.app-sidebar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  border-top: 1px solid var(--color-border);
  padding: 12px 14px;
}

.app-sidebar__avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
  font-size: 11px;
  font-weight: 700;
}

.app-sidebar__user span:last-child {
  display: grid;
}

.app-sidebar__user small {
  color: var(--color-text-muted);
}
```

- [ ] **Step 6: shell tests와 build를 검증한다**

Run: `pnpm test:run src/components/patterns/AppShell.test.tsx src/app/App.test.tsx`
Expected: 4 tests PASS.

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 7: 사용자 승인을 받은 경우에만 Task 6을 commit한다**

```bash
git add src/app src/components src/pages src/styles/globals.css
git commit -m "feat: add OkHub application shell"
```

## Task 7: Settings 표시 밀도 화면

**Files:**
- Create: `src/pages/SettingsPage.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `usePreferences()`
- Produces: Settings > 화면의 `radiogroup`, 저장된 Default/Compact 전환

- [ ] **Step 1: 선택 상태와 저장 test를 작성한다**

Create `src/pages/SettingsPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("changes the device-only display density", async () => {
    const repository = new FakePreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );
    expect(await screen.findByRole("radio", { name: "Default" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(repository.writes).toEqual(["compact"]);
  });
});
```

Run: `pnpm test:run src/pages/SettingsPage.test.tsx`
Expected: FAIL because the placeholder has no radio controls.

- [ ] **Step 2: 화면 category와 density control을 구현한다**

Replace `src/pages/SettingsPage.tsx` with:

```tsx
import { Check } from "lucide-react";
import { usePreferences } from "@/features/preferences/PreferencesProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { cn } from "@/lib/utils";

const options: Array<{
  value: DisplayDensity;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description: "문서 읽기와 작업 화면의 균형 잡힌 기본 크기",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Board와 탐색에서 더 많은 정보를 표시",
  },
];

export function SettingsPage() {
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();

  return (
    <section className="p-8" aria-labelledby="settings-title">
      <h1
        id="settings-title"
        className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
      >
        Settings
      </h1>
      <div className="mt-8 grid max-w-4xl grid-cols-[180px_1fr] gap-8">
        <nav aria-label="설정 메뉴" className="grid content-start gap-1">
          {["워크스페이스", "외부 연결", "문서", "작업 방식", "화면", "AI 연동"].map(
            (item) => (
              <span
                key={item}
                className={cn(
                  "rounded-[var(--radius-md)] px-3 py-2",
                  item === "화면" &&
                    "bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-text)]",
                )}
              >
                {item}
              </span>
            ),
          )}
        </nav>
        <div>
          <h2 className="m-0 text-xl font-semibold text-[var(--color-text-strong)]">화면</h2>
          <p className="mt-1 text-[var(--color-text-muted)]">
            이 기기의 화면 표시만 변경하며 Git으로 공유하지 않습니다.
          </p>
          <fieldset className="mt-6 border-0 p-0" disabled={isLoading}>
            <legend className="mb-3 font-semibold text-[var(--color-text-strong)]">
              표시 밀도
            </legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-3">
              {options.map((option) => {
                const selected = displayDensity === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "relative cursor-pointer rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4",
                      selected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                        : "border-[var(--color-border)]",
                    )}
                  >
                    <input
                      type="radio"
                      name="display-density"
                      value={option.value}
                      checked={selected}
                      onChange={() => void setDisplayDensity(option.value)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between font-semibold text-[var(--color-text-strong)]">
                      {option.label}
                      {selected && <Check aria-hidden="true" size={16} strokeWidth={1.75} />}
                    </span>
                    <span className="mt-1 block text-[var(--color-text-muted)]">
                      {option.description}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Settings test와 전체 unit suite를 검증한다**

Run: `pnpm test:run src/pages/SettingsPage.test.tsx`
Expected: 1 test PASS.

Run: `pnpm test:run`
Expected: all tests PASS.

- [ ] **Step 4: 사용자 승인을 받은 경우에만 Task 7을 commit한다**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat: add display density settings"
```

## Task 8: Component preview와 자동 접근성 검사

**Files:**
- Create: `.github/workflows/verify.yml`
- Modify: `src/pages/DesignSystemPage.tsx`
- Create: `src/pages/DesignSystemPage.test.tsx`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: `Button`, CSS tokens, `usePreferences()`, axe-core
- Produces: `#/dev/design-system` component preview, 기본 접근성 회귀 test

- [ ] **Step 1: preview에 대한 실패 test를 작성한다**

Create `src/pages/DesignSystemPage.test.tsx`:

```tsx
import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { DesignSystemPage } from "./DesignSystemPage";

describe("DesignSystemPage", () => {
  it("shows every approved button variant", () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <DesignSystemPage />
      </PreferencesProvider>,
    );
    for (const name of ["Primary", "Secondary", "Ghost", "Destructive"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <DesignSystemPage />
      </PreferencesProvider>,
    );
    const result = await axe.run(container);
    expect(result.violations).toEqual([]);
  });
});
```

Run: `pnpm test:run src/pages/DesignSystemPage.test.tsx`
Expected: FAIL because the placeholder has no button variants.

- [ ] **Step 2: 실제 token과 primitive를 사용하는 preview를 구현한다**

Replace `src/pages/DesignSystemPage.tsx` with:

```tsx
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/features/preferences/PreferencesProvider";

const swatches = [
  ["Primary", "var(--color-primary)"],
  ["Primary soft", "var(--color-primary-soft)"],
  ["Success", "var(--color-success)"],
  ["Information", "var(--color-info)"],
  ["Warning", "var(--color-warning)"],
  ["Error", "var(--color-error)"],
] as const;

export function DesignSystemPage() {
  const { displayDensity, setDisplayDensity } = usePreferences();
  return (
    <section className="p-8" aria-labelledby="design-system-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            id="design-system-title"
            className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
          >
            OkHub design system
          </h1>
          <p className="mt-2 text-[var(--color-text-muted)]">
            구현 primitive와 token을 검증하는 개발 전용 화면
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            void setDisplayDensity(displayDensity === "default" ? "compact" : "default")
          }
        >
          {displayDensity === "default" ? "Compact로 보기" : "Default로 보기"}
        </Button>
      </div>

      <section className="mt-8" aria-labelledby="colors-title">
        <h2 id="colors-title" className="text-xl font-semibold text-[var(--color-text-strong)]">Colors</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {swatches.map(([name, color]) => (
            <div key={name} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <span className="mb-2 block h-12 rounded-[var(--radius-md)]" style={{ background: color }} />
              <strong>{name}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="buttons-title">
        <h2 id="buttons-title" className="text-xl font-semibold text-[var(--color-text-strong)]">Buttons</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="icon" aria-label="설정 열기">
            <Settings aria-hidden="true" strokeWidth={1.75} />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="mt-8 max-w-3xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6" aria-labelledby="type-title">
        <h2 id="type-title" className="text-xl font-semibold text-[var(--color-text-strong)]">Typography</h2>
        <p className="text-[length:var(--font-document-size)] leading-[var(--font-document-line)]">
          OkHub는 Git의 Markdown을 사람이 오래 읽어도 편안한 문서 화면으로 보여줍니다.
        </p>
        <code className="font-mono text-[var(--color-primary-text)]">docs/features/map-search.md</code>
      </section>
    </section>
  );
}
```

- [ ] **Step 3: 개발 preview 경로를 문서화한다**

Append to `docs/README.md`:

```markdown
## 개발 화면

앱 골격 구현 뒤 `pnpm dev`를 실행하고 `http://localhost:1420/#/dev/design-system`에서 실제 디자인 token, Button variant와 Default/Compact 표시 밀도를 확인합니다. 제품 기준은 [`product/design-system.md`](product/design-system.md)이며 preview는 구현 검증 도구입니다.
```

- [ ] **Step 4: macOS와 Windows 검증 workflow를 작성한다**

Create `.github/workflows/verify.yml`:

```yaml
name: verify

on:
  pull_request:
  push:
    branches: [main]

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.0.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22.12.0
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:run
      - run: pnpm build
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: pnpm tauri build --debug --no-bundle
```

Run: `git diff --check .github/workflows/verify.yml`
Expected: no output and exit code 0.

- [ ] **Step 5: 접근성 test와 전체 검증을 실행한다**

Run: `pnpm test:run src/pages/DesignSystemPage.test.tsx`
Expected: 2 tests PASS and axe reports zero violations.

Run: `pnpm test:run`
Expected: all tests PASS.

Run: `pnpm build`
Expected: exit code 0 and `dist/index.html` exists.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests PASS.

Run: `pnpm tauri build --debug --no-bundle`
Expected: frontend and desktop debug compile exit code 0.

- [ ] **Step 6: macOS와 Windows 수동 smoke 항목을 기록한다**

Run on macOS and Windows: `pnpm tauri dev`

Expected on both platforms:

1. `OkHub` 창이 1280×800으로 열리고 960×640 아래로 줄어들지 않는다.
2. Home, Documents, Project, Settings navigation이 앱 안에서 전환된다.
3. 사이드바 버튼과 `Command + Backslash` 또는 `Ctrl + Backslash`가 같은 동작을 한다.
4. Settings에서 Compact를 선택하고 앱을 다시 열어도 Compact가 유지된다.
5. 키보드 Tab으로 navigation, sidebar button, density radio에 접근할 수 있다.
6. `#/dev/design-system`에서 색상, 글꼴과 control 높이가 잘리거나 겹치지 않는다.

- [ ] **Step 7: 사용자 승인을 받은 경우에만 Task 8을 commit한다**

```bash
git add .github/workflows/verify.yml src/pages/DesignSystemPage.tsx src/pages/DesignSystemPage.test.tsx docs/README.md
git commit -m "test: add design system preview"
```

## Phase Completion Check

- [ ] `git diff --check` reports no whitespace errors.
- [ ] `pnpm test:run` passes.
- [ ] `pnpm build` passes.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- [ ] `pnpm tauri build --debug --no-bundle` passes.
- [ ] `.superpowers/`, `AGENTS.md`, `.DS_Store` are absent from `git diff --cached --name-only`.
- [ ] `docs/product/design-system.md`의 Primary, typography, density, icon, focus와 border 규칙이 component preview에 대응한다.
- [ ] 사용자가 각 commit을 명시적으로 승인하지 않았다면 commit하지 않는다.
