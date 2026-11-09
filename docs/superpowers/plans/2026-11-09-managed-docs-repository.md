# 앱이 관리하는 문서 저장소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자는 GitHub 저장소만 고르고, 앱이 프로젝트별 문서 저장소를 앱 폴더에 clone·pull하며, AI 터미널은 worktree에서 작업해 PR을 올린다.

**Architecture:** 프로젝트 목록·활성 프로젝트·프로젝트별 문서 저장소를 `LocalSettingsService`(앱 로컬 설정)로 옮긴다. 프로젝트를 전환하면 백엔드가 "현재 워크스페이스"를 그 프로젝트의 clone으로 바꾸고, Documents와 AI 터미널은 지금처럼 현재 워크스페이스를 읽는다. clone은 `{app_data}/repos/{owner}/{name}`, AI 작업용 worktree는 `{app_data}/worktrees/{owner}/{name}/{branch}`에 둔다.

**Tech Stack:** Tauri v2, Rust(`git2` 0.19, `serde`, `uuid`), React 19 + TypeScript, TanStack Query v5, Vitest, Storybook.

**Spec:** `docs/superpowers/specs/2026-11-09-managed-docs-repository-design.md`

## Global Constraints

- PR 단위: 아래 "PR" 머리말마다 `main`에서 새 브랜치를 만들고, 사용자가 rebase merge한다. merge commit을 만들지 않는다.
- 각 PR 전: `pnpm exec tsc --noEmit`, `pnpm test:run`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` 통과(`src-tauri`에서).
- 디자인 계약: `components/ui` 밖에서 raw `<button>`·리터럴 색 금지(기존 테스트가 검사한다).
- Tauri 명령 인자는 프런트에서 camelCase로 보낸다.
- 사용자 화면에 로컬 경로를 보여 주지 않는다. 문서 저장소는 `owner/name`으로만 표시한다.
- 기존 로컬 폴더 연결, `remembered-workspaces`, `workspace.yml`의 `github.projects`/`active_project_id`는 읽지 않는다(마이그레이션 없음).
- OKF 형식이 아닌 저장소도 연결한다. 경고 문구: "OKF 형식에 맞지 않는 저장소입니다."
- pull 중단 안내 문구: "작업 중인 변경이 있어 최신 내용을 받지 않았습니다."
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. clone이 진행 중일 때 사용자가 다른 프로젝트로 전환 → 저장소가 원래 고른 프로젝트에만 기억되어야 한다(Task 6 테스트 `connect_saves_mapping_for_the_given_project_not_the_active_one`).
2. 다른 owner에 같은 이름 저장소(`a/docs`, `b/docs`) → 서로 다른 폴더에 clone된다(Task 5 테스트 `managed_clone_paths_differ_by_owner`).
3. 기본 브랜치가 `main`이 아닌 저장소(`master`, `trunk`) → pull이 원격 HEAD 기준으로 동작한다(Task 8 테스트 `fast_forwards_a_non_main_default_branch`).
4. 앱 폴더의 clone을 사용자가 지웠거나 옮김 → 그 프로젝트로 전환하면 "문서 저장소 선택"이 다시 보이고 오류로 멈추지 않는다(Task 6 테스트 `activating_a_project_whose_clone_is_gone_reports_missing_docs`).
5. GitHub 로그인 없이 AI 터미널 열기 → 토큰 없이도 터미널이 열린다(Task 10 테스트 `terminal_env_omits_credentials_when_signed_out`).

---

## PR 1: AI 화면을 터미널 전용으로 정리

### Task 1: 비대화형 실행 기능 제거 (백엔드)

**Files:**
- Modify: `src-tauri/src/settings/commands.rs` (`run_ai_task`, `cancel_ai_task`, `run_ai_task_blocking`, `build_ai_task_command`, `render_command_template`, `get_ai_config`/`set_ai_config`의 `command_template` 필드, 관련 테스트)
- Modify: `src-tauri/src/settings/ai_runner.rs` (`headless_command`, `compose_task_prompt`, `AiTaskStatus`, `ProcessOutcome`, `run_process`, `AiTaskRegistry`/`AiTaskGuard`, `spawn_reader`, `kill_process_tree`, `collected_text`, 해당 테스트. `shell_quote`, `shell_quote_path`, `cli_search_path`, `is_on_path`, `shell_path`, `compose_rules`, `terminal_command`는 남긴다)
- Modify: `src-tauri/src/settings/service.rs` (`AI_COMMAND_TEMPLATE_KEY`, `load/set_ai_command_template` 제거)
- Modify: `src-tauri/src/lib.rs` (명령 등록과 `AiTaskRegistry` 관리 상태 제거)
- Delete: 비대화형 실행 전용 통합 테스트가 있으면 함께 삭제한다(`src-tauri/tests/`에서 `run_process`·`run_ai_task` 사용처 검색).

**Interfaces:**
- Produces: `AiConfig { cli_command: String }`. `set_ai_config(cli_command: String)`

- [ ] **Step 1:** `ai_config_round_trip_trims_both_fields` 테스트를 `ai_config_round_trip_trims_cli_command`로 바꾼다. `set_ai_config_inner(&services, "  codex  ")` 후 `get_ai_config_inner`가 `AiConfig { cli_command: "codex".into() }`를 돌려줘야 한다.
- [ ] **Step 2:** `cargo test ai_config_round_trip` 실행. 컴파일 실패를 확인한다.
- [ ] **Step 3:** 위 목록을 제거하고 `AiConfig`·`set_ai_config_inner`를 `cli_command`만 받도록 바꾼다. 사용되지 않게 된 import와 helper는 clippy가 알려 주는 대로 지운다.
- [ ] **Step 4:** `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test` 통과.
- [ ] **Step 5:** 커밋 `refactor: remove the headless AI task runner`

### Task 2: AI 화면과 설정에서 실행 UI 제거 (프런트)

**Files:**
- Modify: `src/pages/AiPage.tsx` ("실행 도구" fieldset, 요청 textarea, 실행/취소, 결과·상태 영역, `refreshAfterRun`, `runMutation`, `useMutationState`, `projectBoardGateway`·`refreshDocuments` prop 제거)
- Modify: `src/app/AppRoutes.tsx` (`ConnectedAiPage`가 넘기던 `projectBoardGateway`·`refreshDocuments` 제거)
- Modify: `src/features/ai/AiSettingsPanel.tsx` ("명령 템플릿" 입력과 안내 제거, 저장은 `cliCommand`만)
- Modify: `src/features/ai/AiGateway.ts`, `src/infrastructure/ai/TauriAiGateway.ts`, `src/test/FakeAiGateway.ts` (`runTask`, `cancelTask`, `AiTaskResult` 제거, `AiConfig`는 `{ cli_command: string }`, `setConfig(cliCommand: string)`)
- Modify: `src/features/ai/queryKeys.ts` (`run` 키 제거)
- Test: `src/pages/AiPage.test.tsx`, `src/features/ai/AiSettingsPanel.test.tsx`, `src/infrastructure/ai/TauriAiGateway.test.ts`, 관련 stories

**Interfaces:**
- Consumes: Task 1의 `set_ai_config(cliCommand)`
- Produces: `AiGateway.setConfig(cliCommand: string): Promise<void>`

- [ ] **Step 1:** `AiPage.test.tsx`에 테스트 `shows only terminal launchers` 추가: 렌더 후 `screen.queryByRole("group", { name: "실행 도구" })`와 `screen.queryByLabelText("요청")`이 `null`이고, `screen.getByRole("button", { name: "Claude Code" })`가 있다. 실행 관련 기존 테스트는 삭제한다.
- [ ] **Step 2:** `pnpm test:run src/pages/AiPage` 실행, 새 테스트 실패 확인.
- [ ] **Step 3:** 위 파일들에서 실행 기능을 제거한다.
- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test:run` 통과. `pnpm test:storybook`에서 AI·Settings 스토리 통과.
- [ ] **Step 5:** 커밋 `refactor: keep only terminal launchers on the AI page`

