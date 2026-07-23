# OkHub 디자인 시스템

**상태: 합의**
**승인일: 2026-07-23**

이 문서는 OkHub 초기 제품의 시각·상호작용 기준입니다. 화면별 HTML 시안보다 우선하며, 구현 시 shadcn 기반 primitive와 OkHub pattern에 동일하게 적용합니다.

## 1. 원칙

- 개발자가 문서, 코드, Issue와 리뷰를 한 화면에서 오래 읽는 제품이므로 정보 밀도와 읽기 편안함을 함께 유지합니다.
- 탐색, Board와 Settings는 compact하게 구성하고 문서 본문, 편집기와 리뷰 내용은 넉넉하게 표시합니다.
- 색상은 행동과 상태의 의미를 전달하되 색상만으로 상태를 구분하지 않습니다.
- 일반 콘텐츠는 얇은 테두리로 구분하고 실제로 화면 위에 뜨는 요소에만 그림자를 사용합니다.
- 초기 버전은 Light 테마만 지원합니다. 토큰은 역할 중심으로 이름을 붙여 이후 Dark 테마를 추가할 수 있게 합니다.

## 2. 브랜드 표기

- 앱 화면의 짧은 표기는 `OkHub`를 사용합니다.
- Git 저장소와 프로젝트의 정식 이름 `okf-knowledge-hub`는 유지합니다.
- 현재 로고 마크는 Aqua Mint 배경에 흰색 `OK`를 넣은 임시 형태입니다.
- 흰색 `OK`는 브랜드 마크의 예외입니다. 일반적인 작은 텍스트나 버튼 전경색으로 사용하지 않습니다.

## 3. 색상

### Primary

| 토큰 | 값 | 용도 |
|---|---|---|
| `color.primary` | `#009E8E` | 로고 배경, 주요 버튼 배경, 선택 표시, 포커스 |
| `color.primary.hover` | `#00A394` | 주요 버튼 hover 배경 |
| `color.primary.text` | `#007C71` | 흰 배경의 링크와 활성 텍스트 |
| `color.primary.soft` | `#E5F5F3` | 선택 배경, badge와 avatar 배경 |
| `color.on-primary` | `#082B28` | Primary 배경의 작은 버튼 텍스트 |
| `color.on-logo` | `#FFFFFF` | 로고 마크의 `OK`에만 사용하는 예외 |

`#009E8E` 위 흰색의 대비는 일반적인 작은 본문 기준에 부족하므로, 주요 버튼에는 `#082B28`을 사용합니다. 흰 배경에 Primary 계열 텍스트가 필요할 때는 `#007C71`을 사용합니다.

### Neutral

| 토큰 | 값 | 용도 |
|---|---|---|
| `color.text.strong` | `#16181D` | 제목과 주요 본문 |
| `color.text.default` | `#343941` | 일반 본문 |
| `color.text.muted` | `#6B717C` | 보조 설명과 metadata |
| `color.border` | `#E2E5E9` | 기본 테두리 |
| `color.canvas` | `#F6F7F9` | 앱 본문 배경 |
| `color.surface` | `#FFFFFF` | 카드, 패널과 입력 표면 |

### Semantic

| 의미 | 전경 | 연한 배경 | 사용 예 |
|---|---|---|---|
| Success | `#11764F` | `#E9F7F1` | 완료, 연결 정상, 승인 |
| Information | `#2563B5` | `#EAF2FF` | 검토, 안내, 일반 정보 |
| Warning | `#A15C00` | `#FFF4DF` | 결정 필요, 지연, 주의 |
| Error | `#B23B4A` | `#FFF0F1` | 실패, 충돌, 파괴적 행동 |

Semantic 색상은 해당 의미에만 사용합니다. 문서 타입, 담당 영역과 저장소를 장식 목적으로 색칠하지 않습니다. 아이콘 또는 텍스트 label을 항상 함께 제공합니다.

## 4. 타이포그래피와 표시 밀도

### 글꼴

- 기본: `Pretendard Variable`
- fallback: `Pretendard`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`
- 코드: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, `monospace`
- 기본 weight: 본문 `400`, UI label `500`, 강조 `600`, 제목 `700`

### 표시 모드

| 항목 | Default | Compact |
|---|---:|---:|
| UI 본문 | `13/20px` | `12/18px` |
| 문서 본문 | `16/28px` | `15/25px` |
| 페이지 H1 | `28/36px` | `24/32px` |
| 문서 H2 | `20/28px` | `18/26px` |
| 코드 본문 | `13/20px` | `12/18px` |
| 기본 control 높이 | `36px` | `32px` |
| 기본 아이콘 | `16px` | `14px` |

- 초기값은 `Default`입니다.
- 사용자는 `Settings → 화면 → 표시 밀도`에서 `Default`와 `Compact`를 전환합니다.
- 선택값은 기기별 로컬 설정에 저장하고 Git이나 `.okf/workspace.yml`에 기록하지 않습니다.
- 표시 모드는 Markdown 원문, Git diff, export 결과와 다른 팀원의 화면에 영향을 주지 않습니다.

## 5. 간격과 크기

- 간격은 4px grid를 사용합니다.
- 허용하는 기본 간격: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48px`
- 새로운 임의 값을 만들기 전에 가장 가까운 토큰을 사용합니다.
- radius:
  - `sm: 6px` — 작은 badge와 내부 item
  - `md: 8px` — button, input, menu item
  - `lg: 12px` — card, panel, dialog
  - `full: 999px` — avatar와 상태 pill

## 6. 표면과 깊이

