# Workspace Connection 구현 상태 조사 및 통합 구현 계획

> 실행자는 승인된 계획을 작업별로 진행한다. superpowers:executing-plans를 사용한다. 독립 작업은 아래에 표시하지만 실제 에이전트 위임은 별도 선택 사항이다. 사용자의 “진행해줘”로 구현이 승인되었다. 후속 요청으로 이번 변경의 commit/push도 승인되었다. PR과 실계정·다운로드 검증은 별도 승인 대상이다.

**목표:** 승인된 Workspace Connection 화면을 유지하면서 실제 GitHub 인증부터 검증·저장·복원·Home 진입까지 막히는 통합 경로만 보완한다.

**구조:** 실제 화면 → WorkspaceConnectionProvider → TauriWorkspaceConnectionGateway → 등록된 Rust command → Auth/Github/Repository/Workspace/LocalSettings 서비스. 기존 구현을 재사용한다. Storybook fake는 UI 상태 재현용이다.

**기술:** React 19, TypeScript, React Router HashRouter, Tauri 2, Rust, reqwest, git2, OS credential store, tauri-plugin-store.

**승인 기준:** `docs/product/screens.md` 최초 연결 화면, `docs/product/use-cases.md` UC-00 및 로그아웃·재로그인. 원본 저장소의 local-only AGENTS.md도 읽고 적용했다. `.superpowers/` HTML과 과거 계획은 제품 결정의 원본으로 사용하지 않는다.

## 1. 조사 환경과 판단 기준

- 기준: `1742c90878b90039cb8085ce55f854ea0cb89fe4`, `feat(workspace): refine connection flow and review stories`.
- 재사용 브랜치: `feat/workspace-connection-integration`.
- 재사용 worktree: `/Users/hyeeun/projects/okhub-worktrees/workspace-connection-integration`.
- 이번 조사 시작 시 해당 브랜치와 worktree가 이미 존재했다. HEAD가 지정 커밋과 일치하고 source 변경이 없으며 이 계획 문서만 미추적 파일인 것을 확인해 재사용했다. 기존 계획을 현재 코드와 대조하고 조사 환경 및 근거를 갱신했다. 디자인 worktree는 다른 세션의 미커밋 변경을 보존한다. 이 checkout은 앱의 managed worktree가 아니므로 native attachment가 지원되지 않았다.
- 원본 checkout과 디자인 worktree는 읽기만 했다. 원본의 미추적 계획 문서 3개도 보존했다.
- 조사에서는 계정 인증, GitHub API 실호출, 앱 실행, clone, 초기화, 의존성 설치를 실행하지 않았다. 기존 worktree 재사용과 이 계획 문서 갱신만 수행했다.
- 조사 시점에는 node_modules와 Rust target이 없었다. 구현 승인 후 이 worktree 전용 의존성과 빌드 산출물을 생성하고 자동 검증했다. 최종 결과는 아래 구현 결과와 검증 보고서에 기록한다.
- **구현 완료:** 코드에서 실제 동작과 연결 경로가 확인되고, 조사 범위 내 확인된 누락이 없는 부분. 실환경 합격을 의미하지 않는다.
- **구현됐지만 통합 검증 필요:** 실제 구현은 있으나 IPC·OS·GitHub를 포함한 사용자 흐름의 검증이 남았거나 일부 통합 결함이 있다.
- **미구현:** 필요한 사용자 경로 또는 동작이 없다.
- **결정 필요:** 승인 문서만으로 검증 강도나 추가 기능 범위를 확정하기 어렵다.

## 검토 시 집중할 실패 조건

- 이벤트 listener 한쪽만 실패하거나 늦게 설치되어도 loading 고착과 중복 listener가 없어야 한다(A).
- picker 취소·방법 전환·복구 중 이전 비동기 결과가 현재 경로를 덮어쓰거나 작업을 자동 시작하지 않아야 한다(B).
- 손상된 Git metadata와 remote identity/권한 오류를 구분하고 실제 접근 guard는 유지해야 한다(A/B).
- 동적 PR URL 및 opener/picker 거부는 secret-free 안내로 현재 화면에서 복구해야 한다(C).
- 연결 완료 전환만 Home으로 이동시키고 정상 Documents/Settings 탐색은 유지해야 한다(D).

## 2. 기준 커밋에서 조사한 기능별 상태와 근거