## PR 2: 프로젝트 목록을 앱 설정으로

### Task 3: 앱 설정에 연결 목록·활성 프로젝트·문서 저장소 저장

**Files:**
- Modify: `src-tauri/src/settings/service.rs`
- Modify: `src-tauri/src/settings/model.rs`
- Test: `src-tauri/src/settings/service.rs` 테스트 모듈

**Interfaces:**
- Produces (모두 `LocalSettingsService`):
  - 키 상수: `LINKED_PROJECTS_KEY = "linked-projects"`, `ACTIVE_PROJECT_KEY = "active-project-id"`, `PROJECT_DOCS_REPOSITORIES_KEY = "project-docs-repositories"`
  - `pub struct LinkedProject { pub id: String, pub owner: String, pub number: u64, pub title: String, pub scope: ProjectOwnerScope }` (serde camelCase, `model.rs`)
  - `pub struct DocsRepository { pub repository_id: String, pub full_name: String }` (serde camelCase, `model.rs`)
  - `fn load_linked_projects(&self) -> Result<Vec<LinkedProject>, AppError>`
  - `fn link_project(&self, project: LinkedProject) -> Result<(), AppError>` — 같은 id면 덮어쓰고, 활성 프로젝트가 없으면 활성으로 정한다
  - `fn unlink_project(&self, project_id: &str) -> Result<(), AppError>` — 활성이면 남은 첫 프로젝트로 바꾸고 문서 저장소 기억도 지운다
  - `fn load_active_project(&self) -> Result<Option<LinkedProject>, AppError>` — 저장된 id가 목록에 없으면 `None`
  - `fn set_active_project(&self, project_id: &str) -> Result<(), AppError>` — 목록에 없으면 `WorkspaceInvalid` 오류
  - `fn docs_repository_for(&self, project_id: &str) -> Result<Option<DocsRepository>, AppError>`
  - `fn set_docs_repository(&self, project_id: &str, repository: DocsRepository) -> Result<(), AppError>`
