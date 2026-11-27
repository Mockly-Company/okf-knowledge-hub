# Shared Workspace Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in this session. 기존 변경사항을 보존하고 별도 승인 없이 commit/push하지 않는다.

**Goal:** 기준 저장소의 공유 YAML을 앱과 MCP가 동일하게 해석하고, 사용자가 확인한 연결만 등록·사용한다.

**Architecture:** GitHub 기본 브랜치를 SHA로 고정해 읽는 공용 resolver와 로컬 등록 registry를 분리한다. 앱과 MCP는 resolved workspace를 소비하고 개인 settings의 연결 값으로 공유 정의를 덮어쓰지 않는다.

**Tech Stack:** Rust 1.88, 기존 GitHub 서비스·serde_yaml_ng·Tauri, React/TypeScript, rmcp 1.2.0. 새 서비스나 서버는 추가하지 않는다.

**Spec:** `docs/superpowers/specs/2026-11-23-shared-workspace-source-design.md`

## 실행 순서 — 2026-11-24 재구성

| 단계 | 작업 | 완료 기준 |
|---|---|---|
| A · 먼저 구현 | Task 0~3: 백업, 공용 모델/원격 조회, 앱·MCP 읽기 어댑터 일치 검증 | 설정 저장·GitHub 쓰기 없이 같은 SHA에서 같은 정의와 오류를 반환 |
| B · 등록과 관리 | Task 4~5: 로컬 registry, 기존 ID 이관, 등록·복구 UI | 사용자 확인 후에만 등록/이관하며 기존 개인 상태 보존 |
| C · 설정이 없는 팀 | Task 6: YAML 초안, 명시적 PR 생성, 병합 대기 | 실패·재시도·취소를 구분하고 병합 뒤 다시 확인해야 등록 |
| D · 운영 전환 | Task 7~8: 앱·MCP 기본 경로 통합, 회귀·인계 | 등록된 공유 정의만 사용하며 승인·완료·중복 방지 회귀 통과 |

첫 구현 범위는 **단계 A만**이다. 2026-11-24 단계 A 구현·검증 완료: Rust 666 passed / 1 ignored, doc-tests 2 passed, build 및 Rust 1.88 all-targets check 통과. 실환경 설정 변경·운영 연결 전환 없음. B~D는 범위에서 제거한 것이 아니라 후속 구현 단위다. 단계 A 완료 보고에서 실제로 구현된 조회 경로와 아직 전환하지 않은 운영 경로를 구분한다.

단계 A에서는 새 등록 화면·설정 파일 생성·ID 이관·개인 설정 저장·캐시 영속화·기존 연결 전환을 하지 않는다. 읽기 어댑터의 공용 결과 일치는 테스트로 검증하고, 실제 기본 도구/화면이 모두 전환됐다고 표현하지 않는다.

## 2026-11-25 관리 UI 범위 갱신

- 개인별 기본 보드 설정은 이번 범위에서 제외한다. 팀 YAML 기본값만 읽기 전용으로 표시한다.
- 상세는 breadcrumb → workspace 이름 순서다. 가져오기는 목록에만 두고, 새로고침은 확인 시각 옆 아이콘으로 제공한다.
- 원본 설정에 대한 반복 설명과 기술 정보는 기본 화면에서 제외한다. 설정 저장소 변경·연결 해제는 `⋯`에서 제공한다.
- 이 갱신은 계획·시안 변경이며, 운영 앱·MCP의 기본 대상 정책을 지금 변경한 것은 아니다. 기존 데이터는 보존한다.

## Global Constraints

