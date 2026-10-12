# 새 문서 제목·폴더 선택 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 사용자 승인 전 커밋하지 않는다.

**Goal:** 승인된 새 문서 시안을 실제 React 화면과 문서 생성 동작에 적용한다.

**Architecture:** 제목으로 파일명을 생성하고 기존 DocumentCreationInput 계약은 유지한다. 폴더 선택과 생성 예정 경로는 독립 컴포넌트의 로컬 상태로 관리하며, 실제 디렉터리 생성은 기존 Draft 저장 코드에서만 수행한다. 파일명 충돌은 저장 시점에 Rust에서 안전하게 재검증하여 자동 숫자 접미사를 적용한다.

**Tech Stack:** React, TypeScript, 공용 Button·IconButton·Input·Select, Lucide, 기존 Radix primitive, Rust, Vitest, Storybook.

**Spec:** docs/product/screens.md의 '새 문서 생성과 로컬 Draft', docs/product/use-cases.md의 UC-06A. 승인된 상호작용 시안은 `/Users/hyeeun/Documents/okf-knowledge-hub/.superpowers/final-screens/new-document-folder-selection.html`.

## Global Constraints

- 기존 `feat/design-system-rollout` linked worktree와 미커밋 변경을 보존한다. 커밋·push·PR은 하지 않는다.
- 공용 UI를 재사용하고 폭별 복제 Story나 강제 Desktop viewport를 만들지 않는다. 새 의존성은 추가하지 않는다.
- 파일명 입력은 제거한다. 제목 placeholder는 `제목을 입력해주세요`다.
- 안내: `파일명은 제목을 기준으로 자동 생성되며, 같은 이름이 있으면 뒤에 숫자가 붙습니다.`
- 폴더 안내: `/로 하위 폴더를 추가할 수 있습니다.`
- 폴더 선택은 프로젝트 문서 폴더만 대상으로 한다. 기존 폴더 삭제·이동은 범위 밖이다.
- 예정 폴더 추가·취소는 메모리 상태만 바꾸며, 실제 폴더는 문서 생성 시 만든다.
- `/`로 확정된 기존 경로는 muted, 새 경로는 primary teal로 표시한다. placeholder는 경로 입력 후 다시 나타나지 않는다.

## Review Focus

- 기존 폴더를 중간 경로로 재사용하고, 임의의 루트 밖 경로·빈 segment·`.`·`..`·역슬래시를 차단한다.
- 예정 폴더 추가 취소는 같은 작업에서 생긴 중간 폴더까지 제거하되 기존 폴더를 제거하지 않는다.
- 한글·공백·대소문자·Unicode 및 동일 이름 연속 생성은 기존 정규화 규칙을 보존한다.
- 팝업의 키보드 이동·Escape·focus 복귀, 문서 Dialog 닫기·다시 열기 시 임시 상태 초기화를 확인한다.
- 긴 경로와 Compact·720px에서 입력과 보조 버튼이 화면 밖으로 넘치지 않는다.

### Task 1: 폴더 경로 상태와 선택·생성 컴포넌트

**Files:** Create `src/features/documents/folder-selection.ts`, `src/features/documents/folder-selection.test.ts`, `src/features/documents/components/DocumentFolderField.tsx`, `src/features/documents/components/DocumentFolderField.test.tsx`; Modify `src/features/documents/documents.css`.

**Interfaces:** `DocumentFolderField({ roots: DocumentTreeEntry[], value: string, onValueChange(path: string): void, disabled?: boolean })`. `resolveFolderPath(parent: string, input: string, existing: string[]): { path: string; missing: string[] }`는 잘못된 경로를 오류로 반환한다. 예정 경로 배치는 컴포넌트 안에서 관리한다.

- [x] 먼저 단위 테스트 작성: `docs/api` + `contracts/v2`는 기존 contracts를 재사용해 v2만 missing; `../outside`, `a//b`, `a\\b`는 실패; 새 `v2/contracts` 추가 취소는 두 예정 segment만 제거.
- [x] 해당 테스트 실행 후 구현 전 실패 확인.
- [x] 폴더만 재귀 표시하는 드롭다운과 Lucide FolderPlus 생성 진입 구현. 공용 UI 및 기존 설치된 Radix dropdown을 사용하고 선택·확장·키보드 focus를 분리한다.
- [x] B형 경로 입력 구현: `/` 입력 시 앞 segment 이동, 기존/신규 색상, 빈 칸 Backspace 복귀, 입력 오른쪽 취소·추가, 빈 경로 비활성화, 예정 경로 추가 취소.
- [x] 컴포넌트 테스트로 팝업 선택, Escape focus 복귀, 생성 예정 추가·취소 및 외부 저장 호출 없음 확인.