- 기존 `get_workspace_for_project`, `set_workspace_for_project`, `list_remembered_workspaces`, `REMEMBERED_WORKSPACES_KEY`는 Task 12에서 지운다. 이 Task에서는 건드리지 않는다.

- [ ] **Step 1:** 테스트 작성 (`MemoryStore` 사용):
  - `linking_the_first_project_makes_it_active`: `link_project(a)` 후 `load_active_project()`가 `Some(a)`.
  - `relinking_replaces_the_stored_project`: 같은 id로 title만 바꿔 다시 link → 목록 길이 1, title은 새 값.
  - `unlinking_the_active_project_activates_the_next_and_forgets_its_docs`: a, b 연결, a 활성, a에 문서 저장소 기억 → `unlink_project("a")` 후 활성은 b, `docs_repository_for("a")`는 `None`.
  - `setting_an_unknown_active_project_fails`: `set_active_project("x")`가 `Err`.
  - `corrupt_stored_lists_read_as_empty`: 키에 `"not json"` 저장 → `load_linked_projects()`가 빈 벡터.
- [ ] **Step 2:** `cargo test settings::service` 실패 확인.
- [ ] **Step 3:** 위 시그니처를 구현한다. 저장은 기존 `store.write`에 JSON 문자열로 한다.
- [ ] **Step 4:** `cargo test settings::service` 통과.
- [ ] **Step 5:** 커밋 `feat: store linked projects and docs repositories in app settings`

### Task 4: 프로젝트 명령과 보드를 앱 설정 기반으로 전환

**Files:**
- Modify: `src-tauri/src/commands/project_board.rs` (`list_linked_projects`, `link_github_project`, `set_active_github_project`, `unlink_github_project`, `load_linked_project`, `get_project_board`, `sync_project_board`)
- Modify: `src/features/active-project/ActiveProjectProvider.tsx`
- Modify: `src/features/project-board/ProjectBoardGateway.ts`, `src/infrastructure/project-board/TauriProjectBoardGateway.ts`, `src/test/FakeProjectBoardGateway.ts`
- Test: `src-tauri/src/commands/project_board.rs` 테스트, `src/features/active-project/ActiveProjectProvider.test.tsx`, `src/components/patterns/AppSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `LocalSettingsService` 메서드
- Produces:
  - `set_active_github_project(project_id) -> CommandResult<ActiveProjectResult>`, `#[serde(rename_all = "camelCase")] pub struct ActiveProjectResult { pub docs_repository: Option<DocsRepository> }`. 이 Task에서는 활성 id만 바꾸고 `docs_repository_for`를 그대로 돌려준다. 현재 워크스페이스 전환은 Task 6에서 추가한다.
  - `load_linked_project(services) -> CommandResult<GithubProjectRef>`: 앱 설정의 활성 프로젝트에서 만든다. 보드 캐시 위치는 기존 `cache_root`(앱 캐시)와 키를 그대로 쓴다.
  - 프런트 `ProjectBoardGateway.setActiveProject(id: string): Promise<{ docsRepository: { repositoryId: string; fullName: string } | null }>`
