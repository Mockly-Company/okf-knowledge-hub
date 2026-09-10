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
- 순백색 `#FFFFFF`은 로고의 `OK`에만 사용합니다. Primary action의 label은 눈부심을 줄인 민트 화이트 `#F4FFFD`를 사용합니다. Aqua Mint `#009E8E` 위의 일반 텍스트에는 사용하지 않습니다.

## 3. 색상

### Primary

| 토큰 | 값 | 용도 |
|---|---|---|
| `color.primary` | `#009E8E` | 로고 배경, 선택 표시, 포커스 |
| `color.primary.hover` | `#00A394` | Aqua Mint 강조 요소의 hover 배경 |
| `color.primary.action` | `#007C71` | 주요 버튼 배경 |
| `color.primary.action.hover` | `#00665F` | 주요 버튼 hover 배경 |
| `color.primary.action.pressed` | `#00544F` | 주요 버튼 pressed 배경 |
| `color.primary.text` | `#007C71` | 흰 배경의 링크와 활성 텍스트 |
| `color.primary.soft` | `#E5F5F3` | 선택 배경, badge와 avatar 배경 |
| `color.primary.soft.pressed` | `#D4EFEC` | Ghost button과 선택 항목 pressed 배경 |
| `color.on-primary` | `#F4FFFD` | Primary action 배경의 편안한 버튼 텍스트 |
| `color.on-logo` | `#FFFFFF` | 로고 마크의 `OK`에만 사용하는 예외 |

브랜드 Aqua Mint `#009E8E`와 주요 행동의 배경을 분리합니다. 주요 버튼은 `#007C71` 배경과 `#F4FFFD` 텍스트를 사용해 일반 크기 label에서도 `4.99:1` 대비를 확보합니다. 흰 배경의 Primary 계열 텍스트에는 `#007C71`을 사용합니다.

### Neutral

| 토큰 | 값 | 용도 |
|---|---|---|
| `color.text.strong` | `#24272D` | 제목과 주요 본문 |
| `color.text.default` | `#343941` | 일반 본문 |
| `color.text.muted` | `#6C737D` | 보조 설명과 metadata. Canvas와 Surface 모두에서 WCAG AA 대비를 충족합니다. |
| `color.text.disabled` | `#7D918F` | 비활성 control의 label과 icon |
| `color.border` | `#E5E7EB` | 기본 테두리 |
| `color.border.hover` | `#C7CDD4` | Hover된 control의 테두리 |
| `color.border.strong` | `#AEB5BF` | Pressed·강조 control의 테두리 |
| `color.control.disabled` | `#F1F3F5` | 비활성 control 배경 |
| `color.surface.pressed` | `#ECEFF2` | Neutral control의 pressed 배경 |
| `color.canvas` | `#F7F8F9` | Sidebar와 Main 내부의 보조 영역 |
| `color.surface` | `#FFFFFF` | Main, card, panel과 입력 표면 |

기본 화면 구조는 회색 `color.canvas` Sidebar와 흰색 `color.surface` Main으로 구분합니다. Main 안에서 그룹 구분이 필요한 보조 영역에만 Canvas를 제한적으로 사용합니다.

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
- 기본 weight: 본문 `400`, UI label `500`, control·강조 `600`
- 페이지 제목과 섹션 제목은 `600`을 사용합니다. `700`을 기본 제목 weight로 사용하지 않습니다.

### 표시 모드

| 항목 | Default | Compact |
|---|---:|---:|
| UI 본문 | `13/20px` | `12/18px` |
| 문서 본문 | `16/28px` | `15/25px` |
| 페이지 H1 | `28/36px` | `24/32px` |
| 문서 H2 | `24/32px` | `22/29px` |
| 코드 본문 | `13/20px` | `12/18px` |
| 기본 control 높이 | `36px` | `32px` |
| 기본 아이콘 | `16px` | `14px` |

- 페이지 H1과 문서 H1은 `600`, 섹션 제목과 문서 H2는 `600`을 사용합니다.

