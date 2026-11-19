# okf-knowledge-hub

백엔드와 프론트엔드 개발자가 서로 다른 시간에 작업하더라도 기능의 맥락, 설계 변경, 리뷰, 구현 상태와 이력을 한곳에서 이어갈 수 있도록 만드는 소규모 팀용 개발 워크스페이스(**OkHub**)입니다.

## 왜 만드는가

- 개발 중 확인이 필요할 때마다 코드와 화면을 캡처하고 메신저에 배경을 다시 설명해야 합니다.
- 질문과 답변이 실제 문서, 코드, 처리 케이스와 떨어져 있어 어떤 버전에 대한 결정인지 찾기 어렵습니다.
- Mermaid 시퀀스, DTO/API/예외 계약, Issue, PR, 구현 상태가 여러 도구에 흩어집니다.
- 서로의 작업 시간이 다르면 리뷰와 결정이 늦어지고, 무엇이 막혀 있는지 한눈에 보이지 않습니다.
- 작업이 끝난 뒤 문서를 별도로 정리하려다 보니 판단 과정과 변경 이유가 남지 않습니다.

## 개선하려는 방향

- OKF(Open Knowledge Format) Markdown과 Git을 팀 지식의 공유 원본으로 사용합니다.
- 사람은 읽기 쉬운 화면과 에디터로 작성하고, 저장 결과는 AI와 도구가 이해할 수 있는 구조화된 Markdown으로 유지합니다.
- 확정된 지식과 리뷰 중인 변경 제안을 Git 브랜치와 PR로 구분합니다.
- Hub 안에서 문서, 관련 코드, GitHub Issue/PR, 리뷰 요청과 진행 이력을 함께 확인합니다.
- 중앙 서버 없이 로컬 우선으로 시작하고 GitHub를 팀 간 동기화 기반으로 사용합니다.

## 문서