| 기능 | 상태 | 실제 호출 경로와 근거 | 남은 사항 |
|---|---|---|---|
| production gateway 선택 | 구현 완료 | `src/app/App.tsx` → `createWorkspaceConnectionGateway.ts`: Tauri 환경은 실제 gateway, 웹 환경은 Unavailable gateway | 브라우저/Storybook 성공을 desktop 성공으로 해석하지 않는다 |
| GitHub 로그인·Device Flow | 구현됐지만 통합 검증 필요 | `GitHubLoginStep.tsx` → provider `startLogin` → `begin_github_auth` → `AuthService::begin/run` → `ReqwestDeviceFlowApi`; `lib.rs` command 등록, `state.rs::with_auth_jobs` production 서비스 생성 | 실제 App 설정, 로그인, OS 저장소, 이벤트 전달 확인 |
| 인증 코드 복사 | 구현됐지만 통합 검증 필요 | `DeviceCodeCopy.tsx`가 clipboard plugin `writeText` 호출; `lib.rs` plugin 등록 및 capability `allow-write-text`; 실패 시 수동 선택 안내 | macOS/Windows 실제 clipboard 확인 |
| 인증 완료·만료·거절·오류 복구 | 구현됐지만 통합 검증 필요 | Rust polling이 pending/slow_down/denied/expired 처리, 만료 시 중단; auth 이벤트 → provider/reducer; 정상 대기에는 코드·유효 시각·인증 계속만 표시 | 이벤트 구독 실패 및 외부 URL 열기 실패는 아래 결함 참조 |
| 저장소 목록·새로고침·추가 페이지 | 구현됐지만 통합 검증 필요 | `RepositorySelectionStep` → provider `loadRepositories` → `list_github_repositories` → `GithubService::list_repositories`; 설치 목록 전체 조회 후 설치별 100개 page/cursor 처리 | 여러 installation, 100개 초과, 접근권한 변경, rate-limit 실경로 확인. App이 설치되지 않은 저장소는 이 목록에 포함되지 않는다 |
| 저장소 선택 후 다음 | 구현 완료 | 컴포넌트 local selectedId를 선택하고 `다음`에서만 provider `selectRepository` 호출; 로딩·오류 중 진행 차단 | UI 유지 |
| 기존 로컬 저장소 연결 | 구현됐지만 통합 검증 필요 | 폼 제출 → `connectExistingClone` → `inspect_existing_clone`; Git2가 root/bare/origin 확인, GitHub에서 node ID 대조; 이후 workspace 검사·connect·설정 저장 | 복구 폴더 선택과 PR 병합 후 폴더 선택이 즉시 검사/자동 연결하는 예외 경로 수정 |
| 새 위치 다운로드 | 구현됐지만 통합 검증 필요 | 선택 시 preview만 준비; 최종 제출 → `confirmCloneTarget` → `clone_repository`; Rust가 remote ID/URL 검증·토큰 취득·staging clone·덮어쓰기 없는 publish 수행 | 복구 시 선택한 상위 경로와 최종 버튼 상태 확인 |
| 다운로드 진행·완료·실패·재시도 | 구현됐지만 통합 검증 필요 | Git2 transfer/checkout callback → CloneCommandProgressSink → `repository-clone-progress`; reducer가 request ID로 이벤트 선별; 완료 후 inspect/connect, 실패 시 새 ID로 동일 semantic input 재시도 | 실제 중단·충돌·실패 후 재시도. 진행 숫자는 현재 sr-only이고 화면에는 다운로드 중 버튼을 표시한다 |
| Git 저장소·지식 저장소 identity 검증 | 구현됐지만 통합 검증 필요 | `Git2RepositoryAdapter::inspect`, `RepositoryService::inspect_existing`, `connect_workspace_inner`의 `repository_detail` 및 ID 대조 | 손상된 Git metadata 복원 오류를 local recovery로 전달하는지 보완 |
| `.okf/workspace.yml` 구조·경로 검증 | 구현 완료 | `workspace/inspection.rs`, `validation.rs`, `references.rs`: YAML/schema/UUID/이름/문서 상대 경로/저장소 key·ID/Project ID 및 문서 참조 검사 | 아래 UI 복구 누락과 원격 검증 범위는 별개 |
| 잘못된 YAML·미지원 버전 복구 | 미구현 | reducer는 `validation_failed`를 생성하지만 `LocalConnectionStep`은 폼을 숨기고 진단만 표시한다 | 같은 화면에서 경로 유지, 파일 열기/업데이트 안내/재검증 필요 |
| 초기화 preview 및 실행 | 구현됐지만 통합 검증 필요 | provider → preview/initialize commands → `WorkspaceService` 및 `RepositoryService::initialize`; 빈 저장소 direct push, 기존 콘텐츠 branch/push/Draft PR; durable attempt로 재시도 | 실제 로컬 commit·remote push·PR 생성은 승인된 disposable 대상에서만 검증. 초기화 backend 재작성 불필요 |
| 초기화 Draft PR 열기 | 미구현(통합 누락) | provider는 `openExternal` → opener plugin 호출하지만 capability가 동적 `.../pull/<number>` URL을 허용하지 않는다 | 제한된 허용 경로 및 실패 처리 필요 |
| 새 저장소 만들기 링크 | 구현됐지만 통합 검증 필요 | `RepositorySelectionStep`의 `https://github.com/new` target=_blank anchor | native opener로 명시 연결하고 허용 URL 추가. 생성 자체는 GitHub에서 사용자 수행 |
| 연결 설정 저장 | 구현됐지만 통합 검증 필요 | `LocalSettingsService::set_current_for_repository`가 canonical path·repository ID/name 저장; `TauriLocalSettingsStore::write`가 save 실패 시 메모리 rollback | 실제 settings 파일 저장 및 저장 실패 복구 확인; 토큰은 OS store에만 저장 |
| 재실행·재로그인 복원 | 구현됐지만 통합 검증 필요 | provider가 auth 확인 후 `get_current_workspace`; Rust auth guard, local YAML 재검사·GitHub 접근권한·origin ID 재확인. logout은 설정 유지 및 document session 무효화 | root 없음/손상 YAML은 recovery_required. `.git` 손상은 아래 결함 참조 |
| 연결 후 Home 진입 | 구현됐지만 통합 검증 필요 | `WorkspaceGate` connected → Outlet → `AppRoutes` index `HomePage`; 실제 account 인사말 표시 | 현재 hash가 `/settings` 등인 재로그인은 그 route를 유지한다. 승인 문서의 Home 자동 복귀와 맞추는 작업 필요 |
| Home Issue·진행률·활동 실데이터 | 미구현, 이번 연결 작업에서 제외 권고 | `HomePage.tsx`는 데이터 없음/빈 항목을 직접 표시하며 Project 조회 gateway가 없다 | Home 진입과 데이터 완성을 구분. 데이터 통합은 별도 작업 승인 필요 |
| 연결된 코드 저장소·GitHub Project 원격 검증 | 결정 필요 | 현재 YAML 검증은 구조와 참조 무결성; 원격 접근 확인은 지식 저장소에 한정. Project 조회나 코드 저장소별 원격 검증 호출이 없다 | UC-00의 “검증”을 구조 검증으로 볼지 원격 존재·권한까지 요구할지 확정 |