- 초기값은 `Default`입니다.
- 사용자는 `Settings → 화면 → 표시 밀도`에서 `Default`와 `Compact`를 전환합니다.
- 선택값은 기기별 로컬 설정에 저장하고 Git이나 `.okf/workspace.yml`에 기록하지 않습니다.
- 표시 모드는 Markdown 원문, Git diff, export 결과와 다른 팀원의 화면에 영향을 주지 않습니다.
- 문서 화면에서는 사용자용 이름을 `편안하게`와 `작게`로 표시하고, 문서 오버플로 메뉴와 Settings의 기기별 표시 밀도 설정이 같은 값을 사용합니다.
- 렌더링된 Markdown 본문은 일반 문단을 카드로 감싸지 않고 타이포그래피와 여백으로 위계를 만듭니다. 코드와 표는 기능적 경계와 내부 가로 스크롤을 사용하고, Mermaid는 기본적으로 별도 surface 없이 흰 문서 위에 표시합니다.
- Markdown의 제목, 목록, 각주, 코드·표, 안내 블록과 접기 영역은 두 표시 밀도에서 같은 의미 구조와 원문을 유지합니다. 표의 스크롤 영역과 본문 링크·접기 summary에는 키보드 focus 표시를 제공합니다.
- 코드 복사는 텍스트 action으로 성공 상태를 표시합니다. 다이어그램 확장·확대 제어는 접근 가능한 이름을 가진 tooltip 없는 icon-only action입니다.

## 5. 간격과 크기

- 간격은 4px grid를 사용합니다.
- 허용하는 기본 간격: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48px`
- 새로운 임의 값을 만들기 전에 가장 가까운 토큰을 사용합니다.
- 컴포넌트는 자신의 바깥쪽 `margin`을 소유하지 않습니다. 부모 layout의 `gap`이 형제 컴포넌트 사이의 간격을 결정합니다.

### 컴포넌트 사이 간격

| 관계 | Default | Compact | 예시 |
|---|---:|---:|---|
| 아이콘과 텍스트 | `8px` | `8px` | Button, menu item, status label |
| 같은 action group | `8px` | `8px` | 확인·취소 버튼, toolbar action |
| 컴포넌트 내부 요소 | `12px` | `8px` | 카드 안의 제목·본문·metadata |
| 반복되는 같은 항목 | `12px` | `8px` | 목록 row, Board card |
| Form field 사이 | `16px` | `12px` | label·input 단위의 반복 |
| 관련된 component group | `24px` | `20px` | 검색과 filter, 본문과 보조 action |
| Page section 사이 | `32px` | `24px` | 제목·요약·본문 영역 |
| 큰 화면 영역 사이 | `40px` | `32px` | 독립된 dashboard 영역 |

### Page layout rhythm

| 관계 | Default | Compact |
|---|---:|---:|
| Page 상단 시작점 | `32px` | `24px` |
| Page 좌우 여백 | `32px` | `24px` |
| 제목과 설명 | `8px` | `4px` |
| Header와 첫 콘텐츠 | `24px` | `20px` |
| Page section 사이 | `32px` | `24px` |

- Home, Documents, Project, Settings와 문서 상세·편집 화면은 같은 Page 상단·좌우 토큰을 사용합니다.
- selector, notice와 보조 action은 제목 위에 배치해 제목 시작점을 밀지 않습니다.
- Main만 세로 스크롤하고 Sidebar와 하단 사용자 영역은 고정합니다.
- Board, 표, 코드와 Diagram의 가로 스크롤은 해당 콘텐츠 영역 안에서만 발생합니다.

### Container padding

| 대상 | Default | Compact |
|---|---:|---:|
| 작은 card·popover | `12px` | `12px` |
| 기본 card·panel | `16px` | `16px` |
| Dialog | `24px` | `20px` |
| Page 좌우 여백 | `32px` | `24px` |
| Button 좌우 | `12px` | `12px` |
| Input 좌우 | `12px` | `12px` |

- radius:
  - `sm: 6px` — 작은 badge와 내부 item
  - `md: 8px` — button, input, menu item
  - `lg: 12px` — card, panel, dialog
  - `full: 999px` — avatar와 상태 pill

### Shape과 control sizing

- 기본 control 높이는 Default `36px`, Compact `32px`입니다.
- Button, Input, Select와 Menu item은 `8px` radius와 `1px` border를 사용합니다.
- Card, Panel과 Dialog는 `12px` radius를 사용합니다.
- 기본 Lucide icon은 Default `16px`, Compact `14px`, `strokeWidth 1.75`를 사용합니다.
- Input, Select, Textarea와 Button의 Focus는 Aqua Mint `1px` border와 빈 간격 없는 바깥 `1px` ring으로 표시합니다.
- Compact는 정보 밀도만 높이며 radius와 border 굵기를 바꾸지 않습니다.

## 6. 표면과 깊이

Border-first Hybrid 방식을 사용합니다.

- Sidebar는 `color.canvas`, 우측 Main은 `color.surface`를 사용합니다.
- Main 안에서 다시 구분해야 하는 보조 영역은 `color.canvas`를 사용합니다.
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
├─ Select
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

- Primary는 solid 배경으로 한 영역의 핵심 행동만 강조합니다.
- Secondary는 흰 배경과 neutral border를 사용합니다.
- Ghost는 기본 배경을 두지 않고 hover·pressed에서만 Primary soft 배경을 표시합니다.
- Destructive는 연한 Error 배경과 Error 전경을 사용하며 Primary와 시각적으로 경쟁하지 않습니다.

### Button 상태

| Variant | Default | Hover | Pressed | Disabled |
|---|---|---|---|---|
| Primary | `#007C71` + `#F4FFFD` | `#00665F` + `#F4FFFD` | `#00544F` + `#F4FFFD` | `#DDE8E6` + `#7D918F` |
| Secondary | 흰색 + `#E5E7EB` border | `#F7F8F9` + `#C7CDD4` | `#ECEFF2` + `#AEB5BF` | `#F1F3F5` + `#7D918F` |
| Ghost | 투명 | `#E5F5F3` | `#D4EFEC` | 투명 + `#7D918F` |
| Destructive | `#FFF0F1` + `#B23B4A` | `#FFE2E5` | `#F8CDD3` | `#F1F3F5` + `#7D918F` |