- 실제 업무 GitHub 및 `.okf/workspace.yml`, 외부 연결 설정은 변경하지 않는다.
- `workspace.id`는 이름·Project·저장소 이름과 독립적인 UUID이다.
- 공유 원본은 등록한 기준 저장소이며 캐시·로컬 clone은 최신 원본을 대체하지 않는다.
- 원격 요청 실패·접근 실패·stale 상태를 숨기지 않는다. 캐시만으로 쓰기하지 않는다.
- GitHub 권한은 인증 주체의 실제 권한으로 확인한다. 설정 등록은 권한 부여가 아니다.
- 기존 dirty MCP 및 AppShell 변경을 보존한다. 구현 전 해당 파일과 Git 상태를 별도 백업한다.
- 자동 commit/push, 실제 YAML 이관, 실제 팀 대상 쓰기 테스트는 하지 않는다.
- 제품에는 사용자 확인을 거친 설정 PR 생성 기능을 구현하되, 개발·검증 중 실제 팀 저장소로 PR을 만들지 않는다. 실제 GitHub 테스트는 별도 승인된 테스트 대상에서만 한다.
- Projects/코드 저장소가 없어도 문서 전용 등록을 허용한다. 관련 기능만 비활성화한다.

## Review Focus

1. fork가 같은 UUID와 원래 팀 대상을 유지한 경우 자동 병합/등록/쓰기되지 않는가 — Task 2/4/5.
2. 원격 main이 미리보기와 확인 사이에 바뀌는 경우 다른 연결을 등록하지 않는가 — Task 2/3/5.
3. 로컬 clone 또는 이전 Project 설정이 공유 정의를 덮어쓰지 않는가 — Task 3/4/7.
4. UUID 이관 뒤 clone·선택·개인 상태·기존 requestId journal이 손상되지 않는가 — Task 4/7.
5. 공유 정의 캐시가 있어도 인증/네트워크 실패를 정상 최신 상태로 표시하지 않는가 — Task 2/3/5/7.

## 단계 A: 공용 조회 기반과 일치 검증

### Task 0: 현재 변경과 설정의 안전한 기준점 확보

**대상:** 현재 `feat/design-system-rollout` 작업 트리의 tracked/untracked 변경, 기존 MCP 실행 파일, 개인 설정의 검증용 해시.

- [x] 실제 branch/HEAD/worktree 경로를 확인한다. tracked diff만이 아니라 untracked MCP·docs 파일을 포함해 iCloud 밖 작업별 백업을 생성하고 파일 manifest/hash를 검증한다. 기존 백업을 덮어쓰지 않는다.
- [x] 원래 dirty 파일과 이번 작업 파일을 기록한다. AppShell·기존 승인창 수정을 보존하고 stash/reset/자동 commit하지 않는다.
- [x] 개인 settings와 Codex MCP 설정의 해시를 기준점으로 기록한다. 비밀 설정 원문은 출력하지 않는다. 테스트는 임시 app-data 및 GitHub fixture를 사용한다.
- [x] 기존 Rust 전체 테스트를 기준 실행하고 실패/ignored 항목을 기록한다. 이후 결과와 비교한다.

## Task 1: 공유 정의와 공용 결과 모델

**Files:** `src-tauri/src/workspace/model.rs`, `workspace/validation.rs`, 새 `workspace/shared.rs`, `workspace/mod.rs`.

**Interfaces:**
- `DocumentsConfig.repository: Option<GithubRepositoryRef>` (serde default, omitted when absent).
- `LinkedRepository.roles: Vec<WorkspaceRepositoryRole>`; enum은 planning/design/frontend/backend, default empty.
- `ResolvedSharedWorkspace`: UUID, name, sourceRepository, docsRepository, codeRepositories, projects, defaultProjectId, provenance, targetFingerprint.
- `WorkspaceProvenance`: repositoryId/fullName, branch, commit, path, fetchedAt, freshness(live/stale), warning.