파일 경로는 별도 언급이 없으면 `src/features/workspace-connection/`, Rust는 `src-tauri/src/` 아래이다.

### 확인된 통합 결함

1. **최초 로딩 고착:** provider setup에서 auth/clone 이벤트 구독 중 하나가 실패하면 listener를 정리하고 바로 return한다. isCurrentWorkspaceLoading을 해제하거나 공개 오류를 표시하지 않는다. 기존 테스트는 listener cleanup만 확인한다.
2. **명시 실행 원칙의 예외:** `chooseAnotherCloneDirectory`의 기존 저장소 분기는 `connectExistingClone()`을 호출해 picker 결과 즉시 검사한다. `choosePostMergeClone`도 picker 결과를 즉시 검사한다. 검사 성공 후 provider effect가 자동 connect한다. 최초 폼의 정상 경로와 달리 별도 최종 연결 버튼을 거치지 않는다.
3. **YAML 복구 막힘:** validation_failed에는 폴더 폼·재검증·파일 열기·업데이트 동작이 없다. ConnectionError의 recovery 버튼 테스트는 AppError 경로만 확인하고 이 상태를 검증하지 않는다.
4. **native 외부 링크:** Draft PR URL과 새 저장소 URL은 현재 capability 허용 목록에 없다. PR은 실제 opener 호출이 거부될 구성이고 새 저장소는 raw anchor에 의존한다. `openVerificationUrl`/`openLocalPath`는 reject를 UI 오류로 전달하지 않는다.
5. **복원 오류 분류:** settings load는 경로/YAML 손상을 recovery_required로 바꾸지만, 유효 YAML 아래 `.git`만 손상되면 get_current_workspace의 inspect_existing_clone 오류가 provider authLoadFailed로 올라간다. 인증 화면의 choose_another_directory는 local 상태를 요구하므로 복구 picker까지 도달하지 못한다.
6. **Home 자동 복귀:** Gate는 현재 route의 Outlet을 연다. connected로 바뀌었다고 `/`로 이동하지 않으므로 Settings에서 logout/relogin 시 Home 자동 복귀가 보장되지 않는다.