- Button Focus는 variant와 관계없이 `#009E8E` border와 빈 간격 없는 `1px` 바깥 ring을 사용합니다. Link는 `1px` outline과 `1px` offset을 사용합니다.
- Loading은 현재 배경을 유지하고 `LoaderCircle`을 표시하며 중복 실행을 막습니다.

### Tabs

- 같은 문서의 보기 모드처럼 한 맥락 안의 내용을 전환할 때 사용합니다.
- Tab list는 전체 폭 `1px` bottom divider를 사용하며, 각 tab은 배경을 두지 않습니다.
- 선택 tab은 `color.primary.text`와 `600` weight, 아래의 `2px` Aqua Mint indicator로 표시합니다. Hover는 배경 대신 text만 강조합니다.
- Indicator는 선택 tab의 너비와 위치를 따라 `180ms cubic-bezier(0.2, 0, 0, 1)`로 이동합니다. `prefers-reduced-motion`에서는 즉시 전환합니다.
- 방향키, Home, End로 enabled tab 사이를 이동하며, keyboard focus는 `1px` Aqua Mint outline과 `2px` offset을 사용합니다.

### Input·Select·선택 control 상태

| 상태 | 배경 | 테두리·표시 |
|---|---|---|
| Default | `#FFFFFF` | `#E5E7EB` |
| Hover | `#FFFFFF` | `#C7CDD4` |
| Focus | `#FFFFFF` | `#009E8E` border + 빈 간격 없는 `1px` ring |
| Filled | Default와 동일 | 값이 있다는 이유로 별도 색상을 쓰지 않음 |
| Invalid | `#FFFFFF` | Input은 `#C95B68` border + 오류 메시지. Focus 중에도 같은 색 `1px` ring 유지 |
| Disabled | `#F1F3F5` | `#E5E7EB`, text `#7D918F` |

- Radio와 Checkbox의 checked 색상은 `#009E8E`, check glyph는 `color.on-primary`를 사용합니다.
- 선택 가능한 row는 Hover에 `#F7F8F9`, Selected에 `#E5F5F3`와 `#009E8E` border를 사용합니다.
- Selected는 색상만으로 전달하지 않고 radio, check 또는 활성 표시선을 함께 사용합니다.