- 이 명령들은 더 이상 `.okf/workspace.yml`을 읽거나 쓰지 않는다. 현재 워크스페이스가 없어도 동작한다.

- [ ] **Step 1:** Rust 테스트: `linked_projects_do_not_require_a_workspace`. 현재 워크스페이스가 없는 `AppServices`에서 `link`→`list` 내부 함수가 성공해야 한다. 명령 본문을 `*_inner(&AppServices, ...)`로 분리해 테스트한다. GitHub 검증 호출(`resolve_project`)은 `link_github_project_inner`에 검증 결과를 인자로 넘기는 형태로 분리한다.
- [ ] **Step 2:** 프런트 테스트: `ActiveProjectProvider.test.tsx`에 `selecting a project does not touch the workspace mapping` 추가. `FakeWorkspaceConnectionGateway`의 `setWorkspaceForProject` spy가 호출되지 않아야 한다. `docsMissing`은 `setActiveProject`가 돌려준 `docsRepository === null`로 정해진다.
- [ ] **Step 3:** 테스트 실패 확인 (`cargo test project_board`, `pnpm test:run src/features/active-project`).
- [ ] **Step 4:** 구현. `ActiveProjectProvider`의 `selectMutation`에서 `getWorkspaceForProject`/`setWorkspaceForProject` 분기를 지우고 `setActiveProject` 결과로 `docsMissing`을 정한다. `localStorage`의 마지막 활성 프로젝트 기억(`LAST_ACTIVE_PROJECT_KEY`)도 백엔드 활성값으로 대체해 지운다.
- [ ] **Step 5:** 전체 검사 통과, 커밋 `feat: read linked projects from app settings instead of workspace.yml`

## PR 3: 앱 폴더에 문서 저장소 clone·연결

### Task 5: 관리 clone 경로와 OKF가 아닌 저장소 연결 허용

**Files:**
- Create: `src-tauri/src/repository/managed.rs` (+ `src-tauri/src/repository/mod.rs`에 모듈 등록)
- Modify: `src-tauri/src/settings/service.rs` (`set_current_for_repository`, `load_current`, `load_connected_document_workspace`)
- Modify: `src-tauri/src/settings/model.rs` (`CurrentWorkspace`에 `pub okf: bool` 추가, 프런트 타입 `src/features/workspace-connection/model/protocol.ts`도 동일)
- Modify: `src-tauri/Cargo.toml` (`uuid` features에 `"v5"` 추가)

**Interfaces:**
- Produces:
  - `pub fn managed_clone_dir(app_data: &Path, full_name: &str) -> Result<PathBuf, AppError>` → `{app_data}/repos/{owner}/{name}`. owner·name은 `repository_name_from_full_name`과 같은 검증을 거치고, 소문자로 바꾸지 않는다.
  - `pub fn managed_worktrees_dir(app_data: &Path, full_name: &str) -> Result<PathBuf, AppError>` → `{app_data}/worktrees/{owner}/{name}`
  - `set_current_for_repository`는 `Ready`가 아니어도(`InitializationRequired`·`Invalid`) 저장한다. 그때 summary는 `WorkspaceSummary { id: Uuid::new_v5(&Uuid::NAMESPACE_URL, repository.id.as_bytes()), name: full_name, schema_version: 0, document_roots: vec![<저장소 루트를 뜻하는 값>], repository_count: 1 }`, `okf: false`. `UnsupportedVersion`은 지금처럼 거부한다.
  - `load_current`도 같은 규칙으로 `Connected { okf: false }`를 돌려준다(`repository`가 저장된 경우만, 그 외에는 지금처럼 `recovery_required`).
- 저장소 루트를 뜻하는 `document_roots` 값은 `authoring.rs::validate_document_target`의 `safe_relative_path` 규칙과 문서 목록 스캔 코드를 읽고 정한다. 아래 테스트가 기준이다.

- [ ] **Step 1:** 테스트:
  - `managed_clone_paths_differ_by_owner`: `managed_clone_dir(root, "a/docs") != managed_clone_dir(root, "b/docs")`, 둘 다 `root/repos/...` 아래.
  - `managed_clone_dir_rejects_path_tricks`: `"../x"`, `"a/.."`, `"a"`는 `Err`.
  - `non_okf_repository_connects_with_a_warning_flag`: `.okf`가 없는 임시 git 폴더에 `set_current_for_repository` → `Ok`, `okf == false`. 그 뒤 `load_current()`도 `Connected`, `okf == false`.
  - `non_okf_repository_lists_markdown_from_the_root`: 같은 폴더에 `README.md`와 `notes/a.md`를 두고 문서 세션을 시작하는 기존 문서 테스트 헬퍼로 목록을 읽으면 두 파일이 모두 나온다. 헬퍼는 `src-tauri/src/commands/documents.rs` 테스트에서 찾는다.
