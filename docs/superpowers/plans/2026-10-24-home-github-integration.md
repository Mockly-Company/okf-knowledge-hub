# Home 실제 화면·GitHub 데이터 연동

목표: main 8c4c298의 승인된 Home 컴포넌트를 Tauri 실제 경로에 연결하고 테스트·검토·commit·push한다. main 병합은 하지 않는다. 기존 문서 발행·리뷰 worktree는 수정하지 않는다.

기준: docs/product/screens.md의 Home, docs/product/use-cases.md, docs/product/design-system.md. 화면은 기존 HomeTasks/HomeInsights/analyzeHomeProject를 재사용한다. 예시 데이터는 Storybook에만 둔다.

- [x] 1. 현재 workspace의 지식 저장소·연결 저장소 범위와 Rust 인증 경계를 적용한 읽기 전용 GitHub GraphQL source 구현. 전체 페이지·리뷰 요청 이벤트를 조회하고 불완전 결과는 0건으로 표시하지 않는다.
- [x] 2. .okf에 지정한 Project를 기본으로 사용하고 로컬 Settings에서 해당 Project의 진행 중 상태·날짜 필드를 명시적으로 매핑한다. 공유 .okf 파일을 자동 수정하지 않는다. 계정·workspace별 설정을 분리한다.
- [x] 3. Home gateway/provider를 production App에 연결한다. 개인 리뷰·담당 Issue, 72/168시간 분석·패널·페이지네이션과 실제 GitHub 이동을 연결한다. 로딩·실패·동일 범위의 오래된 결과를 구분하고 계정·workspace 변경 시 이전 결과를 제거한다.
- [ ] 4. Rust port/command, frontend/provider/adapter, Storybook·production/native build와 실제 앱 읽기 경로를 검증한다. 실제 GitHub Issue/PR/리뷰 작성이나 저장소 파일 수정은 하지 않는다.
- [ ] 5. 독립 코드 검토 결과를 반영하고 현재 소스에서 검증한다. 이 기능 branch에만 commit·push하고, 병합 전 확인 결과와 한계를 사용자에게 알린다.

주요 검증: 100건 초과 페이지·검색 제한·GraphQL 부분 오류, 요청 시각 누락/재요청/팀 요청, 날짜 필드·옵션 매핑 검증, 계정 전환 중 오래된 응답, 설정 변경 후 캐시 격리, 외부 URL 검증, 인증 실패·권한 거절, 0건/미연결/오류 구분. 사용자 콘텐츠·토큰을 로그·문서에 남기지 않는다.

신규 HomeGateway/useHome/SettingsPanel과 Rust home service/query/command로 책임을 나눈다. 기존 AuthService·GithubHttpClient와 LocalSettingsService를 재사용한다. Home의 분석은 원본에서 재계산 가능한 조회 결과이며 GitHub 공유 상태를 바꾸지 않는다. 프로젝트 설정이 없으면 설정 안내를 제공하고 추정 상태·마감일은 만들지 않는다.

진행: 4의 자동 테스트·production/native 빌드·서명 검증은 완료. 기존 앱의 로그인 복원·개인 목록 조회·Settings 진입을 확인했다. 최종 바이너리 재실행은 Mac 잠금 해제 후, Project 실조회·필드 저장은 실제 연결 Project 제공 후 확인해야 한다. 독립 코드 검토와 지적 수정은 완료했으며 commit·push 이후에도 main 병합은 보류한다.