### Storybook·테스트의 증거 한계

`src/stories/decorators/AppProviders.tsx`, `src/test/FakeWorkspaceConnectionGateway.ts`, connection stories는 실제 component/provider를 사용하지만 auth/clone 이벤트와 실패를 fake가 제공한다. provider·page·App·Tauri gateway 테스트도 mock/fake 호출 계약을 검증한다. Rust 테스트는 실제 Git/filesystem fixture 검사와 fake remote/credentials 테스트를 포함한다. 이는 회귀 검증 자산이며 실 GitHub·OS store·Tauri permission·웹뷰 이벤트 전달의 완료 근거가 아니다.

### 주요 근거 위치(기준 커밋)

| 확인 내용 | 위치 |
|---|---|
| 실제 gateway 선택 및 command/event 계약 | `src/app/App.tsx`, `src/infrastructure/workspace/createWorkspaceConnectionGateway.ts`, `src/infrastructure/workspace/TauriWorkspaceConnectionGateway.ts` |
| native plugin·command 등록, production 서비스 | `src-tauri/src/lib.rs::run`, `src-tauri/src/state.rs::with_auth_jobs` |
| Device Flow HTTP 및 polling | `src-tauri/src/auth/reqwest_api.rs::request_device_code/poll_access_token`, `auth/service.rs::begin/run`; OS 저장은 `auth/keyring_store.rs` |
| 복구 picker 즉시 실행 | `WorkspaceConnectionProvider.tsx:437`(choosePostMergeClone), `:509`(chooseAnotherCloneDirectory), `:780`(검사 후 자동 연결 effect) |
| listener 실패 시 loading 고착 | `WorkspaceConnectionProvider.tsx:747`; 기존 테스트 `WorkspaceConnectionProvider.test.tsx:180`은 정리만 검증 |
| YAML 오류에서 form 숨김, 복구 동작 부재 | `components/LocalConnectionStep.tsx:49`, `:88`; `retryLastAction`은 validation_failed를 처리하지 않음 |
| 목록 실제 조회·pagination | `src-tauri/src/github/client.rs:465`(list_repositories), `:629`(list_installations) |
| origin/Git identity 및 실제 clone | `repository/service.rs:275`, `:302`; 실제 git2 callback은 `repository/git2_adapter.rs:88` 이후 |
| 연결 저장 및 복원 | `commands/workspace.rs:347`, `:701`; `settings/service.rs:84`, `:174`; `settings/store_adapter.rs::write` |
| YAML 구조/경로/문서 참조 검증 | `workspace/inspection.rs::inspect`, `workspace/validation.rs::validate_workspace`, `workspace/references.rs::inspect_document_references` |
| 초기화 실제 commit/push/PR | `repository/service.rs:338` 및 resume_initialization, `repository/git2_adapter.rs::commit_initialization/push_branch`, `github/client.rs::create_draft_pull_request` |
| native URL 권한 및 Home route | `src-tauri/capabilities/default.json`, `WorkspaceGate.tsx`, `src/app/AppRoutes.tsx` |
| Storybook의 fake 경계 | `src/stories/decorators/AppProviders.tsx::createBoundary`, `src/test/FakeWorkspaceConnectionGateway.ts` |

frontend의 축약 경로는 `src/features/workspace-connection/`, Rust의 축약 경로는 `src-tauri/src/` 기준이다. 이 표는 구현 전 조사 근거다. 구현 후 자동 검증 결과는 아래와 별도 검증 보고서를 따른다.

## 3. 유지할 제약

- 기존 공용 UI/디자인 시스템과 승인된 레이아웃을 유지한다. 별도 다운로드 확인 카드를 만들지 않는다.
- 정상 인증 대기에는 취소·재시작 버튼을 추가하지 않는다. 만료·오류에서 복구한다.
- 저장소 선택은 `다음`에서 확정한다.
- 모든 local picker는 선택만 한다. 기존 연결·복구·병합 후 연결도 최종 제출 전 inspect/connect/clone을 호출하지 않는다.
- 작업 오류는 현재 화면에서 복구하고 선택 경로를 유지한다.
- request ID·auth lifecycle generation·Rust authenticated guard·remote identity·path safety를 유지한다.
- 토큰/device_code/비밀값은 화면·로그·계획·테스트 결과에 노출하지 않는다. userCode는 승인된 인증 화면에서만 표시한다.
- 기존 worktree의 source/미커밋 파일, UI 공용 컴포넌트, 다른 페이지 디자인을 수정하지 않는다.
- 이번 변경의 commit/push는 후속 요청으로 승인되었다. PR과 앱 초기화의 테스트용 remote 부작용은 별도 승인이 필요하다.