- [ ] **Step 2:** 실패 확인, **Step 3:** 구현, **Step 4:** 통과 확인.
- [ ] **Step 5:** 커밋 `feat: allow app-managed clones and non-OKF docs repositories`

### Task 6: 프로젝트 문서 저장소 연결·전환 명령

**Files:**
- Create: `src-tauri/src/commands/docs_repository.rs` (+ `commands/mod.rs`, `lib.rs` 등록)
- Modify: `src-tauri/src/commands/project_board.rs` (`set_active_github_project`가 현재 워크스페이스를 전환)

**Interfaces:**
- Consumes: Task 3, Task 5
- Produces (Tauri 명령):
  - `prepare_docs_repository(full_name: String) -> CommandResult<PreparedDocsRepository>`, `struct PreparedDocsRepository { parent_directory: PathBuf, already_cloned: bool }` (camelCase). `parent_directory`는 `managed_clone_dir`의 부모. `already_cloned`는 그 폴더에 `.git`이 있고 `origin` URL이 `https://github.com/{full_name}.git`과 같을 때 참.
  - `connect_project_docs_repository(project_id: String, repository_id: String, full_name: String) -> CommandResult<ConnectedDocsRepository>`, `struct ConnectedDocsRepository { full_name: String, okf: bool }`. `managed_clone_dir`을 `set_current_for_repository`로 연결하고 `set_docs_repository(project_id, ..)`로 기억한다. `project_id`는 인자로 받은 값을 쓰며 활성 프로젝트를 읽지 않는다. 그 프로젝트가 활성이 아니면 현재 워크스페이스는 바꾸지 않는다.
  - `set_active_github_project`: 활성 id 저장 후, 그 프로젝트의 `DocsRepository`가 있고 clone 폴더가 있으면 `set_current_for_repository`로 전환한다. clone이 없으면 `clear_current()` 후 `docs_repository: None`을 돌려준다.
- 프런트는 기존 `cloneRepository(parentDirectory, ...)`와 진행률 이벤트를 그대로 쓴다(Task 7).

- [ ] **Step 1:** 테스트 (`*_inner` 함수 대상, 임시 폴더를 app_data로 사용):
  - `connect_saves_mapping_for_the_given_project_not_the_active_one`: a 활성, `connect(b, ...)` → `docs_repository_for("b")`는 Some, `("a")`는 None, 현재 워크스페이스는 바뀌지 않음.
  - `activating_a_project_switches_the_current_workspace`: a·b에 각각 clone(임시 git 폴더) 연결 → b 활성화 후 `load_current().path`가 b의 clone.
  - `activating_a_project_whose_clone_is_gone_reports_missing_docs`: b의 clone 폴더 삭제 후 b 활성화 → `Ok(ActiveProjectResult { docs_repository: None })`, 현재 워크스페이스 없음.
  - `prepare_reports_an_existing_clone_only_for_the_same_remote`: 같은 경로에 다른 origin을 가진 저장소가 있으면 `already_cloned == false`.
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인.
- [ ] **Step 5:** 커밋 `feat: connect and switch per-project docs repositories`

### Task 7: 문서 저장소 선택 화면

**Files:**
- Create: `src/features/docs-repository/DocsRepositoryPicker.tsx`, `src/features/docs-repository/DocsRepositoryPicker.test.tsx`, `src/features/docs-repository/DocsRepositoryPicker.stories.tsx`
- Create: `src/features/docs-repository/DocsRepositoryGateway.ts`, `src/infrastructure/docs-repository/TauriDocsRepositoryGateway.ts`, `src/test/FakeDocsRepositoryGateway.ts`
- Modify: `src/pages/DocumentsPage.tsx` ("저장소 연결하기"·"다른 저장소 연결"이 picker를 연다. `okf === false`면 상단에 경고 `StatusFeedback`)
- Modify: `src/features/active-project/ActiveProjectProvider.tsx` (`docsMissing`일 때 Documents 화면이 picker를 보여 준다)