### Select

- 앱의 기본 Select는 native `<select>`가 아닌 shadcn/Radix 기반 Select를 사용합니다. 운영체제별로 열리는 native menu의 모양에 의존하지 않습니다.
- Trigger는 Input과 같은 Default `36px`, Compact `32px`, `8px` radius와 `1px` border를 사용합니다.
- Content는 Trigger와 같은 너비로 열고, 선택된 item을 Trigger 위치에 맞춰 정렬합니다. 아래로 열릴 때 Trigger의 하단 모서리와 Content의 상단 모서리를 제거해 `1px` 경계선으로 이어진 하나의 control처럼 보이게 하며, 이 연결형 Content에는 overlay shadow나 간격을 사용하지 않습니다.
- 문서 유형과 템플릿처럼 선택 이유가 필요한 경우에는 `제목 + 설명` option을 사용합니다. 이 option은 최소 `52px`이며, 단순 filter는 설명 없는 기본 `36px` option을 사용합니다.
- 닫힌 Trigger의 keyboard focus는 일반 control focus 규칙을 따릅니다. 열린 Content에서는 Trigger의 ring을 유지하지 않고, 선택 item의 Primary soft 배경과 check glyph로 현재 선택을 표시합니다. Invalid는 닫힌 Trigger와 오류 메시지에만 표시하며, 열린 Content에는 오류 테두리를 이어서 표시하지 않습니다.
- Option 사이에는 `4px` 간격을 둡니다. Hover와 키보드로 이동 중인 option은 ring 없이 Selected와 같은 Primary soft 배경으로 표시하고, 현재 선택은 check glyph와 Primary text로 구분합니다. Enter/Space로 열기·선택, 방향키 이동, Escape 닫기를 지원합니다.

### Dialog

- 기본 Dialog는 새 문서 생성, 연결 변경, 일반 확인처럼 한 작업을 끝내는 흐름에 사용합니다. 기본 너비는 `560px`이며 `12px` radius, overlay shadow, Default `24px`·Compact `20px` padding을 사용합니다.
- 구조는 `Header → scrollable body → footer action`입니다. 내용이 화면보다 길면 Header와 Footer를 고정하고 Body만 스크롤합니다.
- Header는 제목, 필요한 짧은 설명, 닫기 icon button으로 구성합니다. Footer action은 오른쪽 정렬하고 같은 action group 간격 `8px`을 사용합니다.
- 일반 확인 Dialog는 내용이 짧아도 같은 구조를 축소해 사용합니다. 삭제·폐기에는 대상 이름과 영향 설명을 포함하고 Destructive action을 사용합니다.
- 디스크 충돌처럼 두 버전을 비교해야 하는 경우에만 `760px`까지 넓은 변형을 사용합니다. 일반 form이나 단순 확인에 넓은 변형을 사용하지 않습니다.
- Dialog는 Escape와 닫기 action을 제공하고, focus trap 및 닫힌 뒤 trigger로 focus 복귀를 보장합니다. 전환은 `160–200ms`로 제한하며 `prefers-reduced-motion`에서는 불필요한 animation을 제거합니다.

### Dropdown Menu, Popover, Tooltip

- `DropdownMenu`는 경로 변경, 복제, GitHub에서 보기처럼 즉시 실행하는 action을 고르는 데 사용합니다. Trigger는 소비 화면이 소유하며, Menu primitive 자체에는 특정 `…` button을 포함하지 않습니다.
- Menu panel은 `12px` radius, `1px` border, overlay shadow를 사용합니다. 기본 item은 Default `36px`·Compact `32px`, `8px` radius이며 icon과 label 간격은 `8px`입니다. Hover와 keyboard 이동은 Canvas 배경으로 표시합니다.
- 위험 action은 separator 아래에 두고 Error 전경과 명확한 label을 사용합니다. 일반 action이 적은 메뉴에는 불필요한 group label을 추가하지 않습니다.
- `Popover`는 담당자, label, 보기 옵션처럼 짧은 값을 확인·변경하는 작은 설정 surface입니다. action만 나열하는 용도로 사용하지 않습니다.
- `Tooltip`은 icon-only button의 이름, 단축키 또는 짧은 추가 맥락만 표시합니다. action이나 form control을 넣지 않습니다.
- Menu와 Popover는 Escape로 닫히고 trigger로 focus를 돌려줍니다. Menu는 방향키와 Enter로 이동·실행할 수 있어야 하며, Tooltip은 hover와 keyboard focus 모두에서 표시합니다.