Border-first Hybrid 방식을 사용합니다.

- Card, Panel, Input: `1px` 기본 테두리, 원칙적으로 그림자 없음
- 앱 shell: 테두리와 매우 약한 깊이만 허용
- Dialog, Popover, Dropdown, Tooltip: overlay 그림자 사용
- 선택 상태를 그림자로 표현하지 않고 Primary soft 배경과 label로 표현
- Hover 때 요소가 이동하거나 커지지 않습니다.

기본 overlay 그림자는 `0 12px 28px rgba(25, 30, 38, 0.13)`을 기준으로 합니다.

## 7. 아이콘

- 라이브러리: Lucide
- 기본 크기: `16px`; Compact: `14px`; 주요 단독 또는 빈 상태: `20px`
- 기본 `strokeWidth`: `1.75`
- 선택 상태에서 선 굵기를 바꾸지 않고 색상과 배경을 바꿉니다.
- 아이콘 단독 버튼은 사이드바 접기, 닫기, 검색, 더보기처럼 의미가 보편적인 경우에만 사용합니다.
- 아이콘 단독 버튼에는 tooltip과 `aria-label`이 필요합니다.
- 삭제, 복제, 경로 변경처럼 오해할 수 있는 작업은 아이콘과 텍스트를 함께 표시합니다.
- Emoji와 문자 기호를 제품 아이콘으로 사용하지 않습니다.
- Loading은 `LoaderCircle`, 성공은 `CircleCheck`, 오류는 `CircleAlert`처럼 역할별 아이콘을 고정합니다.

## 8. 컴포넌트 구조

shadcn을 디자인 완성품이 아니라 접근 가능한 primitive 기반으로 사용합니다.

```text
components/ui
├─ Button
├─ Input
├─ Dialog
├─ Popover
├─ DropdownMenu
└─ Tooltip

components/patterns
├─ StatusBadge
├─ SettingsRow
├─ DocumentTreeItem
├─ ReviewComment
├─ DecisionRequest
└─ RepositoryConnection
```

- `components/ui`는 색상, 밀도, focus, radius와 상태 variant를 소유합니다.
- `components/patterns`는 OkHub에서 반복되는 제품 의미와 조합을 소유합니다.
- 화면에서 임의 Tailwind class로 동일 패턴을 다시 만들지 않습니다.
- pattern은 제품 데이터 fetching이나 Git/GitHub mutation을 직접 수행하지 않습니다.

### Button variant

- `primary`: 한 영역에서 가장 중요한 한 행동
- `secondary`: 보조 행동
- `ghost`: toolbar와 낮은 우선순위 행동
- `destructive`: 삭제, 폐기, 연결 해제처럼 파괴적인 행동
- `icon`: 의미가 보편적이고 tooltip이 있는 단독 아이콘 행동

한 Dialog 또는 좁은 action group 안에는 Primary button을 하나만 둡니다.

## 9. 상태와 피드백

- Hover: 배경과 색상만 한 단계 변경, `120–160ms`
- Pressed: Hover보다 한 단계 진한 배경
- Selected: Primary soft 배경, 활성 텍스트와 필요한 경우 왼쪽 표시선
- Focus: `2px` Aqua Mint focus ring과 바깥 offset
- Disabled: 명도와 대비를 낮추되 설명은 읽을 수 있게 유지
- Loading:
  - 버튼 작업은 `LoaderCircle`
  - 화면 최초 로딩은 skeleton
  - 전체 화면 spinner는 사용하지 않음
- Form 오류: 해당 field 아래에 원인과 해결 방법 표시
- 짧은 Git·동기화 성공 결과: toast
- 충돌, 인증, push 실패처럼 판단이 필요한 문제: 본문 또는 Dialog
- 삭제, 연결 교체, 변경 폐기: 대상 이름이 포함된 확인 Dialog

Dialog와 panel 전환은 `160–200ms` 범위로 제한합니다. `prefers-reduced-motion`에서는 기능에 필요하지 않은 애니메이션을 제거합니다.

## 10. 접근성

- 일반 텍스트와 control label은 WCAG AA 대비를 목표로 합니다.
- 색상만으로 상태, 선택과 오류를 전달하지 않습니다.
- 키보드로 모든 action과 overlay에 접근할 수 있어야 합니다.
- Dialog는 focus trap을 사용하고 닫힌 뒤 trigger로 focus를 돌려줍니다.
- Tooltip은 hover뿐 아니라 keyboard focus에서도 노출합니다.
- icon-only button은 접근 가능한 이름을 갖습니다.
- OS 확대와 앱 zoom에서 중요한 content와 action이 잘리지 않아야 합니다.

## 11. 초기 범위와 검증

### 초기 범위

- Light 테마
- `Default`와 `Compact` 표시 밀도
- macOS와 Windows 데스크톱
- shadcn primitive와 OkHub pattern

### 제외

- Dark 테마
- 사용자 정의 Primary 색상
- 워크스페이스가 강제하는 팀 공용 표시 밀도
- 문서 타입과 담당 영역별 장식 색상

### 구현 검증

- primitive의 모든 variant와 상태를 Storybook 또는 동등한 component preview에서 확인합니다.
- `Default`와 `Compact` 모드로 Home, Documents, Project, 문서 상세와 Settings를 확인합니다.
- keyboard navigation, focus 복귀, tooltip과 Dialog를 검사합니다.
- Primary와 Semantic foreground/background 대비를 자동 검사합니다.
- macOS와 Windows의 Pretendard fallback, control 높이와 scroll 영역을 확인합니다.