- [x] RED: 기존 v1 YAML 그대로 parse/serialize, 기준 저장소와 별도 문서 저장소, FE/BE 겸용 저장소, 잘못된 역할/UUID/중복 Project·repo 충돌 테스트 추가.
- [x] `cargo test --locked --lib workspace::`로 기대 실패 확인.
- [x] 위 필드와 검증 구현. 기존 extra 기반 동명 필드가 중복 serialize되지 않도록 round-trip 확인. 자격증명 필드는 연결 정보로 사용하지 않으며 문서 예시에 포함하지 않음.
- [x] 기존 YAML 보존 테스트와 새 타입 테스트 통과 확인.
- [x] Projects 0개/코드 저장소 0개를 허용하고, `WorkspaceTargetAccess`(target, available/unavailable, error) 및 설정 조회 상태 found/missing/invalid/unavailable/empty_repository를 정의해 서로 구분한다. 설정 초안 모델은 Task 6에서 구현한다.

## Task 2: 원격 공용 resolver와 고정 출처

**Files:** 새 `workspace/shared_source.rs`, `workspace/shared.rs`, `github/client.rs`, `automation/mcp_workspace.rs`의 기존 조회 로직 참조.

**Interfaces:**
- `resolve_shared_workspace(github: &GithubService, source: &WorkspaceSourceRef, commit: Option<&str>) -> Result<SharedWorkspaceLookup, AppError>`.
- `SharedWorkspaceLookup`은 found(ResolvedSharedWorkspace)/missing/invalid/unavailable/empty_repository를 구분한다. 각 상태에는 확인 가능한 출처와 진단만 포함한다. commit 생략 시 기본 브랜치 SHA를 한 번 결정하며, 지정 시 SHA를 검증해 그 버전만 읽는다.
- `WorkspaceSourceRef`: immutable repositoryId, current fullName, configPath (고정 `.okf/workspace.yml`).
- 단계 A에는 영속 캐시를 추가하지 않는다. 이후 캐시 로더는 live 결과와 합치지 않고 freshness=stale 및 원인을 표시한다(Task 4).

- [x] RED: default branch 고정 SHA, 설정/규칙 같은 SHA, regular tracked text만 허용, 200 KiB 제한, truncated tree, 잘못된 YAML, 401/403/404/network 각각 테스트.
- [x] RED: source repo 이름 변경·동일 이름 다른 repoID·fork 표시와 자동 등록 없음·문서 저장소 권한 실패·이름만 바뀐 workspace 테스트. 등록 간 UUID 충돌 검사는 상태를 소유하는 Task 4에 유지한다.
- [x] 기존 GitHub 조회와 오류 분류 재사용해 구현. 원격 설정 조회를 MCP 전용 모듈에 새로 복제하지 않음.
- [x] SHA/provenance 및 연결 fingerprint를 반환. 설정 원문 전체 fingerprint와 대상 연결 fingerprint를 구분해 내용 변경/대상 변경을 구별.
- [x] resolver fixture 테스트 통과. 실패를 빈 목록/로컬 YAML로 대체하지 않는지 확인.
- [x] RED: 정상 SHA/tree에서 파일 없음과 저장소 404·contents 404·권한 실패를 구분. 기본 브랜치 없는 빈 저장소는 empty_repository로 반환하고 자동 초기화하지 않음.
- [x] RED: 일부 코드/Project 권한 실패 시 대상별 진단을 반환하고 접근 가능한 문서는 읽을 수 있음. 실패 대상은 unavailable 진단으로 반환한다. stale 및 실제 쓰기 차단 연결은 Task 7에 유지한다.
- [x] 단계 A의 resolver는 선언된 대상과 조회 진단만 반환한다. 신규 등록·자동 clone·코드 실행·원격 mutation이나 쓰기 허용 범위 확대를 수행하지 않는다. 실제 쓰기 차단 연결은 Task 7에서 구현한다.

## Task 3: 앱·MCP 읽기 어댑터와 동일 결과 검증

**Files:** 새 `workspace/shared_read.rs`, `commands/docs_repository.rs`, `automation/mcp_workspace.rs`, 해당 모듈의 fixture 테스트. 기존 운영 routing은 변경하지 않음.

