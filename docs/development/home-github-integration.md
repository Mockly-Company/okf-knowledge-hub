# Home 실제 GitHub 연동

기준 디자인은 main `8c4c298`에 병합된 Home이다. 기존 `HomePage`, `HomeTasks`, `HomeInsights`, 패널과 페이지네이션을 실제 Tauri 경로에 사용한다. Storybook 예시는 동일한 HomeGateway 계약을 사용하는 fake이며 실제 조회 결과가 아니다.

## 호출 경로

`App → HomeProvider → TauriHomeGateway → load_home → Rust Home service → 기존 GithubHttpClient/AuthService → GitHub GraphQL`.

- 개인 목록은 연결한 지식 저장소와 `.okf/workspace.yml`의 `repositories` 범위에서 현재 계정에게 남아 있는 리뷰 요청·담당 Issue를 조회한다.
- 직접 요청과 팀 요청은 현재 요청·팀 멤버십을 확인한다. 검색 인덱스에 남은 과거 요청·종료된 항목·변경된 담당자는 현재 작업으로 표시하지 않는다.
- 요청 시각과 요청자는 현재 남은 요청 대상에 대한 마지막 `ReviewRequestedEvent`에서 읽는다. PR 업데이트 시각으로 요청 시각을 대체하지 않는다.
- 요약은 `.okf/workspace.yml`의 `github.project.id`가 가리키는 기존 Project 전체를 기준으로 한다. Settings → 홈에서 해당 Project의 상태 필드 ID, 진행 중 옵션 ID, 선택적 마감일 날짜 필드 ID를 명시적으로 매핑한다. 상태 이름·마일스톤·본문에서 추론하지 않는다.
- 매핑은 현재 계정·workspace·연결 정보 범위의 로컬 설정에만 저장한다. 공유 workspace.yml을 자동 수정하거나 다른 Project를 자동 선택하지 않는다.
- 72시간 대기 리뷰, 168시간 업데이트 없는 진행 중 Issue, 직전 168시간 내 병합 PR·종료 Issue는 main의 `analyzeHomeProject`로 계산한다. 공유 상태나 별도 완료 판정을 만들지 않는다.
- 실제 Home의 리뷰·Issue·분석 근거는 GitHub의 해당 원본 페이지로 열린다. 문서 발행·리뷰 기능 브랜치를 이번 홈 작업에 끌어오지 않는다.

## 실패와 보안

모든 연결 페이지를 조회하며 검색 상한, 반복 cursor, 누락/비공개 원본, GraphQL 부분 오류는 정상 0건으로 처리하지 않는다. 이 조회에서 확인한 원본만 분석한다. 검색 결과 외에 저장소의 Issue/PR 조회 접근도 확인한다. 조회 실패 시 같은 계정·workspace·설정 범위의 메모리 결과가 있으면 정확한 마지막 시각과 오래된 데이터 안내를 유지한다. 범위가 바뀌면 이전 결과를 제거하며 앱 재실행 시 원격을 다시 조회한다. 홈 결과를 일반 설정 파일에 영속 캐시하지 않는다.

토큰은 기존 Rust·OS 보안 저장소 밖으로 내보내지 않는다. 일반 설정에는 필드·옵션 ID만 저장한다. GitHub의 원본 오류 본문이나 토큰은 화면·로그에 표시하지 않는다. Home 쿼리는 읽기 전용이며 GitHub 상태를 수정하지 않는다.

원본 페이지 열기는 검증된 HTTPS GitHub Issue/PR 주소만 받는 Rust command를 사용한다. query string·임의 호스트·인증 정보 포함 주소·GitHub의 다른 기능 주소는 거절한다. 기존 frontend opener capability를 광범위하게 확대하지 않는다.

GitHub App에 필요한 저장소의 Issues/Pull requests 읽기 및 연결 Project 읽기 권한이 있어야 한다. 팀 요청의 개인 포함 여부를 확인하려면 해당 팀의 멤버십 조회도 가능해야 한다. 권한을 코드에서 자동 변경하지 않는다. 부족하면 연결/권한 오류로 안내하며 권한을 확대하려면 사용자가 GitHub App 등록·설치 설정을 검토해야 한다.

## 검증 방법

- `pnpm test:run`
- `pnpm exec vitest run --project storybook src/pages/HomePage.stories.tsx src/pages/HomeDataIntegration.stories.tsx`
- `pnpm build`, `pnpm build-storybook`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, `git diff --check`
- 공식 GitHub GraphQL SDL로 실제 쿼리의 타입·필드·fragment·변수를 검증한다. Issue/PR의 state enum은 다른 타입이므로 `issueState`/`pullRequestState` alias를 사용한다.
- 별도 서명된 Tauri 테스트 앱에서 기존 연결의 로그인 복원·실제 조회·Settings 진입·새로고침·재실행을 확인한다. 원격 Issue/PR/리뷰는 만들거나 수정하지 않는다.

대량 페이지·검색 제한·요청 철회·nullable 과거 리뷰어·팀 멤버십·현재 담당자·명시적 필드 매핑·옵션 삭제 복구·계정/동일 경로의 workspace 교체·응답 역전·오래된 결과·외부 URL 거절을 회귀 검사한다.

## 실환경 검증 범위

별도 테스트 앱에서 기존 계정 복원과 연결 저장소의 개인 목록 조회를 실행했다. 초기 조회에서는 두 목록이 0건으로 반환됐다. 현재 테스트 workspace에 Project 연결이 없어 실제 Project 요약·필드 저장의 왕복 검증은 아직 완료하지 못했다. 사용자에게 기존 Project 주소를 요청했으며, workspace 설정이나 원격 자산은 임의 변경하지 않았다. 최종 접근 권한 확인 보완 후 Tauri 앱 빌드와 서명 검증은 통과했으나, Mac 잠금으로 최종 바이너리의 재실행 확인은 중단됐다. 이 제약이 해결되기 전에는 전체 실환경 검증 완료로 표시하지 않는다.

현재 소스 자동 검증 결과: frontend 93개 파일·681개 테스트, Rust 429개 테스트와 doctest 2개(기존 성능 테스트 1개 제외), Chromium Storybook 15개 테스트 통과. TypeScript 검사, production frontend·Storybook·서명된 Tauri 앱 빌드, Rust 포맷과 diff 검사도 통과했다. 실제 GraphQL 쿼리 8개를 공식 SDL에 검증했다. 독립 코드 검토에서 발견한 현재 요청·nullable 과거 리뷰어·EnterpriseTeam 처리 문제를 회귀 테스트와 함께 수정했다.

## API 근거

- [GitHub PR·review request·timeline 객체](https://docs.github.com/en/graphql/reference/pulls)
- [GitHub Projects와 필드 값](https://docs.github.com/en/graphql/reference/projects)
- [직접·팀 리뷰 요청 검색](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests)
- [GitHub 공식 GraphQL SDL](https://docs.github.com/public/fpt/schema.docs.graphql)