**Interfaces:**
- Consumes: Task 6 명령, 기존 `WorkspaceConnectionGateway.listRepositories(cursor)`, `cloneRepository`, `onCloneProgress`
- Produces:
  - `interface DocsRepositoryGateway { prepare(fullName: string): Promise<{ parentDirectory: string; alreadyCloned: boolean }>; connect(projectId: string, repositoryId: string, fullName: string): Promise<{ fullName: string; okf: boolean }>; }`
  - `<DocsRepositoryPicker projectId={string} onConnected={(result) => void} />`: 저장소 목록(검색 입력 + 다음 페이지), 선택 시 prepare → 필요하면 clone(진행률 표시, 취소 버튼) → connect. 경로는 어디에도 표시하지 않는다.
- 연결이 끝나면 `getCurrentWorkspace` 쿼리와 문서 세션을 새로고침한다(`WorkspaceConnectionProvider`의 기존 새로고침 함수 사용).

- [ ] **Step 1:** 테스트:
  - `clones then connects the chosen repository for the given project`: Fake에서 `alreadyCloned: false` → `cloneRepository`가 `parentDirectory`로 호출되고, 이어 `connect("project-1", id, "a/docs")`.
  - `skips cloning when the repository is already in the app folder`
  - `shows the OKF warning after connecting a non-OKF repository`: `okf: false` → "OKF 형식에 맞지 않는 저장소입니다." 표시.
  - `never shows a local path`: 렌더된 텍스트에 `parentDirectory` 값이 없다.
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인(스토리 포함).
- [ ] **Step 5:** 커밋 `feat: pick a docs repository per project`

## PR 4: 문서 저장소 최신 유지

### Task 8: fast-forward pull (백엔드)

**Files:**
- Modify: `src-tauri/src/repository/service.rs` (`GitRepositoryPort`에 메서드 추가), `src-tauri/src/repository/git2_adapter.rs`
- Create: `src-tauri/src/commands/docs_repository.rs`에 명령 추가

**Interfaces:**
- Produces:
  - `#[serde(rename_all = "snake_case")] pub enum PullOutcome { Updated, UpToDate, SkippedLocalChanges, SkippedNotOnDefaultBranch, SkippedDiverged }`
  - `GitRepositoryPort::fast_forward_default_branch(&self, path: &Path, clean_remote_url: &str, access_token: AccessToken) -> Result<PullOutcome, AppError>`: `origin`을 fetch(clone과 같은 자격 증명 콜백 `clone_credential_for_callback`), 기본 브랜치는 `refs/remotes/origin/HEAD`가 가리키는 브랜치(없으면 원격 기본 브랜치를 fetch 결과에서 결정). 작업 트리에 추적 파일 변경이 있으면 `SkippedLocalChanges`, HEAD가 기본 브랜치가 아니면 `SkippedNotOnDefaultBranch`, fast-forward가 불가하면 `SkippedDiverged`.
  - 명령 `pull_docs_repository() -> CommandResult<PullOutcome>`: 현재 워크스페이스(앱 관리 clone)에 적용. 현재 워크스페이스가 없으면 `UpToDate`.
- 미추적 파일은 변경으로 치지 않는다(사용자가 둔 `node_modules` 등).

- [ ] **Step 1:** 테스트(임시 bare 원격 + clone, 기존 `clones_a_temporary_bare_remote_and_emits_only_public_stages` 헬퍼 재사용):
  - `fast_forwards_when_the_remote_moved`
  - `fast_forwards_a_non_main_default_branch` (원격 기본 브랜치 `trunk`)
  - `skips_when_tracked_files_changed` / `ignores_untracked_files`
  - `skips_when_on_another_branch`
  - `skips_when_histories_diverged`
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인.
- [ ] **Step 5:** 커밋 `feat: fast-forward the docs repository from GitHub`

### Task 9: 주기적 pull과 안내 (프런트)

**Files:**
- Create: `src/features/docs-repository/useDocsRepositorySync.ts`, `src/features/docs-repository/useDocsRepositorySync.test.tsx`
- Modify: `src/app/AppRoutes.tsx`의 `ConnectedAppShell`(훅 실행), `src/pages/DocumentsPage.tsx`(안내 표시)