### Pointer cursor

- Button, link, 선택 row, menu item과 tab: `pointer`
- Disabled control: `not-allowed`
- Input과 Textarea: `text`
- Drag 가능 항목: `grab`; drag 중: `grabbing`
- Panel resize handle: `col-resize`
- 클릭 동작이 없는 Card에는 `pointer`를 사용하지 않습니다.

## 9. 상태와 피드백

- Control의 Hover·Focus·Pressed: border, ring, background와 color만 `180ms cubic-bezier(0.2, 0, 0, 1)`로 전환
- Pressed: Hover보다 한 단계 진한 배경
- Selected: Primary soft 배경, 활성 텍스트와 필요한 경우 왼쪽 표시선
- Focus: Input·Button은 Aqua Mint border와 빈 간격 없는 `1px` ring, Link는 `1px` outline과 `1px` offset
- Disabled: 명도와 대비를 낮추되 설명은 읽을 수 있게 유지
- Loading:
  - 버튼 작업은 `LoaderCircle`
  - 화면 최초 로딩은 skeleton
  - 전체 화면 spinner는 사용하지 않음
- Form 오류: 해당 field 아래에 원인과 해결 방법 표시. 별도 toast를 함께 띄우지 않음
- 짧고 되돌릴 필요 없는 Git·동기화 성공 결과: 화면 우측 상단 toast. 자동으로 사라지며, 중요한 선택 action은 넣지 않음
- GitHub 연결 끊김처럼 여러 화면에 영향을 주는 지속 상태: 화면 상단 banner. 상태와 영향, 재연결 action을 함께 표시
- 충돌, 인증, push 실패처럼 판단이 필요한 문제: 본문 오류 상태 또는 Dialog. 원인·영향·다음 action을 한곳에 표시
- 상태 아이콘은 한두 줄 메시지에서 텍스트 블록의 세로 중앙에 맞춘다. 닫기 icon button만 우측 상단에 독립시킨다.
- 상태에 맞는 outline action은 흰 배경과 상태색 border·text를 사용한다. 예: 연결 경고는 앰버, 디스크 충돌의 `비교하기`는 Error red
- 삭제, 연결 교체, 변경 폐기: 대상 이름이 포함된 확인 Dialog

Dialog와 panel 전환은 `160–200ms` 범위로 제한합니다. `prefers-reduced-motion`에서는 기능에 필요하지 않은 애니메이션을 제거합니다.

## 10. 화면 크기, 스크롤과 반응형

| 화면 너비 | Shell 동작 |
|---|---|
| `1440px` 이상 | Sidebar `260px`, Main은 남은 너비 사용 |
| `1024–1439px` | Sidebar `244px` |
| `768–1023px` | Sidebar를 overlay drawer로 전환하고 Main은 전체 너비 사용 |
| `768px` 미만 | 한 열 구성, action group은 줄바꿈하거나 세로 배치 |

- 앱 shell은 `100dvh`를 사용하며 Sidebar와 Main은 각각 독립적으로 세로 스크롤합니다.
- 브라우저 전체의 가로 스크롤은 만들지 않습니다.
- Board만 자체 영역에서 가로 스크롤할 수 있습니다.
- Repository, Issue와 문서 목록은 정의된 최대 높이 이후 내부 스크롤합니다.
- Dialog가 화면보다 길면 header와 footer action은 유지하고 본문만 스크롤합니다.
- 문서 읽기 영역은 최대 `880px`, 일반 Settings는 최대 `1120px`, Board는 가용 너비 전체를 사용합니다.
- 좁은 화면의 table과 diff는 해당 컴포넌트 내부에서만 가로 스크롤합니다.
- 최소 지원 창 크기는 `720 × 600px`입니다.

