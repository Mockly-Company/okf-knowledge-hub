# OkHub 사용 가이드

기능별 안내를 분리해 관리합니다.

- [시작하기](user-guide/getting-started.md): 도구의 구성과 현재 확인 범위
- [문서](user-guide/documents.md): 작성·편집, 자동 저장, 발행, 검토 요청·리뷰와 초안 복구
- [프로젝트](user-guide/projects.md): 현재 확정된 범위와 상세 사용법 준비 상태

[HTML 사용 가이드](user-guide.html)에서는 왼쪽 분류 메뉴를 선택해 오른쪽 본문을 확인할 수 있습니다. 모바일에서는 상단의 접이식 메뉴를 사용합니다.

## 파일 구성

- `user-guide/sections.json`: 분류의 순서·이름과 Markdown 파일 연결
- `user-guide/*.md`: 분류별 사용 설명
- `user-guide/assets/guide.css`: 화면·모바일·인쇄 스타일
- `user-guide/assets/guide.js`: 분류 메뉴·목차·키보드 이동 동작
- `user-guide.html`: Markdown에서 생성하는 HTML 본문

내용을 수정한 뒤 저장소 루트에서 `node scripts/build-user-guide.mjs`를 실행합니다. `node scripts/build-user-guide.mjs --check`로 HTML과 원본의 일치 여부를 확인할 수 있습니다.

HTML을 다른 위치로 옮길 때는 `user-guide/assets/`도 같은 상대 경로로 함께 복사하세요. 별도 서버나 Markdown 다운로드 요청 없이 로컬에서 동작합니다.