**Interfaces:**
- Consumes: Task 8 `pull_docs_repository` (`DocsRepositoryGateway.pull(): Promise<PullOutcome>`로 추가)
- Produces: `useDocsRepositorySync(): { lastOutcome: PullOutcome | null }` — 마운트 시, 활성 프로젝트가 바뀔 때, 5분(`DOCS_PULL_INTERVAL_MS = 300_000`)마다 pull. `Updated`면 문서 세션 새로고침. `Skipped*`면 Documents에 "작업 중인 변경이 있어 최신 내용을 받지 않았습니다." 표시(`SkippedDiverged`도 같은 문구). 실패는 `console.warn`만 하고 다음 주기에 다시 시도한다.

- [ ] **Step 1:** 테스트(가짜 타이머): `pulls on mount and every five minutes`, `refreshes documents only after an update`, `shows the notice when the pull was skipped`, `pulls again when the active project changes`.
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인.
- [ ] **Step 5:** 커밋 `feat: keep the docs repository up to date while the app runs`

## PR 5: AI 터미널 worktree 규칙과 GitHub 권한

### Task 10: 고정 worktree 규칙과 토큰 전달

**Files:**
- Modify: `src-tauri/src/settings/ai_runner.rs` (`compose_rules`에 고정 규칙 추가)
- Modify: `src-tauri/src/settings/ai_terminal.rs` (`AiTerminalRegistry::start`에 환경 변수 인자)
- Modify: `src-tauri/src/settings/commands.rs` (`start_ai_terminal`, `prepare_ai_terminal`, `load_ai_rules`, `write_rules_file`)

**Interfaces:**
- Produces:
  - `pub fn worktree_rules(repository_root: &Path, worktrees_root: &Path) -> String` — 다음을 지시하는 고정 문구(실제 경로를 넣어서):
    1. 원본 clone(`repository_root`)에서 직접 파일을 고치거나 커밋하지 않는다.
    2. 작업마다 `git -C <repository_root> worktree add <worktrees_root>/<branch> -b <branch>`로 worktree를 만들고 그 안에서 작업한다.
    3. 원본 clone에 있고 git이 추적하지 않는 큰 폴더(`node_modules` 등)는 worktree에 복사·설치하지 말고 링크한다. Windows: `cmd /c mklink /J <worktree>\<dir> <repository_root>\<dir>`, macOS: `ln -s <repository_root>/<dir> <worktree>/<dir>`.
    4. 사용자가 요청하면 커밋·푸시하고 `gh pr create`로 PR을 연다.
    5. 세션을 시작하면 `git -C <repository_root> worktree list`를 보고, PR이 머지된 브랜치의 worktree를 `git worktree remove`로 지운 뒤 `git worktree prune`을 실행한다.
  - `compose_rules(app_rules: &str, fixed_rules: &str, project_rules: Option<&str>) -> String` — 순서: 앱 규칙, 고정 규칙, 프로젝트 규칙. 앱 AGENTS.md 템플릿은 바꾸지 않는다.
  - `pub fn terminal_env(access_token: Option<&str>) -> Vec<(String, String)>` — 토큰이 있으면 `GH_TOKEN`, `GIT_TERMINAL_PROMPT=0`, 그리고 `GIT_CONFIG_COUNT=2`, `GIT_CONFIG_KEY_0=credential.https://github.com.helper`, `GIT_CONFIG_VALUE_0=` (빈 값으로 기존 helper 초기화), `GIT_CONFIG_KEY_1=credential.https://github.com.helper`, `GIT_CONFIG_VALUE_1=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f`. 토큰이 없으면 빈 벡터.
  - `AiTerminalRegistry::start(&self, command_line, workspace_dir, cols, rows, env: &[(String, String)], sink)`
- `start_ai_terminal`은 `state.auth`의 `valid_access_token()`이 성공할 때만 토큰을 넘긴다. 실패해도 터미널은 연다.
- 토큰은 앱 로그인 토큰(만료 8시간)이다. 터미널을 8시간 넘게 열어 두면 푸시가 실패할 수 있고, 새 터미널을 열면 해결된다. 이 내용을 고정 규칙 끝에 한 줄로 넣는다.