Run: `pnpm test:run src/features/documents/folder-selection.test.ts src/features/documents/components/DocumentFolderField.test.tsx`. Expected: 모두 통과.

### Task 2: 새 문서 화면 연결

**Files:** Modify `src/features/documents/components/NewDocumentDialog.tsx`, `NewDocumentDialog.test.tsx`, `src/pages/DocumentsPage.tsx`, `src/pages/NewDocument.stories.tsx`, `src/features/documents/documents.css`.

**Interfaces:** 기존 `DocumentCreationInput`은 유지한다. Dialog에 `folderRoots: DocumentTreeEntry[]`를 공급하고 `fileName`은 제목에서 얻는다. 구현 검토에서 점을 포함한 제목이 확장자로 오인되는 문제를 발견하여, frontend의 `documentFileName(title)`으로 안전한 파일명을 만들고 Rust는 저장 전 재검증한다. 원문 제목은 변경하지 않는다.

- [x] 먼저 테스트 변경: 파일명 textbox 없음; 제목 placeholder 및 안내 존재; 제목 `지도 검색 API`로 생성 시 정규화된 `fileName: '지도-검색-api.md'` 전달; folder dropdown으로 docs/api 선택. `API v1.0`은 제목을 그대로 보존하고 `api-v1-0.md`를 전달한다.
- [x] 테스트 실패 확인 후 파일명 state와 입력 제거, 공용 FormField·Input으로 제목 안내 연결, DocumentFolderField에 현재 catalog roots 공급.
- [x] template preview와 기존 생성 API는 유지. 새 문서 Dialog가 닫히면 예정 폴더·입력 상태를 폐기한다.
- [x] Story interaction을 새 구성에 맞추고 폴더 선택·하위 경로·취소 및 Compact에서 검증한다.

Run: `pnpm test:run src/features/documents/components/NewDocumentDialog.test.tsx src/pages/DocumentsPage.test.tsx`. Expected: 모두 통과.

### Task 3: 충돌 파일명 자동 생성

**Files:** Modify `src/features/documents/document-authoring-reducer.ts`, `document-authoring-reducer.test.ts`, `src/features/documents/DocumentsProvider.tsx`, `DocumentsProvider.test.tsx`, `src-tauri/src/documents/drafts.rs`, `src/test/FakeDocumentsGateway.ts`.

**Interfaces:** 기존 validation/create gateway 및 request schema 유지. 신규 문서의 충돌만 자동 처리하며 팀 템플릿 복제 동작은 변경하지 않는다.

- [x] 먼저 reducer/provider 테스트 작성: 충돌 validation의 suggestedFileName을 자동 선택하고 생성 단계로 진행; 사용자 확인 UI 없음; stale response는 무시.
- [x] Rust 테스트 작성: 동일 제목 생성 3회는 원본, 숫자 2, 숫자 3 파일로 기록되고 모든 기존 파일 내용을 보존. 실제 create 직전 검증으로 validation 이후 충돌도 처리.
- [x] 테스트 실패 확인 후 신규 문서 생성에서 기존 suffix 탐색을 재사용하고 원자적 신규 파일 쓰기를 유지한다. 제한 없는 재시도는 하지 않는다.
- [x] 예정 경로를 확인만 하거나 Dialog를 취소하면 디렉터리가 생기지 않는 계약 테스트 추가. 가짜 gateway도 실제 파일명 규칙과 맞춘다.

Run: `pnpm test:run src/features/documents/document-authoring-reducer.test.ts src/features/documents/DocumentsProvider.test.tsx`; `cargo test --lib documents::drafts` in src-tauri. Expected: 모두 통과.

### Task 4: 통합 검증과 인계

- [x] `pnpm test:run --maxWorkers=2`, `cargo test --lib`, `pnpm build`, `pnpm build-storybook`, NewDocument Storybook interaction·axe를 실행하고 결과 기록.
- [x] 같은 Story에서 Default·Compact, 1440×900·1024×768·768×768·720×600으로 실제 브라우저 확인. popup·신규 경로 입력·예정 폴더 취소와 overflow 확인.
- [x] 수정 범위 diff를 별도 검토하고 기존 변경을 보존했는지 확인. 승인 문서와 구현 불일치가 남으면 구체적으로 보고.
- [x] 커밋 없이 완료 항목·검증 결과·남은 제한을 인계.

## 계획 검토

시안의 편집 상태를 UI에만 복사하지 않고 저장 동작까지 연결한다. 승인되지 않은 폴더 삭제·관리 기능, 템플릿 관리 기능은 추가하지 않는다. 공용 primitive 재사용, 제목 자동 파일명, 예정 폴더 수명, 서버 측 충돌 보호를 각각 Task 1~3의 테스트로 검증한다.