제품 기획, 아키텍처, 개발 가이드, 사용자 안내 문서는 최신 OKF 규격에 맞춰 별도 지식 저장소인 [`Mockly-Company/hub-knowledge`](https://github.com/Mockly-Company/hub-knowledge)에서 관리합니다. 전체 읽기 순서는 [`docs/README.md`](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/README.md), 분류별 목차는 [`docs/index.md`](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/index.md)에서 확인할 수 있습니다.

| 문서 | 내용 |
|---|---|
| [제품 개요](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/overview.md) | 문제, 목표, 사용자와 제품 원칙 |
| [문서 변경 워크플로](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/workflow.html) | 문서 생성부터 잠금, 편집, 검수, 병합과 오프라인 복구까지의 전체 흐름 |
| [유스케이스와 작업 흐름](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/use-cases.md) | 실제 개발 과정에서 Hub를 사용하는 흐름 |
| [기능 정의](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/features.md) | 기능 영역과 현재 범위 |
| [화면 구성](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/screens.md) | 화면 후보와 화면별 책임 |
| [정보 모델](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/information-model.md) | 제품 구조, 문서, 리뷰와 이력의 관계 |
| [기술 구조](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/architecture/system-design.md) | 저장소, GitHub, 로컬 앱, 인증, MCP, API 문서 전략 |
| [문서 중심 통합 워크스페이스 설계](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/superpowers/specs/2026-11-11-workspace-centric-ux-design.md) | GitHub Project 연동 및 문서 저장소 단독 워크스페이스 구조와 UX |
| [승인된 GitHub 워크스페이스 연결 설계](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/superpowers/specs/2026-07-25-github-workspace-connection-design.md) | GitHub App 인증, OKF 저장소 연결과 초기화의 승인된 경계 |
| [GitHub App 개발 설정](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/development/github-app.md) | 공개 GitHub App 등록, 로컬 Device Flow와 보안 저장소 확인 방법 |
| [미결정 사항](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/product/open-questions.md) | 트리 깊이, 문서 타입 등 추가 논의가 필요한 항목 |

## 현재 합의된 원칙

- 앱 코드 저장소(`Mockly-Company/okf-knowledge-hub`)와 각 프로젝트의 OKF 지식 저장소(예: [`Mockly-Company/hub-knowledge`](https://github.com/Mockly-Company/hub-knowledge))를 분리합니다.
- 저장소의 `.okf/workspace.yml`을 팀이 공유하는 워크스페이스 정의로 사용하며, GitHub Project와 소속 문서 저장소를 함께 연결하거나 문서 저장소만 단독으로 연결해 여러 워크스페이스를 전환할 수 있습니다.
- 초기 앱은 SQLite를 포함한 별도 데이터베이스를 두지 않고 Git 파일, GitHub와 기기별 로컬 설정 파일로 동작합니다.
- Windows와 macOS를 지원하는 Tauri 기반 로컬 앱으로 시작합니다.
- GitHub 인증 정보는 중앙에 저장하지 않고 각 사용자 기기의 보안 저장소에서 관리합니다.
- Hub는 코드를 읽고 검색하고 diff를 보여주지만, 실제 코드 수정과 실행은 IDE에서 진행합니다.
- OkHub의 AI 워크플로우는 애플리케이션 코드를 직접 구현하지 않으며, **아이디어 → PRD·화면명세서(`.md` 정본 + `.html` 사람용 뷰) 작성 → 기획자·디자이너·개발자 전체 백로그 작성 → `[기획]`·`[디자인]` 백로그까지만 자율 수행해 문서 완성**을 담당합니다([`AGENTS.md`](./AGENTS.md)).
- 별도 AI API 키를 자체 서버에 두지 않고, Claude Code·Codex·Antigravity 등 로컬 AI CLI가 문서 저장소의 격리된 Git worktree와 `.okf/AGENTS.md` 규칙 위에서 작업할 수 있도록 연동합니다.
- 처음부터 Jira·Confluence·Postman 전체를 대체하지 않고 반복되는 협업 불편부터 해결합니다.

## 개발

Node.js 22.12 이상과 pnpm 10, Rust 1.88.0을 준비한 뒤 의존성을 설치합니다. 공식 GitHub App의 공개 Client ID가 앱에 포함되어 있어 별도 환경변수 없이 GitHub 연결을 확인할 수 있습니다. 포크나 자체 GitHub App을 사용할 때는 [GitHub App 개발 설정](https://github.com/Mockly-Company/hub-knowledge/blob/main/docs/development/github-app.md)에 따라 Client ID를 재정의하세요.

macOS에서 소스를 직접 개발할 때는 Apple Developer 계정 대신 개발자 기기에 한 번 생성하는 로컬 code-signing identity를 사용합니다. 최초 한 번 설정한 뒤에는 현재 worktree에서 `pnpm tauri dev`로 실행합니다.

```bash
pnpm install --frozen-lockfile
pnpm dev:setup:macos # macOS 최초 1회
pnpm tauri dev
```

debug 창 제목과 Settings의 앱 정보에서 현재 branch와 commit을 확인할 수 있습니다. `target/debug/bundle/macos/OkHub.app`은 과거 빌드일 수 있으므로 개발 수동 검증에 사용하지 않습니다. 패키징 결과를 확인할 때만 별도로 `pnpm tauri build`를 실행합니다.

전체 자동 검증은 다음 명령을 사용합니다.

```bash
pnpm test:run
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## MCP 연동 및 AI 에이전트 원샷 워크플로우

OkHub는 내장 CLI/STDIO MCP 서버인 `okhub-cli`를 제공합니다.

- **OkHub 앱 내장 AI 터미널**에서 Claude Code 또는 Codex를 실행하면 앱이 `OKHUB_*` 환경 변수·워크트리 경로와 MCP 서버 설정(`--mcp-config` / `-c mcp_servers.okhub.*`)을 **자동으로 연결**합니다.
- **외부 터미널이나 IDE 에이전트**(Claude Code CLI, Codex CLI, Antigravity, Cursor 등)에서 OkHub와 동일한 프로젝트·문서·보드 맥락을 쓰려면 아래 절차로 MCP 설정을 한 번만 등록하면 됩니다.

### 1. `okhub-cli` 빌드 및 설치

```bash
# 로컬 설치 (PATH의 ~/.cargo/bin 에 okhub-cli / okhub-cli.exe 설치)
cargo install --path src-tauri --bin okhub-cli

# 또는 개발 빌드만 생성 (target/debug/okhub-cli[.exe])
cargo build --manifest-path src-tauri/Cargo.toml --bin okhub-cli
```

설치 확인:

```bash
okhub-cli --help
okhub-cli --json context active
```

### 2. AI 클라이언트별 MCP 설정

#### Claude Code (`.mcp.json` 또는 CLI 등록)

저장소 루트의 `.mcp.json`에 추가하거나 `claude mcp add`로 등록합니다.

```json
{
  "mcpServers": {
    "okhub": {
      "command": "okhub-cli",
      "args": ["mcp"]
    }
  }
}
```

```bash
claude mcp add okhub -- okhub-cli mcp
```

#### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.okhub]
command = "okhub-cli"
args = ["mcp"]
```

#### Antigravity / Cursor / 기타 MCP 호환 클라이언트

```json
{
  "mcpServers": {
    "okhub": {
      "command": "okhub-cli",
      "args": ["mcp"],
      "env": {
        "OKHUB_PROJECT_URL": "https://github.com/orgs/<ORG>/projects/<NUM>",
        "OKHUB_DOCS_REPO": "<ORG>/<DOCS_REPO>"
      }
    }
  }
}
```

> **Windows / Worktree 경로 팁**
> - Windows에서 `~/.cargo/bin`이 PATH에 없다면 `C:\\Users\\<USER>\\.cargo\\bin\\okhub-cli.exe` 또는 `target\\debug\\okhub-cli.exe`의 **절대 경로**를 `"command"`에 적으세요(JSON에서는 `\\` 이스케이프 또는 `/` 사용).
> - macOS GUI 앱에서 실행할 때도 PATH 누락을 피하려면 `/Users/<USER>/.cargo/bin/okhub-cli` 절대 경로를 권장합니다.

### 3. 인증, 환경 변수 및 Worktree 자동 감지

| 환경 변수 / 소스 | 역할 | 기본 동작 (미설정 시) |
|---|---|---|
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub GraphQL · REST API 토큰 | OkHub 앱으로 로그인한 OS 키체인(Credential Manager / Keychain) 토큰 자동 재사용 |
| `OKHUB_WORKSPACE_DIR` | 문서 저장소 또는 격리 worktree 루트 | `--workspace-dir` > `OKHUB_WORKSPACE_DIR` > **현재 작업 디렉터리(CWD 또는 상위 폴더의 `.okf/workspace.yml`)** > OkHub 앱 관리 clone 순으로 자동 탐지 |
| `OKHUB_APP_DATA_DIR` | `settings.json` 등 앱 데이터 폴더 | OS 표준 앱 데이터 디렉터리(`com.okhub.desktop`) 자동 탐색 |
| `OKHUB_DOCS_REPO` | 대상 문서 GitHub 저장소 (`owner/name`) | `.okf/workspace.yml` 및 활성 워크스페이스 설정 사용 |
| `OKHUB_PROJECT_URL` | 대상 GitHub Project v2 URL | `.okf/workspace.yml`의 `github.active_project_id` 및 활성 프로젝트 사용 |

- **격리 Git Worktree 안전성**: CWD(또는 상위 폴더)에 `.okf/workspace.yml`이 있으면 OkHub 관리 원본 clone보다 현재 worktree를 최우선으로 인식합니다.
- **역할별 담당자 자동 배정**: `.okf/workspace.yml`의 `assignees.{planning,design,frontend,backend}`가 정의되어 있으면 MCP 백로그 생성 시 `layer`에 맞춰 GitHub Issue 담당자가 자동 지정됩니다.

### 4. 제공 MCP 도구 (16종)

| 구분 | 도구 이름 | 설명 |
|---|---|---|
| 컨텍스트 | `okhub_get_active_context` | 선택된 Project, 문서/코드 저장소, 역할별 `assignees` 조회 |
| 컨텍스트 | `okhub_context_issue` | 이슈 본문·선행 이슈 완료 여부·연결 `.md` 문서 Context Pack 반환 |
| 문서 | `okhub_doc_list` | `.md` 목록, `.html` 동기화 상태, 변경 하이라이트 여부 조회 |
| 문서 | `okhub_doc_read` | 지정 경로 `.md` 원문 및 `.html`/마커 상태 조회 |
| 문서 | `okhub_doc_validate` | frontmatter, `.md`+`.html` 2벌, `<script>` 금지, SVG 와이어프레임·에셋·`[NEW]`/`[CHANGED]` 마커 검증 |
| PR | `okhub_pr_list` | 열린 PR 목록 조회 |
| PR | `okhub_pr_create` | 문서/대상 저장소에 PR 생성 (`Closes #<이슈>`) |
| PR | `okhub_pr_approve_merge` | PR 승인 및 Squash Merge |
| 보드 | `okhub_board_get_schema` | Project의 `Status`·`영역`·`타입`·`Priority` 필드 ID 및 옵션 목록 조회 |
| 보드 | `okhub_board_list` | Project 항목 조회 (`layer`, `status` 필터) |
| 보드 | `okhub_board_ready` | 선행 이슈(`이전 단계: #N`)가 모두 완료된 Ready 항목 조회 |
| 보드 | `okhub_board_create_issue` | 단일 이슈 또는 Sub-issue 생성 (`parentIssueRepository`, `assignees` 지원) |
| 보드 | `okhub_board_create_backlog_tree` | `[Epic]` + `[기획]`/`[디자인]`/`[백엔드]`/`[프론트엔드]` Sub-issue 및 `이전 단계: #N` 의존성 트리를 한 번에 생성 |
| 보드 | `okhub_board_derive_backlog` | 완료된 `[기획]`/`[디자인]` 이슈에서 개발 백로그 일괄 파생 |
| 보드 | `okhub_board_update_issue` | 이슈 제목·본문·열림/닫힘 상태·코멘트·`assignees` 갱신 |
| 보드 | `okhub_board_update_status` | Project `Status`·`영역`·`타입`·`Priority` 변경 |

### 5. 원샷(One-Shot) 프롬프트 예시

OkHub 규칙(`.okf/AGENTS.md`)과 MCP가 연결된 AI 에이전트에게 아래처럼 한 번만 지시하면 **백로그 트리 생성 → 기획(PRD) 완성 → 디자인(화면명세서 + SVG 와이어프레임) 완성 → 검증/PR → BE/FE 백로그 보강**까지 한 흐름으로 끝납니다(애플리케이션 코드는 구현하지 않음).

```text
okf-knowledge-hub에 "알림 설정 센터" 기능을 추가하고 싶어.
1. okhub_get_active_context와 okhub_board_get_schema로 현재 프로젝트와 저장소 맥락을 확인해. (코드 저장소는 읽기 전용으로만 참고)
2. okhub_board_create_backlog_tree로 [Epic] 아래 [기획], [디자인], [백엔드], [프론트엔드] Sub-issues와 이전 단계 의존성을 한 번에 등록해.
3. 문서 저장소의 격리 worktree에서 [기획] PRD(.md + .html)와 [디자인] 화면명세서(.md + .html + 순수 SVG 와이어프레임)를 작성하고 Reset → Mark 규칙을 적용해.
4. okhub_doc_validate로 0 에러 검증 후 okhub_pr_create로 기획·디자인 PR을 열고, okhub_board_update_issue로 BE/FE 백로그에 확정 문서 링크와 완료 조건을 보강해 줘.
```

## 아직 확정하지 않은 것

- 제품 구조 트리의 기본 깊이와 커스텀 범위
- 팀마다 달라질 수 있는 문서 타입 체계
- OpenAPI와 Postman의 역할 및 API 명세 저장 위치
- GitHub Project 필드와 Hub 진행 상태의 세부 매핑
- 최종 제품명과 최종 화면 정보 구조
