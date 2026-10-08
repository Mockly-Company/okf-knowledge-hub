# Workspace Connection 통합 구현·검증 기록

- 날짜: 2026-10-08
- worktree: `/Users/hyeeun/projects/okhub-worktrees/workspace-connection-integration`
- 브랜치: `feat/workspace-connection-integration`
- 기준 커밋(구현 전 HEAD): `1742c90878b90039cb8085ce55f854ea0cb89fe4`
- 사용자의 구현 승인 후 작업했다. 구현 후 사용자가 이 변경의 commit/push를 승인했다. 원본 checkout과 디자인 세션의 미커밋 파일을 수정하지 않았다.
- 기준 제품 문서: `docs/product/screens.md`, `docs/product/use-cases.md`. 구현 전 조사·의존성·충돌 위험·실환경 승인 경계는 [구현 계획](../superpowers/plans/2026-10-08-workspace-connection-integration.md)에 있다.

## 실제 호출 경로와 보완 결과

실제 화면 → `WorkspaceConnectionProvider` → `TauriWorkspaceConnectionGateway` → `lib.rs`에 등록된 Rust command → 기존 서비스/adapter 경로를 유지했다. Storybook은 실제 화면과 fake gateway를 사용하므로 native 성공 근거로 삼지 않는다.

| 범위 | 구현 후 상태 | 코드 근거와 이번 보완 | 남은 검증 |
|---|---|---|---|
| 로그인·Device Flow·인증 완료/만료/오류 | 구현됐지만 통합 검증 필요 | 기존 AuthService/ReqwestDeviceFlowApi/polling 유지. provider listener 일부 설치 실패 정리·로딩 종료·구독 재시도 및 인증된 상태에서 저장 연결 복원 재시도 보완 | 실제 GitHub App/계정, OS credential store, IPC 이벤트 |
| 코드 복사·인증 계속 | 구현됐지만 통합 검증 필요 | 기존 clipboard plugin과 만료 표시 유지. native opener 실패를 현재 인증 화면에서 재시도 | OS clipboard/browser, 실제 만료·거절 |
| 목록·새로고침·추가 페이지 | 구현됐지만 통합 검증 필요 | 기존 list_github_repositories/GithubService의 installation별 pagination 재사용. 새 저장소 링크를 native opener와 연결 | 다중 installation/100개 초과/권한·rate-limit |
| 기존 로컬 연결·다운로드 | 구현됐지만 통합 검증 필요 | 기존 inspect_existing_clone/clone_repository의 identity·path 검증, staging/publish 재사용. 복구/PR 병합 후 picker도 선택만 하고 최종 제출에서 실행 | 실제 clone/native folder picker/덮어쓰기 방지 |
| 진행·완료·실패·재시도 | 구현됐지만 통합 검증 필요 | 기존 Rust callback/이벤트와 request ID guard 유지. 동일 parent 재시도, 다른 parent 선택, 실패 후 연결 방법 변경을 최신 선택과 새 request ID로 실행하도록 보완 | 네트워크/디스크 실패, 실제 completion 이벤트 |
| Git·workspace.yml 검증과 복구 | 구현됐지만 통합 검증 필요 | 기존 Git2·YAML/schema/참조 검증 유지. local Git 손상은 복원에서 recovery_required. YAML 오류는 경로와 폼을 유지하고 파일 열기/재검증 제공. 경로/방법 변경 시 이전 root의 복구 동작 제거 | disposable clone의 손상/수정/복원, 실제 파일 opener |
| 초기화 | 구현됐지만 통합 검증 필요 | 기존 preview/initialize/attempt·local commit/push/Draft PR 재사용. PR URL은 인증된 Rust command에서 owner/repo/pull/양의 정수로 제한 | 승인된 빈/기존 콘텐츠 저장소 초기화 및 재시도 |
| 설정 저장·재실행 복원 | 구현됐지만 통합 검증 필요 | 기존 LocalSettings/Tauri store save·rollback 재사용. local Git 검사와 remote 접근/identity 오류 구분, 복원만 재시도 | 실제 settings 저장 실패, 완전 종료/재시작, 계정 변경 |
| 실제 Home 진입 | 구현됐지만 통합 검증 필요 | WorkspaceGate 최초 연결된 부팅·연결 완료·재로그인에서 `/` 이동. 이후 일반 탐색 유지, 연결 교체 취소는 이전 route 유지. App 테스트는 실제 Home route/내용 확인 | native 앱 종료/재시작·재로그인 |
| Home Issue/Project/활동 실데이터 | 미구현·이번 범위 제외 | Home 진입과 별도 기능 | 별도 계획 |
| 코드 저장소/Project 원격 검증 강도 | 결정 필요·이번 범위 제외 | 이번에는 지식 저장소 접근권한 + YAML/문서 참조 구조 검증 유지 | API/권한/오프라인 정책 결정 |