## 4. 필요한 작업만 포함한 구현 계획

### A. 시작 및 복원 실패를 복구 가능한 상태로 전달

**의존성:** 없음. B/C와 독립 설계 가능하지만 provider 수정은 순차 적용한다.

**파일:** `WorkspaceConnectionProvider.tsx`, `WorkspaceGate.tsx`, `machine/connection-actions.ts`, `machine/connection-state.ts`, `machine/connection-state-builders.ts`, `machine/connection-reducer.ts`; `src-tauri/src/commands/workspace.rs`; 필요 시 `src-tauri/src/settings/model.rs`.

- [x] 구독 실패 시 loading이 끝나고 공개 오류와 재시도 동작이 표시되는 테스트를 먼저 추가한다. 한 listener만 설치된 경우 정리, 재시도 시 중복 구독 없음, 늦은 결과 무시를 확인한다.
- [x] provider setup을 재실행 가능한 lifecycle로 묶고 `finally`에서 해당 요청의 loading을 해제한다. 기존 구독은 정리 후 다시 설치한다. Rust command 실행은 listener 설치 후에만 한다.
- [x] 유효 YAML + 손상된 `.git`/bare/root mismatch fixture를 만들어 get_current_workspace가 local recovery를 반환하는 Rust 테스트를 추가한다. permission/identity mismatch는 공개 오류로 유지한다.
- [x] local path 문제만 recovery_required로 매핑한다. 광범위하게 모든 GitHub 오류를 local recovery로 숨기지 않는다. 로그아웃 중 늦은 결과와 계정 변경 guard도 검증한다.
- [x] auth 성공을 취소하거나 토큰을 삭제하지 않고 저장된 연결 복원만 재시도할 수 있게 한다.

**완료 기준:** 구독 실패가 무한 로딩이 되지 않으며 실제 local corruption과 GitHub 접근 거절의 복구 동작이 구분된다.

### B. 모든 폴더 선택·복구 경로에 최종 실행 원칙 적용

**의존성:** A의 상태 변경과 충돌 확인. gateway와 backend의 clone/inspect 계약은 그대로 사용한다.

**파일:** provider, `components/LocalConnectionStep.tsx`, `WorkspaceConnectionPage.tsx`, machine action/state/reducer/builders; provider/page/reducer tests.

- [x] 기존 clone 오류의 다른 위치 선택, 병합 후 clone 선택, picker 취소에 대해 최종 제출 전 inspect/connect/clone 호출이 0회인 테스트를 추가한다.
- [x] 선택 경로와 연결 방법을 picker 결과로 유지하고 recovery 버튼은 폴더 선택까지만 수행한다. `connectExistingClone(path)`는 최종 제출에서만 호출한다.
- [x] 다운로드 실패 후 기존 parent 경로 유지, 새 parent 선택, 방법 왕복, 명시 재시도 모두 최신 경로와 새 request ID를 사용하도록 고정한다.
- [x] `validation_failed`에서도 현재 path와 기존 local form 문맥을 유지한다. invalid는 파일 열기·재검증, unsupported_version은 업데이트 확인·재검증을 공용 Button/StatusFeedback으로 제공한다.
- [x] 수정한 YAML의 재검증 성공 시 같은 root를 connect하고, 파일이 그대로면 진단을 유지한다. picker로 다른 root를 고른 경우에도 최종 연결 전 실행하지 않는다.

**완료 기준:** 초기·복구·병합 후 모든 경로가 동일한 명시 실행 규칙을 따르고 YAML 오류에서 앱을 재시작하지 않고 복구할 수 있다.

### C. 외부 링크를 제한된 native opener 경로로 통합

**의존성:** 없음. A/B와 병렬로 분리 가능한 구현 단위. page와 provider 파일 병합은 조정 필요.

**파일:** `components/RepositorySelectionStep.tsx`, `WorkspaceConnectionPage.tsx`, provider 또는 별도 `external-actions.ts`, gateway 테스트, `src-tauri/capabilities/default.json`; 필요 시 URL 검증용 Rust command/helper.

