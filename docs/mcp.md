# OkHub MCP

OkHub MCP는 외부 AI 앱이 문서와 GitHub Project를 사용하는 로컬 STDIO 서버입니다. OkHub 데스크톱 앱을 실행할 필요는 없습니다. 연결된 프로젝트 설정과 GitHub 인증은 필요합니다.

## 실행과 연결

```sh
cargo build --manifest-path src-tauri/Cargo.toml --bin okhub-cli
```

외부 앱의 MCP 설정에 다음 정보를 등록합니다. 실행 파일과 작업 폴더에는 자신의 절대 경로를 사용합니다.

```json
{
  "command": "/absolute/path/okf-knowledge-hub/src-tauri/target/debug/okhub-cli",
  "args": [
    "--workspace-dir", "/absolute/path/document-workspace",
    "--docs-repo", "OWNER/DOCS_REPOSITORY",
    "--project", "https://github.com/orgs/OWNER/projects/NUMBER",
    "mcp"
  ]
}
```

이는 연결 항목의 예시이며 앱별 전체 설정 파일 형식은 다릅니다. 기존 앱 설정을 덮어쓰지 마세요. 기존 OkHub 설정에서 대상을 찾을 수 있다면 해당 인자는 생략할 수 있습니다. FE/BE 저장소 연결은 문서 워크스페이스의 `.okf/workspace.yml`과 기존 OkHub 연결 설정을 사용합니다.

인증은 기존 OkHub 자격증명 저장소 또는 서버 프로세스의 `GH_TOKEN`/`GITHUB_TOKEN`을 사용합니다. 토큰을 프롬프트·도구 인자·설정 예시 본문에 붙이지 마세요. 저장소와 GitHub Project에 필요한 실제 권한이 있어야 합니다. 권한을 자동 확대하지 않습니다.

## 기본 도구

| 도구 | 용도 |
| --- | --- |
| `okhub_workspace_list` | 등록된 workspace와 선택 가능한 ID 확인 |
| `okhub_get_active_context` | 선택한 workspace의 프로젝트·저장소·앱 규칙 확인 |
| `okhub_doc_list` | 문서 검색과 확정 기획 목록 |
| `okhub_doc_read` | 경로·커밋으로 문서 읽기 |
| `okhub_context_issue` | Issue 또는 문서와 구현 근거 조회 |
| `okhub_board_list` | 상태·담당자·FE/BE·일정 조회, Ready 상태 필터 |
| `okhub_board_manage` | 사용자 확인 후 백로그 생성·수정·상태 변경·완료 |

`workspaceId`를 생략하면 서버 시작 시 선택한 workspace를 사용합니다. 다른 workspace는 `workspace_list`의 ID로 지정합니다. 호출마다 대상을 고정하며 앱의 현재 선택을 바꾸지 않습니다. 여러 Project가 연결되어 기본값이 명확하지 않으면 `projectId`도 지정합니다. 로컬 clone이 없는 workspace 목록은 등록 정보만 담으므로 `get_active_context`로 원격 설정까지 확인합니다. 원격 문서는 clone 없이 읽을 수 있지만 로컬 초안은 읽을 수 없습니다.

`doc_list`의 기본값은 최신 확정 기획(`mode: "planning"`, `published: true`, `sort: "updated_desc"`)입니다. `type: Product Spec`과 타입 없는 명확한 PRD 파일을 포함하고, 잘못된 frontmatter나 다른 타입을 이름으로 덮어쓰지 않습니다. 전체 문서 유형은 `mode: "documents"`, 로컬 초안은 `published: false`로 요청합니다. 명시적 로컬 호출은 기존 호환성을 유지합니다.

확정본은 원격 기본 브랜치의 고정 커밋을 기준으로 조회합니다. 목록에는 기준 커밋·파일 마지막 변경 커밋·고정 링크를 반환하며, `doc_read`에는 목록의 `path`와 `commit`을 전달합니다. 후속 목록 페이지는 같은 커밋을 유지합니다. 원격 실패를 로컬 초안이나 빈 목록으로 대체하지 않습니다. `doc_read`에서 `commit`을 생략하면 로컬 초안이며 확정본이 아닙니다.