**Interfaces:**
- 공용 `read_shared_workspace(github, source, commit) -> Result<SharedWorkspaceLookup, AppError>`는 Task 2 resolver를 호출한다.
- 앱용 `preview_shared_workspace_definition`과 MCP 내부 `inspect_shared_workspace_definition`은 같은 source/commit을 받는 읽기 어댑터다. 등록·설정 저장·변경 실행을 호출하지 않는다. 이 단계에서 새 공개 MCP 도구는 추가하지 않는다.
- 두 어댑터의 core 결과는 UUID/name/source/docs/code/roles/Projects/defaultProject/provenance commit/fingerprint/진단이다. 조회 시각처럼 호출별 메타데이터는 동등성 비교에서 제외한다.

- [x] RED: 두 팀 fixture에서 같은 source+SHA로 앱·MCP 어댑터를 각각 호출하고 core 결과가 정확히 같음을 검증한다. FE/BE 겸용, Project 0개/복수, 명시적 별도 문서 저장소를 포함한다.
- [x] RED: 로컬 clone과 개인 settings에 다른 name/Project/repo를 넣어도 명시한 source+SHA 결과가 덮어써지지 않는다. 운영 개인 설정은 사용하지 않는다.
- [x] RED: 두 조회 사이 main 변경 → 같은 고정 SHA면 동일, SHA 생략 후 새 조회면 새 provenance를 반환하며 같은 결과라고 주장하지 않는다.
- [x] RED: missing/invalid/권한/네트워크/empty_repository 결과가 두 어댑터에서 동일하고 실패를 빈 정의로 바꾸지 않는다. fork/중복 UUID는 등록하지 않으며 새 연결을 발견해도 자동 사용하지 않는다.
- [x] 위 어댑터를 구현하되 `hydrate_mcp_remote_config`의 기존 운영 경로 교체는 Task 7까지 유보한다. 테스트 전용 분기를 production에 넣지 않는다.
- [x] 새 resolver/어댑터 테스트, `cargo test --locked`, `cargo build --locked`, Rust 1.88 `cargo check --locked --all-targets`, `cargo fmt --check`, `git diff --check`를 실행한다.
- [x] 단계 A 끝에 개인 설정 해시 불변·기존 MCP 승인/거절 회귀·AppShell 변경 보존을 확인한다. 실환경 조회는 추가 승인 없이 기존 인증의 읽기만 허용하되, fixture 결과와 실환경 미검증 범위를 구분한다.

**단계 A 완료 기준:** 공용 기능과 두 읽기 어댑터의 동일 결과·오류 분류가 테스트로 증명된다. 등록 UI/기본 운영 연결은 아직 이전 방식임을 명시하고 단계 B 진행 전에 결과를 보고한다.

## 단계 B: 등록·이관·관리 UI

## Task 4: 로컬 registry·명시적 legacy 이관

**Files:** 새 `settings/workspace_registry.rs`, `settings/model.rs`, `settings/service.rs`, `repository/managed.rs` 필요 시.

**Interfaces:**
- `WorkspaceRegistration`: workspaceId(UUID), source(WorkspaceSourceRef), acceptedTargetFingerprint, legacyIds.
- `WorkspaceRegistry::list`, `confirm_registration(preview, acceptedFingerprint)`, `resolve_id(id)`.
- 구형 `HubWorkspace`는 앱 wire compatibility용 resolved DTO/legacy DTO로 유지하되 새 공유 정의 저장 원본으로 사용하지 않음.