- [x] 새 저장소 만들기, 인증 계속, App 설치 관리, releases, 선택한 저장소의 PR 열기에 대한 호출/실패 테스트를 추가한다.
- [x] 새 저장소 anchor를 기존 openExternal gateway로 연결한다. 초기화 결과의 PR URL은 https/github.com/선택한 owner/repo/pull/양의 정수 형태만 인정한다.
- [x] native permission은 필요한 GitHub URL 범위만 허용한다. 임의 scheme·host·URL credential·query redirect를 허용하지 않는다. 저장소별 동적 검증이 capability만으로 불가능하면 Rust에서 선택 repository와 대조하는 command를 사용한다.
- [x] opener/picker 실패를 catch해 현재 상태·path를 유지한 공개 안내와 재시도를 제공한다. 기존 YAML openPath 범위는 확대하지 않는다.

**완료 기준:** desktop에서 실제 URL을 열 수 있으며 승인된 GitHub 경로 밖은 차단되고 실패가 unhandled rejection이 되지 않는다.

### D. 실제 연결 완료·재로그인 후 Home 진입 보장

**의존성:** A, B. C는 PR 초기화 경로 검증 시 필요.

**파일:** `WorkspaceGate.tsx`, `src/app/AppRoutes.tsx`, `src/app/App.test.tsx`, `WorkspaceGate.test.tsx`. HomePage/공용 shell 디자인은 수정하지 않는다.

- [x] `/settings`에서 logout/relogin 복원, `/documents`에서 local recovery 후 재연결, `/` 최초 연결 테스트에서 connected 전환 직후 `/`로 이동하는 assertion을 추가한다.
- [x] connected로 전환되는 시점에만 route를 Home으로 이동한다. 연결된 상태의 정상 Documents/Settings 탐색에서는 redirect하지 않는다.
- [x] connected 전에는 shell/workspace 이름/path/문서를 숨기고 DocumentsProvider가 인증 전 session을 시작하지 않는 기존 경계를 확인한다.

**완료 기준:** 연결 전환 이후 실제 Home route/로그인 인사말이 나타나며 정상 앱 탐색과 document session 인증 guard가 유지된다. Home의 Issue 데이터 구현은 포함하지 않는다.

### E. 통합 검증과 근거 기록

**의존성:** A–D 완료. 제품 판단 항목은 승인 결과 반영.

**파일:** 기존 provider/page/App/gateway/Rust tests, 필요 시 `docs/development/workspace-connection-verification.md`. Storybook 변경은 실패 재현에 필요한 최소 범위만 수행한다.