`get_active_context`는 앱 데이터 폴더의 `okhub/AGENTS.md`와 워크스페이스의 `.okf/AGENTS.md`(없으면 `AGENTS.md`)를 읽어 앱과 같은 작성 규칙을 제공합니다. 앱 규칙 파일이 없으면 기본 템플릿을 사용하며 파일을 생성하지 않습니다. 규칙은 작성 지침이지 GitHub 권한이나 사람 승인의 원본이 아닙니다. 규칙 읽기 실패·잘림은 경고로 표시하고 쓰기를 차단합니다.

`context_issue`는 `number`와 `repository`, 또는 `document: { path, commit }`을 받습니다. `code`에는 설정된 코드 저장소의 `repository`, 선택적으로 `commit`, `path`, `query`, `pullRequest`, `offset`, `limit`을 지정합니다. 코드 실행이나 실제 API 호출은 하지 않습니다. 비교 결과는 AI의 판단이며 MCP가 자동 검증 합격을 보증하지 않습니다.

목록·코드 조회의 `coverage`는 조회 단위·확인 범위·남은 페이지·생략·경고를 구분합니다. 검색 결과가 0건이어도 `hasMore: true`이면 아직 확인하지 않은 파일이 있습니다. `continuation`이 있으면 그 `tool`과 `arguments`를 그대로 호출합니다. 범위·버전·필터를 바꿀 때는 새 조회를 시작합니다. `hasMore: false`만으로 전체 확인을 뜻하지 않으며, `complete`와 생략·경고도 확인합니다. PR 목록은 실시간 데이터라 페이지 사이 변경 가능성이 있습니다.

`board_list.readyOnly: true`는 GitHub Project의 **Ready 상태만** 필터링합니다. Backlog를 포함하거나 선행 작업 완료를 추론하지 않습니다. `includeDependencies: true`로 요청한 선행 작업 확인은 별도 `dependencyCheck`에 `satisfied`·`blocked`·`not_configured`·`unknown`으로 반환합니다. 참조가 없다는 것이 의존성이 없다는 보증은 아닙니다.

## 읽기 오류 구분

오류는 설명과 함께 `code`, `details.reason`을 반환합니다. HTTP 응답이 있으면 `details.httpStatus`도 포함합니다.

| 코드/원인 | 의미 |
| --- | --- |
| `document_not_found` | 기준 커밋에 문서가 없거나 문서 API에서 찾을 수 없음 |
| `commit_not_found` | 지정한 커밋·트리를 찾을 수 없거나 해당 버전을 조회할 수 없음 |
| `reauthentication_required` | 인증 만료 등으로 다시 로그인 필요 (401) |
| `github_permission_denied` | GitHub가 조회 권한을 거부함 (403, 요청 한도 초과 제외) |
| `github_network_error` | GitHub와의 통신 자체가 실패함 |
| `github_resource_not_found` | 기타 리소스가 없거나 접근 불가 |
| `github_unavailable` | `reason`으로 요청 한도(`rate_limited`)·서버 오류(`server_error`)·잘못된 응답(`invalid_response`) 등을 구분 |

GitHub는 비공개 리소스의 권한 부족을 404로 숨길 수 있습니다. 이 경우 `not_found_or_inaccessible`로 표시하며 “없음” 또는 “권한 부족”으로 단정하지 않습니다. 파일별 검색 실패는 `errors`에 경로·코드·설명을 남기고 `coverage.complete=false`로 표시합니다. 파일 크기 초과와 일반 파일이 아닌 경우도 문서 없음과 구분합니다.

## 쓰기와 사용자 확인

MCP를 통한 모든 쓰기는 변경안을 준비한 뒤 Form Elicitation을 요청합니다. 확인 기능을 지원하지 않는 앱에서는 조회만 가능하며 쓰기는 차단됩니다. 일반 도구 호출 허용과 실제 변경 내용 확인은 별개입니다.

- `create`: Issue 생성과 Project 등록
- `update`: 제목·본문·담당자·마감일 수정
- `change_status`: 완료 이외의 Project 상태 변경
- `complete`: 연결 PR 병합과 미완료 체크리스트를 검사한 뒤 Project를 Done으로 변경하고 Issue 닫기