구현 완료로 확인한 기존 YAML 구조·참조 검증, 최종 제출 원칙 등은 위 흐름 안에서 재사용했다. 전체 흐름은 실제 GitHub/OS 통합 검증이 남아 있다. 실패 clone staging 자동 삭제나 새로운 시각 진행률 UI는 추가하지 않았다.

## 자동 검증

환경: macOS 26.5(25F71), Node 24.10.0, pnpm 10.0.0, rustc 1.96.1. 의존성은 이 worktree에서 lockfile 기준 설치했으며 package/lockfile 변경은 없다.

| 명령/검증 | 결과 |
|---|---|
| `pnpm test:run` | 68 파일, 545 테스트 통과 |
| `pnpm build` | TypeScript 및 Vite production build 통과 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 410 통과, 성능 측정 1개 ignored; doc test 2개 통과 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 통과 |
| `pnpm test:storybook src/features/workspace-connection/WorkspaceConnectionPage.stories.tsx` | browser interaction 7개 통과 |
| `pnpm build-storybook` | 통과(최종 리뷰 수정 전); 리뷰 수정 후 위 interaction 및 production build 재검증 |
| `git diff --check` | 통과 |

jsdom canvas 미지원 안내와 Vite 큰 chunk 경고가 있었지만 명령은 성공했다. 성능 측정 테스트는 기존 non-gating cold-index/warm-reconcile 테스트다. 자동 테스트는 disposable filesystem/Git fixture 또는 fake/mocked gateway를 사용한다. 실제 GitHub credential을 주입하거나 앱의 Keychain/settings를 검증하지 않았다.

독립 리뷰의 Important 문제 2개를 수정했다: 다른 폴더 선택 후 이전 YAML root의 열기/재검증이 남는 문제, clone 실패 후 동일/다른 parent 및 기존 연결 방법 전환이 reducer에서 거부되는 문제. 회귀 테스트 8개가 수정 전 실패하고 수정 후 통과함을 확인했으며 관련 화면/전이 테스트 59개와 전체 suite도 통과했다. Critical/Minor 지적은 없었다. 커밋 직전 전체 재검증에서 복구 picker의 비동기 입력 반영을 즉시 확인하던 테스트가 1회 실패했다. 호출 경로와 단독 통과를 확인하고, 입력 갱신을 기다린 뒤 자동 검사 호출이 없는지 검증하도록 테스트를 보완했다.

## 구현 중 판단

1. 저장 연결 교체 취소는 이전 화면으로 돌아가고, 실제 연결 완료와 인증된 부팅만 Home으로 이동한다. 취소 정책이 바뀌면 route 조건을 조정해야 한다.
2. PR 링크는 opener wildcard 권한 대신 인증된 Rust command에서 정확한 저장소/URL 형태를 검증한다. 추가 IPC가 있으며 실제 OS browser 열기는 검증 대기다.
3. 복원 시 remote 검증 전에 local Git 검사를 추가한다. local 손상만 recovery로 전달하고 GitHub 권한·identity 오류는 공개 오류로 유지한다. 시작 시 local 검사 비용이 추가된다.
4. 진행 ledger는 저장소 지침에 따라 `.superpowers/integration-progress.md` 단일 local-only 파일에 남겼다. 새 nested session 디렉터리나 커밋 이력은 만들지 않는다.

## 실환경 검증 대기와 승인 경계

실계정 인증·GitHub metadata 요청·desktop 실행·clone·초기화는 수행하지 않았다. 사용할 계정, 테스트용 `owner/repo`, 다운로드 상위 폴더 절대 경로와 환경을 지정하고 아래 영향 승인 후 진행한다.

- 인증/앱 실행: OS credential 생성·갱신, 앱 설정/cache/draft 접근 및 현재 개발 앱 로그인에 영향.
- 기존 clone 연결/재실행: 승인 경로 검사와 현재 연결 설정 저장. 실제 Home 복원 확인.
- clone: 네트워크 다운로드, 숨김 staging/target 생성, 디스크 사용. 실패 후 잔여 staging 자동 삭제 없음.
- YAML/Git 손상 복구: disposable clone 파일의 백업·변경·복원.
- 초기화: 로컬 파일·commit·remote branch/push·Draft PR 생성은 별도 대상/영향 승인. PR 병합·저장소 생성·권한 변경·폴더 삭제도 별도 승인.

토큰·device_code·credential 원문은 로그/화면/문서에 남기지 않는다. 이 보고서의 자동 검증 결과를 native 사용자 흐름 검증 완료로 해석하지 않는다. 개발 브랜치의 commit/push는 후속 사용자 요청으로 승인되었다. PR 생성과 실환경 검증은 별도 승인 대상이다.