- [ ] RED: 기존 settings byte 보존, 최초 시작 무이관, 확인 시만 UUID+별칭 저장, active ID/clone 연결 보존, 실패 시 rollback 테스트.
- [ ] RED: 다른 source가 같은 UUID 선언 시 거절, 같은 source 재등록 중복 없음, 모호한 legacy ID 매핑 거절, 등록 제거 시 다른 팀 항목 무변경 테스트.
- [ ] registry는 새 키로 저장하고 기존 키는 복구/호환용으로 보존. 외부 작업 journal과 requestId는 재작성하지 않음.
- [ ] Project/repo 기반 캐시 키의 참조 목록을 `rg`로 확인하고 UUID alias lookup을 공용화. clone을 이름 변경 때문에 재생성하거나 자동 이동하지 않음.
- [ ] 저장소 이름/조직 이전 시 ID 검증 후 참조 갱신하고, workspace UUID는 유지함을 테스트.
- [ ] 2026-11-25 범위 변경: 개인별 기본 Project 지정·저장 기능은 구현하지 않는다. Workspaces 설정은 YAML의 팀 기본 보드를 읽기 전용으로 표시하고, 첫 항목을 기본으로 추정하지 않는다. 기존 개인 선호 데이터는 보존하며 자동 삭제·이관하지 않는다. 작업 보드 선택은 Project 화면으로 분리한다.
- [ ] 등록 해제는 다른 항목·GitHub 자원·clone/수정 파일·journal을 보존한다. active 선택은 해제하고 선택 화면으로 이동한다. 명시적 해제 표시로 legacy fallback이 같은 항목을 되살리지 않는지 재시작 테스트한다.
- [ ] 필요 시 공용 캐시를 이 단계에서 추가하고 provenance/freshness/실패 원인을 저장한다. 캐시 내용을 공유 원본으로 사용하지 않는 테스트를 추가한다.

## Task 5: 앱의 기준 저장소 등록 미리보기·확인

**Files:** `commands/docs_repository.rs`, `lib.rs`, `features/docs-repository/DocsRepositoryGateway.ts`, `infrastructure/docs-repository/TauriDocsRepositoryGateway.ts`, `features/workspace-setup/WorkspaceConnectDialog.tsx`, `WorkspaceSetupFlow.tsx`, `features/active-project/ActiveProjectProvider.tsx`, 관련 Fake gateway/테스트.

**Interfaces:**
- Tauri `preview_shared_workspace(sourceUrl)` → Task 3 읽기 어댑터 결과에 미리보기 ID/만료/확인 상태를 추가.
- `confirm_shared_workspace(previewId, fingerprint)` → 등록된 resolved HubWorkspace.
- 등록 확인 직전 원격 재조회. 출처 SHA가 바뀌면 새 미리보기 요구하고 저장하지 않음.

- [ ] RED: 주소 입력 → 기본 브랜치 YAML → UUID/문서/code/Projects 표시 → 확인 시만 registry 저장 테스트.
- [ ] RED: 취소/미확인/만료/원격 변경/fork 충돌/권한 없음에서 무등록 테스트.
- [ ] 기존 Project/문서 저장소 직접 연결은 legacy 경로로 명시. 공유 workspace에 로컬 attach/detach로 공유 대상을 덮어쓰지 못하도록 UI와 backend 모두 차단.
- [ ] stale 화면에 마지막 조회 시각·오류 표시. 인증 추가/권한 부여처럼 표현하지 않음.
- [ ] 새 등록은 clone이나 GitHub 쓰기를 수행하지 않음. 실제 작업 진입에서 기존 clone 기능 사용.
- [ ] `pnpm test:run` 및 `pnpm exec tsc -b`로 gateway wire contract와 UI 테스트 확인.
- [ ] 연결 관리에 기준 저장소/고정 출처/마지막 조회/대상별 접근 결과, 이전·새 연결 비교와 재확인, 재시도·재연결·이 기기 등록 해제를 추가한다. 이름만 변경된 경우 UUID/개인 설정을 유지한다.
- [ ] RED: 등록 중복은 기존 항목 안내, 다른 source의 UUID 충돌은 차단, source 교체는 비교·확인 전 저장하지 않음. 취소 시 입력과 기존 연결 유지.
- [ ] RED: 문서 전용 등록 성공 및 보드만 비활성화, 대상 일부 실패 표시, 팀 기본 보드의 위치·기본값 없음·기본 대상 삭제/잘못된 참조를 구분하는 테스트. 개인 기본 보드 설정 UI는 추가하지 않는다. 앱 프레임과 문서 본문은 재설계하지 않음.
- [ ] 390px/1024px/1440px에서 단계형 폼·비교 화면·오류 상태·키보드 포커스·스크린리더 레이블 확인.

