import type { DocumentAsset, DocumentContent } from "@/features/documents/model";
import { documentFixtures } from "./documents";

const referenceMarkdown = `# 지도 검색 API 계약

사용자가 입력한 검색어와 현재 위치로 장소 후보를 찾습니다. 이 계약은 웹과 데스크톱 클라이언트가 함께 사용합니다.

> [!NOTE]
> 좌표는 WGS84 기준이며 검색어는 공백을 제거한 뒤 전달합니다.

## 요청

\`GET /v1/places/search\`는 검색어 \`query\`와 선택적인 중심 좌표를 받습니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| query | string | 검색어, 2자 이상 |
| latitude | number | 중심 위도 |
| longitude | number | 중심 경도 |

## 응답

~~~json
{
  "places": [{ "id": "place-001", "name": "서울숲", "distance": 420 }],
  "nextCursor": null
}
~~~

응답은 거리순으로 정렬합니다. 빈 결과는 오류가 아닌 빈 \`places\` 배열입니다.

## 처리 흐름

~~~mermaid
flowchart LR
  A[검색 요청] --> B[입력 검증]
  B --> C[장소 조회]
  C --> D[응답 반환]
~~~

## 운영 확인

- [x] 응답 DTO와 오류 코드를 합의했습니다.
- [ ] 공급자 장애 시 재시도 정책을 점검합니다.

[지도 장소 검색 기능](../features/map-search.md)에서 사용자 흐름을 확인합니다.
`;

function content(markdown: string): DocumentContent {
  return documentFixtures.content(documentFixtures.mapSearchApi(), markdown);
}