- [x] 독립 worktree 안에 lockfile 기준 의존성 설치 후 기존 baseline을 실행한다. 다른 worktree의 node_modules나 target을 수정·공유하지 않는다.
- [x] `pnpm test:run`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`을 실행한다. 테스트가 생성하는 disposable temp fixture는 테스트 범위로 제한한다.
- [x] UI props가 변경된 stories에 한해 Storybook 계약 검사 및 관련 interaction 검증을 수행한다. 이 결과와 native 검증 결과를 별도로 기록한다.
- [ ] 아래 실제 환경 검증을 대상/영향 승인 후 실행하고 결과·OS/build·관찰한 error code를 기록한다. token/credential contents는 기록하지 않는다.

## 5. 결정이 필요한 범위와 권고

1. **연결된 코드 저장소·Project 검증 강도:** 권고는 이번 범위를 지식 저장소 접근권한 + YAML/문서 참조 구조 검증으로 유지하고 원격 코드 저장소·Project 검증은 별도 작업으로 분리하는 것이다. 원격 검증까지 UC-00 완료 기준이면 조회 권한·API·오프라인/권한거절 정책을 확정한 별도 작업이 필요하다. 현재 구현 완료로 분류하지 않는다.
2. **실패한 clone staging 잔여 폴더:** backend는 소유 staging을 보존하고 오류 detail에 stagingPath를 포함한다. 재시도는 새 staging을 만들며 자동 정리하지 않는다. 권고는 이번 작업에서 자동 삭제를 추가하지 않고 안전한 안내와 수동 정리 검증을 기록하는 것이다. 자동 정리 도입은 소유권 재검증과 삭제 승인을 포함한 별도 정책이 필요하다.
3. **다운로드 시각 진행률:** 현재 승인 UI는 버튼의 다운로드 중 상태와 접근성용 숫자를 사용한다. 숫자/막대 추가는 요구하지 않는다. 실제 callback 동작은 검증하되 화면 변경은 별도 디자인 승인 대상이다.
4. **Home 데이터:** 이번 완료 기준은 실제 Home 진입으로 한정한다. Issue·Project·활동 통합은 별도 기능 계획이다.

## 6. 작업 의존성과 디자인 세션 충돌

실행 순서: A → B → D → E. C는 A/B와 독립 진행 가능하고 초기화 PR 검증 전에 완료한다. Rust 복원 오류 매핑도 frontend 복구 작업과 분리 가능하나 반환 계약을 먼저 고정한다. 같은 provider/page를 동시에 편집하지 않는다.

현재 디자인 worktree의 미커밋 목록에서 직접 겹치는 위험: `src/components/ui/*`, `src/pages/SettingsPage.tsx` 및 tests, `src/features/workspace-connection/components/LogoutConfirmationDialog.tsx`, `src/styles/globals.css`, `package.json`, `src/stories/story-catalog-contract.test.ts`, `docs/product/design-system.md`.

A–D는 위 파일 수정을 기본적으로 피한다. 공용 UI 동작 문제를 발견하면 다른 디자인 세션이 확정한 변경을 먼저 확인하고 기능 수정만 별도 합의한다. 연결 page/local step/provider/gate 변경도 기준 commit 이후 디자인 branch 변경 여부를 구현 직전 재확인한다. 디자인 검수 미커밋 파일을 checkout/cherry-pick/reset하지 않는다. 이후 통합은 승인된 디자인 commit과 비교해 UI 유지 여부를 검수한 다음 진행한다.

## 7. 실제 환경 검증과 별도 승인 경계

아래 작업은 아직 수행하지 않았다. “구현 계획 승인”은 다음 외부 부작용 검증의 포괄 승인을 의미하지 않는다. 실행 직전 계정·repository·정확한 local path·환경을 명시해 승인받는다.

| 검증 | 대상·영향 | 성공 기준 |
|---|---|---|
| desktop 앱 시작·Device Flow | 사용할 계정, App, macOS debug 또는 release 환경. OS credential entry 생성/갱신, settings/cache/draft 디렉터리 접근; 기존 개발 앱 설정과 인증에 영향을 줄 수 있음 | 인증 계속·복사·완료·만료·거절 복구. Rust 이벤트 도달, 공개 오류만 표시 |
| 목록·새로고침·추가 페이지 | 승인된 계정의 설치된 repository metadata를 읽는 GitHub 요청 | 목록/empty/100개 초과/다중 installation/권한·rate-limit 복구. 계정과 설치 권한 변경은 별도 승인 |
| 기존 clone 연결·복원 | 승인된 disposable clone 경로. 파일 검사와 앱의 현재 연결 설정 저장; clone 내용은 변경하지 않음 | ID/origin/YAML 일치, 저장 성공, 앱 완전 종료 후 재실행 Home |
| clone 성공·실패·재시도 | 승인된 disposable repo와 새 parent path. 숨김 staging 및 target 폴더 생성·네트워크 다운로드·디스크 사용 | picker만으로 파일 생성 없음, 최종 버튼에서만 시작, 충돌 덮어쓰기 없음, 실패 후 path 유지·재시도 |
| YAML·Git metadata 손상 | disposable clone의 파일 백업/변경/복원. 기존 제품 clone은 제외 | 잘못된 YAML·상위 경로·버전·손상 Git마다 같은 화면에서 복구 |
| 빈 저장소 초기화 | 승인된 disposable empty repo/local clone. 파일 생성·local commit·기본 branch push | preview와 동일 파일, 중복 실행 방지, connect 후 Home |
| 기존 콘텐츠 초기화 | 승인된 disposable non-empty repo. 초기화 branch·local commit·remote push·Draft PR 생성 | 기본 branch 직접 변경 없음, PR 열기, 재시도 시 중복 PR 없음. 병합은 별도 승인 |
| 로그아웃·재로그인·계정 변경 | 승인된 OS credential entry 삭제/재생성. 기존 개발 앱 로그인 영향 | 설정/clone 유지, signed-out command 거부, 과거 document session 재사용 거부, 접근 가능한 계정만 Home 복원 |

실험용 repo 생성/App 설치·권한 변경/PR 병합/remote 정리/잔여 폴더 삭제도 승인 없이는 수행하지 않는다. 자동 테스트에 실제 GitHub credential을 주입하지 않는다. Keychain/settings 검사는 존재 여부와 secret-free schema로 확인하고 원문 credential 값을 출력하지 않는다.

## 8. 승인 및 구현 결과

사용자의 “진행해줘”에 따라 A–D와 E의 자동 검증을 완료했다. 실환경 검증은 계정·저장소·경로 및 영향 승인 대기다. 구현 완료 후 사용자가 commit/push를 승인했다. PR은 생성하지 않는다. 기준 커밋의 조사 표는 보존하며, 보완 후 상태와 검증 한계는 `docs/development/workspace-connection-verification.md`에 기록했다.

독립 코드 리뷰에서 발견한 YAML 오류 후 다른 경로 선택 시 이전 경로 복구 동작이 남는 문제와 다운로드 실패 후 동일/다른 경로·연결 방법 변경이 거부되는 문제도 수정했다. 해당 8개 회귀 테스트는 수정 전 실패와 수정 후 통과를 확인했다. 실제 호출 경로의 구현을 자동 테스트와 구분하며 실환경 합격을 주장하지 않는다.

## 9. 구현 인터페이스와 작업별 회귀 검증

새 gateway/backend 기능을 중복 생성하지 않는다. 기존 `WorkspaceConnectionGateway`의 `inspectExistingClone(path, repositoryId)`, `inspectWorkspace(path)`, `connectWorkspace(path, repository)`, `cloneRepository(requestId, repository, parentDirectory)`, `openExternal(url)`, `openPath(path)` 계약을 기본적으로 유지한다.

- A는 재실행 가능한 setup/recovery 진입점 `retryConnectionSetup(): Promise<void>`를 provider context에 추가하고, 인증된 저장 연결 복원 실패에서는 `restoreAuthenticatedWorkspace(auth)`를 재사용한다. Rust `get_current_workspace_inner`는 기존 `Option<CurrentWorkspace>` 계약의 recovery_required로 local corruption을 전달한다. A의 새 테스트: `ends_loading_and_retries_partial_subscription_failure`, `restores_local_git_corruption_as_recovery`, `keeps_remote_permission_errors_public`. frontend 테스트는 provider/page tests, Rust 테스트는 commands/workspace.rs에 둔다.
- B는 `chooseAnotherCloneDirectory`와 `choosePostMergeClone`을 path 선택으로 한정하고 폼이 최신 선택 path를 받도록 provider의 선택 정보 계약을 명시한다. 최종 `connectExistingClone(path)`/`confirmCloneTarget()`만 실행하며 `retryLastAction()`에 validation_failed 재검사를 추가한다. 테스트: `picker_recovery_does_not_execute_until_submit`, `post_merge_picker_does_not_execute_until_submit`, `yaml_revalidation_preserves_path_and_connects_after_explicit_retry`, `clone_retry_uses_latest_parent_and_new_request_id`. provider/page tests 및 machine/__tests__/local-transitions.test.ts, initialization-transitions.test.ts에 배치한다.
- C는 `RepositorySelectionStep`에 `onCreateRepository(): void`를 추가하고 page에서 기존 openExternal 경로를 호출한다. opener 실패는 기존 auth/local 상태를 보존하는 별도 공개 action error로 전달한다. 테스트: `new_repository_uses_native_opener`, `opener_failure_preserves_pending_auth_and_local_path`, `pull_url_rejects_other_host_or_repository`. capability 권한과 URL 검증은 native 검증도 필요하다.
- D는 `WorkspaceGate`의 연결 여부 false→true 전환과 최초 연결된 부팅에서 Home 이동을 수행한다. 이후 계속 connected인 동안에는 redirect하지 않는다. 테스트: `relogin_from_settings_enters_home`, `reconnect_from_documents_enters_home`, `connected_navigation_is_not_redirected`. `WorkspaceGate.test.tsx`와 `src/app/App.test.tsx`에서 route와 실제 Home을 assertion한다.
- A–D 각 작업의 frontend 검증: `pnpm test:run -- src/features/workspace-connection src/app/App.test.tsx src/infrastructure/workspace`. Rust 변경 검증: `cargo test --manifest-path src-tauri/Cargo.toml commands::workspace`. 각각 exit code 0 및 관련 새 assertion 통과를 확인한 뒤 E의 전체 suite/build로 확대한다. lockfile 설치·빌드는 계획 승인 후 worktree 전용 경로에서 수행한다.

실제 실험용 계정·repository·parent path가 지정되기 전까지 native smoke test는 pending이다. 계획 승인과 실환경 부작용 승인을 분리하며, 실제 GitHub/OS 검증은 아직 수행하지 않았다.