## 단계 C: 설정 파일이 없는 팀의 초기 설정

## Task 6: 설정 파일이 없을 때 작성·PR·병합 대기

**Files:** 새 `workspace/setup.rs`, `commands/docs_repository.rs`, `github/client.rs`의 기존 브랜치/파일/PR 기능 재사용, 새 `features/workspace-setup/WorkspaceDefinitionForm.tsx`, `WorkspaceSetupFlow.tsx`, gateway와 Fake gateway/테스트.

**Interfaces:**
- `SetupDraft`: 고정 UUID, source, YAML, 입력, requestId와 상태를 가진 로컬 미등록 초안.
- `prepare_workspace_definition(input) -> SetupDraft`: source/이름/문서 저장소/선택적 code/Projects를 검증하고 UUID 고정 YAML 초안을 반환. 기존 파일을 덮어쓰는 초안은 만들지 않음.
- `publish_workspace_definition(previewId, fingerprint, requestId) -> SetupPublishResult`: 사용자가 내용과 원격 대상을 확인한 뒤 명시적 요청으로만 실행. 결과는 draft/creating_pr/awaiting_merge/publish_failed/ready_to_register/cancelled이며 부분 생성된 branch/PR 링크와 재시도 가능 범위를 포함.
- `refresh_workspace_setup(draftId) -> SetupPublishResult`: PR 정보 및 기본 브랜치 YAML을 확인. 반환만 하고 자동 등록하지 않음.

- [ ] RED: missing일 때만 작성 안내; invalid/unavailable/empty_repository는 각각 수정·재시도·초기화 안내. 조회 실패를 missing으로 전환하지 않음.
- [ ] RED: 초안 편집 중 UUID 유지, 입력/초안 미리보기 보존, 취소·복사·다운로드에 원격 쓰기와 등록 없음. 비밀값을 YAML에 생성하지 않음.
- [ ] 폼은 기준 저장소를 문서 저장소 기본 후보로 명시하고 다른 문서 저장소를 선택 가능하게 한다. Project/code는 선택 사항이다.
- [ ] RED: PR 제출 전 저장소 쓰기 권한·기본 브랜치·설정 여전히 없음·초안 fingerprint 재검사. 중간에 파일이 생기면 덮어쓰지 않고 기존 정의 미리보기로 안내.
- [ ] RED: 요청 ID별 branch/commit/PR 결과 기록; 확정 성공 단계만 재사용하고 결과 불명확 시 무작정 재전송하지 않음. 실패·재시작 재개에 중복 branch/PR 없음.
- [ ] 기존 PR 생성 기능을 재사용하고 기본 브랜치 직접 push/자동 merge는 구현하지 않음. empty_repository는 PR 생성 차단. 등록 확인과 GitHub 쓰기 확인을 별개 단계로 제공.
- [ ] RED: PR open/closed-unmerged/merged, 타인이 설정을 추가, merge 후 YAML 내용 변경/오류, 사용자 취소 각각 테스트. merged만으로 등록하지 않고 기본 브랜치 재검증 후 Task 5의 확인으로 이동.
- [ ] 병합 대기에서 PR 링크·다시 확인·나중에 계속/로컬 초안 취소를 제공. 자동 poll·자동 등록을 하지 않음. 취소해도 생성된 원격 PR/branch를 자동 삭제하거나 닫지 않으며 링크를 유지.
- [ ] 단계별 상태·정확한 실패 범위 및 재시도 UI를 테스트. 최초 제품 기능 검증은 가짜 GitHub transport로 수행.

## 단계 D: 운영 경로 전환과 최종 검증

## Task 7: MCP와 앱의 공용 해석 통합