`requestId`는 하나의 논리적 변경에 고유한 값을 사용하고, 재시도에는 같은 값을 유지합니다. 다른 변경에 재사용하지 않습니다. 완료 검사는 다른 action으로 우회할 수 없습니다. PR을 자동 병합하지 않습니다.

거절·취소·확인 5분 시간 초과는 적용하지 않습니다. 이미 GitHub 변경이 시작된 뒤의 연결 장애는 결과가 불명확할 수 있습니다. 실행 기록으로 중복 생성을 방지하고, 명확한 권한 실패는 완료된 단계를 반복하지 않고 재시도합니다. 응답을 받지 못한 쓰기는 무조건 재실행하지 않으며 GitHub와 기록을 대조한 수동 확인이 필요합니다.

실행 기록은 앱 데이터 폴더의 `mcp-operations.sqlite3`에 저장합니다. 공유 협업 상태의 원본은 Git/GitHub입니다. 결과가 불명확할 때 이 파일을 삭제하거나 새 requestId로 무작정 다시 생성하지 마세요.

## 고급 도구와 호환 호출

서버 환경에 `OKHUB_MCP_ADVANCED_TOOLS=1`을 명시하면 다음 3개를 추가 노출합니다. 고급 쓰기도 사용자 확인이 필요합니다.

| 도구 | 역할 |
| --- | --- |
| `okhub_doc_validate` | 로컬 문서의 작성 형식 검사. 내용의 옳고 그름 판정·수정은 하지 않음 |
| `okhub_pr_list` | 열린 PR 기본 조회. 저장소·상태·작성자·리뷰 요청 대상·리뷰 결과·초안·검색어 필터 |
| `okhub_pr_manage` | 단건 `create`, `update`, `request_review`, `review`, `close`, `reopen`, `mark_ready`, `convert_to_draft`, `merge` |

PR 요약은 상태·초안·리뷰 결과·검사 요약·업데이트 시간·head 커밋을 제공합니다. 알 수 없는 리뷰/검사 상태는 정상 통과로 표시하지 않습니다. `review`는 의견·승인·수정 요청이며 병합과 별개입니다. `merge`에는 `mergeMethod: "merge" | "squash" | "rebase"`를 반드시 명시하고, AI가 사용자에게 방식을 확인해야 합니다. 저장소에서 금지한 방식을 다른 방식으로 자동 대체하지 않습니다. 서버는 브랜치 생성·커밋·push·보호 규칙 우회를 하지 않습니다. 일괄 처리는 제공하지 않습니다.

기존 `board_ready`, 생성·파생·상태 변경 도구는 기본 목록에서 제외하지만 호환 호출은 유지합니다. `board_ready`의 기본 대안은 `board_list`의 `readyOnly: true`입니다.

| 숨긴 호환 도구 | 현재 사용 도구 |
| --- | --- |
| `okhub_board_ready` | `okhub_board_list` + `readyOnly: true` |
| `okhub_board_create_issue`, `okhub_board_derive_backlog` | `okhub_board_manage` + `create` (단건) |
| `okhub_board_update_status` | `okhub_board_manage` + `change_status` 또는 `complete` |
| `okhub_pr_create` | `okhub_pr_manage` + `create` |
| `okhub_pr_approve_merge` | `review`와 `merge`를 각각 확인. 기존 별칭만 명시적인 승인 후 Squash 호환 동작 유지 |

## 연결 확인

1. 프로젝트명을 주지 않고 “최신 확정 기획 보여줘”를 요청합니다.
2. 목록의 커밋과 본문 커밋이 같은지 확인합니다.
3. FE/BE 작업과 일정 조회를 확인합니다. 없는 필드·권한 부족·잘림을 정상 최신 데이터로 오인하지 않습니다.
4. 별도 승인된 테스트 저장소에서 쓰기 확인 창의 대상과 변경 내용을 확인합니다.
5. 거절 시 무변경, 승인 시 한 번 적용, 미지원 환경에서 쓰기 차단을 확인합니다.

자동화 테스트는 공식 SDK 클라이언트와 GitHub HTTP fixture를 사용합니다. 이것만으로 특정 Codex·Claude 앱 버전의 확인 UI 지원을 보증하지는 않습니다. 앱별 실제 연결 검증 결과는 따로 확인해야 합니다.