- [ ] **Step 1:** 테스트:
  - `fixed_rules_sit_between_app_and_project_rules`
  - `worktree_rules_name_the_real_paths`: 결과에 `repository_root`와 `worktrees_root` 문자열이 들어 있다.
  - `terminal_env_omits_credentials_when_signed_out`: `terminal_env(None).is_empty()`.
  - `terminal_env_routes_git_credentials_to_the_token`: `terminal_env(Some("t"))`에 `("GH_TOKEN","t")`와 `GIT_CONFIG_COUNT`가 있다.
  - `ai_terminal.rs`의 PTY 테스트에 `environment_reaches_the_shell`: `env=[("OKHUB_TEST_MARKER","marker-value")]`로 시작해 `echo %OKHUB_TEST_MARKER%`(Windows)/`echo $OKHUB_TEST_MARKER` 출력에 `marker-value`가 나온다.
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인.
- [ ] **Step 5:** 커밋 `feat: run AI terminal work in worktrees with the app GitHub login`

### Task 11: AI 화면 컨텍스트 표시

**Files:**
- Modify: `src-tauri/src/settings/commands.rs` (`AgentsMdResolution`에 `repository_full_name: Option<String>` 추가, 경로 필드는 그대로 두되 화면에서 쓰지 않음)
- Modify: `src/pages/AiPage.tsx`, `src/features/ai/AiGateway.ts`, `src/test/FakeAiGateway.ts`
- Test: `src/pages/AiPage.test.tsx`

**Interfaces:**
- 화면 문구(컨텍스트 요약 `section`):
  - `프로젝트: {activeProjectTitle}`
  - `문서 저장소: {repository_full_name}` / 없으면 `문서 저장소를 선택하세요` + Documents로 가는 `Link`
  - `AI 규칙: 앱 기본 규칙 + 작업 규칙(worktree·PR)` 에 저장소 규칙이 있으면 ` + 저장소 규칙(.okf/AGENTS.md)` 덧붙임
- 파일 경로(`workspace_path`, `path`)는 화면에 표시하지 않는다.

- [ ] **Step 1:** 테스트 `shows the docs repository name instead of paths`: Fake가 `workspace_path: "C:\\x"`, `repository_full_name: "a/docs"`를 돌려줄 때 "문서 저장소: a/docs"가 보이고 `C:\x`는 보이지 않는다. `asks to choose a docs repository when none is connected` 추가.
- [ ] **Step 2–4:** 실패 확인, 구현, 통과 확인.
- [ ] **Step 5:** 커밋 `feat: describe the AI terminal target in plain words`

## PR 6: 예전 로컬 연결 경로 제거

### Task 12: 로컬 폴더 선택과 기존 clone 연결 UI·명령 제거

**Files:**
- Delete: `src/features/workspace-connection/components/LocalConnectionStep.tsx`, `src/features/workspace-connection/clone-target-path.ts`와 각 테스트
- Modify: `src/features/workspace-connection/machine/*`, `WorkspaceConnectionProvider.tsx`, `WorkspaceConnectionPage.tsx`, `WorkspaceConnectionGateway.ts`, `TauriWorkspaceConnectionGateway.ts`, `FakeWorkspaceConnectionGateway.ts` (로컬 단계·`pickDirectory`·`inspectExistingClone`·`cloneIntoSelectedParent`·`getWorkspaceForProject`·`setWorkspaceForProject`·`listRememberedWorkspaces` 제거)
- Modify: `src-tauri/src/settings/commands.rs`, `service.rs`, `lib.rs` (`get/set_workspace_for_project`, `list_remembered_workspaces`, `REMEMBERED_WORKSPACES_KEY` 제거). `inspect_existing_clone` 명령은 Task 6이 쓰지 않으면 제거한다.

**Interfaces:**
- 연결 화면(`WorkspaceConnectionPage`)은 GitHub 로그인 단계만 남는다. 저장소 선택은 Task 7의 picker가 맡는다.

- [ ] **Step 1:** `rg "LocalConnectionStep|pickDirectory|inspectExistingClone|cloneIntoSelectedParent|WorkspaceForProject|RememberedWorkspaces" src src-tauri/src`로 사용처를 모두 찾는다.
- [ ] **Step 2:** 각 사용처와 그 테스트를 지운다. 로그인 흐름 테스트(`WorkspaceConnectionProvider.test.tsx`의 auth 관련)는 남아 통과해야 한다.
- [ ] **Step 3:** 전체 검사와 `pnpm test:storybook` 통과. `pnpm test:visual`에서 지운 스토리를 참조하는 스냅샷이 있으면 함께 정리한다.
- [ ] **Step 4:** 커밋 `refactor: remove local folder selection`