**Files:** `automation/mod.rs`, `automation/mcp_workspace.rs`, `automation/mcp_sdk.rs`, `automation/mcp_rules.rs`, `settings/commands.rs`, `features/active-project/ActiveProjectProvider.tsx`.

- [ ] RED: 동일 registry에 앱/MCP의 UUID·대상·출처·fingerprint 동일, 로컬 clone이 있어도 원격 설정 우선 테스트.
- [ ] RED: 명시적 legacy 별칭 호환, 미확인 source/변경된 연결/stale에서 쓰기 차단, 사용자 확인 후 원격 변경 시 무변경 테스트.
- [ ] 목록은 등록 source만 나열. 공유 설정의 링크를 발견했다는 이유로 다른 workspace/source를 자동 등록하지 않음.
- [ ] `hydrate_mcp_remote_config`를 공용 resolver 호출로 교체하고 중복 원격 파싱 제거. `for_mcp_target`은 resolved 결과만 사용.
- [ ] get_active_context/workspace_list에 provenance/freshness/registrationRequired 및 권한 진단 반환. 규칙은 기준 저장소의 고정 SHA에서 읽고 위치를 명시.
- [ ] CLI `--docs-repo/--project`는 launch 전용 legacy 진단 모드로 구분. registry 대상이나 공유 설정을 조용히 변경하지 않음. 기존 테스트 연결 #4는 그대로 보존.
- [ ] 기존 승인 검사·완료 검사·중복 방지 테스트가 모두 통과하는지 확인.
- [ ] RED: Project 없는 workspace의 docs 도구는 성공, board 도구는 project_not_connected 진단. 부분 실패 항목은 명시하고 실패한 근거가 필요한 쓰기만 차단. source 최신성 실패면 모든 공유 대상 쓰기 차단.
- [ ] 후속 운영 전환에서 MCP 기본 Project는 시작 시 YAML 팀 기본 → 유일 Project 순으로 고정한다. 이번 범위에서는 개인 기본 보드 선호를 추가하거나 기본 대상 결정에 사용하지 않으며, 기존 운영 코드는 시안 수정만으로 변경하지 않는다. 복수/기본 없음은 projectId 요청. 호출별 projectId가 앱 선택/다른 호출 기본을 바꾸지 않는지 테스트한다.
- [ ] 명시적 등록 해제 이후 기존 ID 요청과 승인 대기 중 쓰기는 차단한다. 인증·네트워크 실패를 Project 삭제로 단정하지 않는다.

## Task 8: 예시·최종 검증·인계

**Files:** `docs/mcp.md`, 기존 workspace 형식 안내, 새 `docs/examples/shared-workspace.yml` (가상 팀/가상 ID만 사용).

- [ ] 문서 저장소=기준 저장소 및 별도 저장소인 두 예시, UUID 유지·fork 주의·개인 권한·캐시 정책·기존 항목 전환 안내 작성.
- [ ] `cargo test --locked`, `cargo build --locked`, Rust 1.88 `cargo check --locked --all-targets`, `cargo fmt --check`, `git diff --check`.
- [ ] `pnpm test:run`, `pnpm exec tsc -b`, `pnpm build` 실행. UI 변경 후 `pnpm test:storybook:smoke`도 실행한다. 실패는 원인·기존/신규 구분과 함께 보고.
- [ ] fixture로 두 팀/여러 Project/FE·BE 겸용/원격 실패/이관 뒤 재시작을 검증하고 실제 업무 GitHub 쓰기는 수행하지 않음.
- [ ] 설정 없음 → 초안 → PR 실패/재시도 → 병합 대기 → 기본 브랜치 재조회 → 등록 확인의 전체 fixture 및 UI 테스트. 기본 브랜치 없음·중복 등록·일부 접근 실패·등록 해제 재시작 회귀 포함.
- [ ] 변경 파일/테스트/미검증 실환경 항목 보고. 실제 hub-knowledge YAML 반영과 외부 앱 설정 전환은 별도 승인 후 진행.

## 검토 결과