export const markdownFixtures = {
  referenceDocument: (): DocumentContent => ({
    ...content(referenceMarkdown),
    properties: { type: "API 계약", owner: "Platform" },
    tableOfContents: [
      { level: 1, title: "지도 검색 API 계약", id: "지도-검색-api-계약" },
      { level: 2, title: "요청", id: "요청" },
      { level: 2, title: "응답", id: "응답" },
      { level: 2, title: "처리 흐름", id: "처리-흐름" },
      { level: 2, title: "운영 확인", id: "운영-확인" },
    ],
    lastCommit: {
      commitOid: "aabbccddeeff00112233445566778899",
      shortOid: "aabbccd",
      authorName: "Kim",
      authoredAtUnix: 1_726_000_000,
      message: "지도 검색 API 계약을 갱신했습니다",
    },
  }),
  typographyAndLists: (): DocumentContent => ({
    ...content(`# 제목과 목록

본문은 **중요한 내용**, *보충 설명*, ~~취소된 정책~~과 \`inline code\`를 함께 읽을 수 있습니다.

[응답 규칙으로 이동](#응답-규칙)

## 응답 규칙

### 성공 응답

#### 장소 후보

##### 거리 계산

###### 경계 사례

1. 검색어를 확인합니다.
2. 결과를 표시합니다.
   - 장소 이름
   - 현재 위치에서의 거리

- [x] 정상 응답 확인
- [ ] 빈 결과 확인

> 검색 결과가 없어도 사용자에게 다음 행동을 안내합니다.

---

[API 안내](https://example.com/api)
`),
    tableOfContents: [
      { level: 1, title: "제목과 목록", id: "제목과-목록" },
      { level: 2, title: "응답 규칙", id: "응답-규칙" },
      { level: 3, title: "성공 응답", id: "성공-응답" },
      { level: 4, title: "장소 후보", id: "장소-후보" },
      { level: 5, title: "거리 계산", id: "거리-계산" },
      { level: 6, title: "경계 사례", id: "경계-사례" },
    ],
  }),
  alertsAndDetails: (): DocumentContent => content(`# 안내와 접기

> [!NOTE]
> 좌표의 기준은 WGS84입니다.

> [!TIP]
> 최근 검색어를 다시 사용하면 빠르게 찾을 수 있습니다.

> [!IMPORTANT]
> 요청마다 추적 ID를 전달합니다.

> [!WARNING]
> 공급자 응답이 늦으면 재시도 전에 잠시 기다립니다.

> [!CAUTION]
> 원본 위치 정보는 로그에 기록하지 않습니다.

<details>
<summary>오류 응답 예시 보기</summary>

~~~json
{ "code": "MAP_PROVIDER_UNAVAILABLE", "retryable": true }
~~~

</details>
`),
  codeAndTable: (): DocumentContent => content(`# 코드와 표

긴 코드와 넓은 표는 본문 폭을 유지하고 각 영역 안에서 스크롤합니다.

~~~typescript
const request = { query: "서울숲", latitude: 37.5445, longitude: 127.0374, cursor: "stable-local-cursor", include: ["name", "formattedAddress", "distance", "providerReference", "openingHours", "accessibility", "categories"] };
const response = await searchPlaces(request);
~~~

| 식별자 | 장소 | 주소 | 공급자 참조 | 상태 | 추적 ID |
| --- | --- | --- | --- | --- | --- |
| place-001 | 서울숲 | 서울특별시 성동구 뚝섬로 273 | provider-reference-with-a-deliberately-long-unbroken-value-for-overflow-verification | available | trace-20240911-map-search-001 |
| place-002 | 성수역 | 서울특별시 성동구 아차산로 | provider-reference-002 | available | trace-20240911-map-search-002 |
`),
  imagesAndFootnotes: (): DocumentContent => content(`# 이미지와 각주

![장소 검색 흐름](./assets/map-search.svg "저장소 안의 SVG로 표시한 검색 흐름")

검색 결과는 사용자의 현재 위치를 기준으로 정렬합니다.[^distance]

[^distance]: 거리는 미터 단위의 직선거리이며 실제 이동 거리와 다를 수 있습니다.
`),
  unsafeDocument: (): DocumentContent => content(`# 안전한 대체 표시

임의 HTML은 실행하지 않고 원문으로 보여줍니다.

<script>alert('not-executed')</script>

<iframe src="https://example.com/embed"></iframe>

![차단된 원격 이미지](https://example.com/blocked-map.svg)

[지원하지 않는 첨부 파일](./attachments/map-search.pdf)

[안전하지 않은 실행 링크](javascript:alert%281%29)
`),
  localSvgAsset: (): DocumentAsset => ({
    kind: "svg",
    source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160"><title>장소 검색 흐름</title><rect x="1" y="1" width="638" height="158" rx="8" fill="#f8fafc" stroke="#cbd5e1"/><rect x="32" y="48" width="160" height="64" rx="4" fill="#ffffff" stroke="#64748b"/><rect x="240" y="48" width="160" height="64" rx="4" fill="#ffffff" stroke="#64748b"/><rect x="448" y="48" width="160" height="64" rx="4" fill="#ffffff" stroke="#64748b"/><path d="M192 80h48m160 0h48" stroke="#475569" stroke-width="2"/><g fill="#0f172a" font-family="sans-serif" font-size="16" text-anchor="middle"><text x="112" y="86">검색 요청</text><text x="320" y="86">장소 조회</text><text x="528" y="86">결과 표시</text></g></svg>',
  }),
};

export const mermaidFixtures = {
  default: "flowchart LR\n  A[검색 요청] --> B[입력 검증]\n  B --> C[장소 조회]\n  C --> D[응답 반환]",
  loading: "flowchart LR\n  Pending[결정적으로 대기 중]",
  invalid: `flowchart LR\n  A[끝나지 않은 노드 ${"long-invalid-source-".repeat(30)}`,
  wide: "flowchart LR\n  A[클라이언트 요청] --> B[인증 확인] --> C[검색어 정규화] --> D[위치 정보 검증] --> E[캐시 조회] --> F[공급자 검색] --> G[중복 제거] --> H[거리순 정렬] --> I[페이지 구성] --> J[응답 반환]",
};