## 11. Form

Field는 `Label → 도움말 → Control → 오류 또는 상태 메시지` 순서를 사용합니다.

- Field 사이 간격은 Default `16px`, Compact `12px`입니다.
- Label과 도움말은 `4px`, 도움말과 Control은 `8px`, Control과 오류 메시지는 `8px` 간격을 사용합니다.
- 도움말은 경로 규칙, 자동 생성 결과처럼 입력 전에 알아야 할 맥락이 있을 때만 표시합니다. 단순한 field에는 Label 다음에 Control을 바로 둡니다.
- Label 오른쪽에는 필요한 경우에만 `필수` 또는 `선택`을 표시합니다.
- Placeholder를 Label 대신 사용하지 않습니다.
- 필수 항목은 `필수`, 선택 항목은 필요한 경우 `선택`으로 표기합니다.
- 오류는 최초 입력 전에는 표시하지 않고 blur 또는 제출 이후 표시합니다.
- 제출 실패 시 입력값을 보존하고 첫 오류 field로 focus를 이동합니다.
- 오류 문구는 문제와 해결 방법을 함께 설명합니다.
- `label`, `aria-describedby`, `aria-invalid`를 연결합니다.
- 단순 Form은 Enter로 제출할 수 있습니다.
- 비동기 제출 중에는 중복 실행을 막고 submit button에 `LoaderCircle`을 표시합니다.
- 비활성 action을 사용한다면 주변 도움말로 활성 조건을 알 수 있게 합니다.

## 12. 빈 화면, 로딩과 오류

### 빈 화면

- 최초 사용: Lucide icon, 제목, 짧은 설명과 Primary action
- 검색 결과 없음: 현재 검색어 또는 filter를 설명하고 초기화 action 제공
- 권한 없음: 필요한 권한과 해결 경로 제공
- 큰 일러스트 대신 `20–24px` Lucide icon 사용

### Loading

- 최초 화면: 실제 content 구조를 닮은 skeleton
- Button 작업: Button 내부 `LoaderCircle`
- 목록 새로고침: 기존 목록을 유지하고 작은 갱신 표시
- Clone, push와 같은 장기 작업: 현재 단계 또는 진행 메시지 표시
- 전체 화면 spinner만 단독으로 표시하지 않음

### 오류

- 일부 컴포넌트만 실패: 해당 컴포넌트 내부에 오류와 재시도 표시
- 화면 진행이 불가능: 본문 오류 화면 사용
- 인증, 충돌과 저장 실패: 원인, 영향, 해결 방법과 재시도 action 제공
- 사용자 판단이 필요한 실패를 toast만으로 처리하지 않음
- 기술 상세는 접어서 제공하고 복사 가능하게 함
- 오류가 발생해도 입력값과 작성 내용을 보존함

## 13. 접근성

- 일반 텍스트와 control label은 WCAG AA 대비를 목표로 합니다.
- 색상만으로 상태, 선택과 오류를 전달하지 않습니다.
- 키보드로 모든 action과 overlay에 접근할 수 있어야 합니다.
- Dialog는 focus trap을 사용하고 닫힌 뒤 trigger로 focus를 돌려줍니다.
- Tooltip은 hover뿐 아니라 keyboard focus에서도 노출합니다.
- icon-only button은 접근 가능한 이름을 갖습니다.
- OS 확대와 앱 zoom에서 중요한 content와 action이 잘리지 않아야 합니다.

## 14. 초기 범위와 검증

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
- Markdown과 Mermaid Story는 의미별 상태로 구분하고 문서 상세는 하나의 실제 문서 조합으로 확인합니다. Desktop·layout 경계 폭·mobile은 Story를 복제하거나 viewport를 고정하지 않고 테스트 matrix로 검사합니다.
- 모든 Story의 interaction과 global axe 접근성 검사를 통과해야 합니다. 정적 Storybook smoke는 코드·표의 내부 overflow를 확인하고, Markdown의 편안하게·작게 기준 이미지는 macOS Chromium에서 생성·비교합니다.