### 문서 폴더 선택·제외 지원 (2026-11-27 합의, 미구현)

- [ ] 문서 저장소를 여러 개 지원한다. 다른 저장소에 문서 용도를 추가해도 기존 저장소를 교체하거나 연결 해제하지 않는다. 각 문서 저장소는 독립적인 포함·제외 폴더를 갖는다. 문서/코드 겸용도 유지한다.
- [ ] 기존 단일 `documents.repository` 및 `roots`에서 다중 저장소 형식으로의 마이그레이션·스키마 버전·구버전 앱/MCP 동작을 설계하고, 미지원 클라이언트가 첫 저장소만 조용히 읽거나 쓰지 못하게 한다. ID/경로/커밋을 저장소별로 식별하며 목록·검색·본문·작성 대상과 앱/MCP의 조회 결과를 함께 검증한다. 문서 저장소가 없는 상태의 허용 범위도 명시적으로 결정한다.
- [ ] 목록 행에서 용도 변경·폴더 변경을 구분해 변경 전후를 볼 수 있게 한다. 전체 변경은 한 요청으로 제출한다. 연결 해제는 ‘되돌리기’ 아이콘으로 원래 용도와 폴더 설정까지 복구한다. 이 시안의 다중 문서 저장소·제외 경로는 가상 상태이며 운영 코드/YAML은 아직 변경하지 않았다.

- [ ] 폴더 트리의 모든 항목은 선택 가능하게 유지한다. 상위 선택은 하위를 포함하고, 하위 일부를 해제하면 상위 체크박스는 부분 선택으로 표시한다. ‘포함됨’ 문구는 표시하지 않으며 루트 선택 이름은 ‘전체’로 한다.
- [ ] 현재 `documents.roots`는 포함 경로만 지원한다. 시안의 제외 경로는 가상 상태일 뿐 운영 YAML에 지원되는 것으로 취급하거나 포함 경로만으로 조용히 변환하지 않는다.
- [ ] 구현 전에 제외 경로의 YAML 필드·스키마 버전·구버전 클라이언트 차단/호환 정책을 확정한다. 상위 포함·하위 제외·더 깊은 재포함은 가장 구체적인 경로 규칙을 우선하며, 단순 포함/제외 배열로 이 의미를 보장할 수 없다면 형식부터 보강한다.
- [ ] 문서 목록/본문/검색/인덱스/캐시/작성 대상 검사와 앱·MCP에 동일한 경로 판정기를 적용한다. 제외된 문서는 후속 직접 읽기에서도 차단하고 캐시 결과에서 제거한다. 경로 이탈·심볼릭 링크 보안 정책은 유지한다.
- [ ] ‘미지정’은 전체 조회가 아니다. 기존 필수 루트 검증을 보존하고 ‘전체’ 선택은 명시적인 `.` 포함으로 저장한다.
- [ ] 상위 전체 선택, 하위 제외, 재선택, 부분 선택, 전체 해제, 재열기·왕복 저장, 변경 검토의 제외 내역, 앱/MCP 결과 일치 및 구버전에서 제외 무시 방지를 테스트한다. 폴더 목록은 실제 저장소의 고정 커밋에서 조회하며 시안 fixture를 운영 데이터로 사용하지 않는다.

공유 원본·등록 흐름·개인 상태·ID 호환·원격 실패·fork 보호와 초기 설정/운영/복구를 단계 A~D, Task 0~8에 배정했다. 우선 단계 A만 구현하고 결과를 보고한다. 문서 전용 사용·부분 접근 실패·해제 시 데이터 보존은 후속 단계에 유지했다. 개인별 기본 Project 지정은 2026-11-25 사용자 결정으로 범위에서 제외했으며, Project 화면의 작업 보드 선택과 구분한다. 이번 수정은 계획 문서에 한정하며 제품 코드는 변경하지 않는다. 확인창 수정은 별도 완료 상태로 보존하고 실제 승인/거절/중복 테스트는 아직 완료로 간주하지 않는다.
