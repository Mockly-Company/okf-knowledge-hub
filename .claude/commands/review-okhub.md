---
description: okf-knowledge-hub 변경에 대한 리뷰를 수행합니다
---

현재 git 변경사항을 **okf-knowledge-hub(Tauri + React + Rust) 관점**에서 검토하고 다음 항목들을 확인해주세요:

## 검토 항목

### 1. 코드 품질
- 컴포넌트·모듈 구조 및 재사용성
- 네이밍 컨벤션 (TS: PascalCase for components, camelCase for functions / Rust: snake_case)
- 코드 중복 및 DRY 원칙
- `cargo fmt`·`cargo clippy -D warnings` 통과 여부와 관련된 스타일 문제

### 2. React/프론트엔드 특화
- 불필요한 리렌더링 방지 (useMemo, useCallback, React.memo)
- 상태 관리 적절성 (로컬 vs 글로벌 상태)
- useEffect 의존성 배열 정확성
- null/undefined 체크 및 옵셔널 체이닝 사용

### 3. Tauri/Rust 특화
- `#[tauri::command]` 입출력 타입과 에러(`AppError`) 처리
- 메인 스레드 블로킹 금지 (동기 I/O·네트워크는 백그라운드로)
- `unwrap`·`expect` 남용 금지, 로컬 파일· 토큰 등 시크릿 노출 금지
- GraphQL 쿼리 중괄호·커서(`after: null` 전달 금지) 같은 기존 이슈 재발 여부

### 4. 성능
- 번들 사이즈 최적화 (코드 스플리팅, lazy loading)
- API 호출 최적화 (중복 요청, 캐시 `fetched_at` 갱신 누락)
- 불필요한 전체 보드 재동기화 금지

### 5. 보안
- **XSS** 취약점 (dangerouslySetInnerHTML, 사용자 입력 sanitization)
- **민감 정보 노출** (Meta App Client ID 외 토큰·시크릿 하드코딩 금지)
- 입력 유효성 검사

### 6. 접근성 (Accessibility)
- 시맨틱 HTML 사용
- ARIA 속성 적절성
- 키보드 네비게이션, 스크린 리더 호환성

### 7. 타입 안전성 (TypeScript)
- any 타입 사용 최소화
- Props·API 응답 타입 정의
- Rust↔TS 경계(BoardIssue 등) 필드 누락·불일치

각 항목에 대해 구체적인 피드백을 제공하고, 개선이 필요한 부분은 코드 예시와 함께 제안해주세요.
