/** Editing examples, not a promise that every Markdown extension is supported. */
export const richEditorMarkdown = `---
title: Markdown 문법 검수
type: guide
owner: Platform
tags:
  - markdown
  - example
---

# 제목 1

이 문서는 에디터에서 기본 Markdown 문법을 직접 수정해보는 예시입니다.

## 제목 2

### 제목 3

#### 제목 4

##### 제목 5

###### 제목 6

## 글자 서식과 줄바꿈

일반 본문과 **굵게**, *기울임*, ***굵은 기울임***, ~~취소선~~, \`인라인 코드\`를 함께 작성합니다.

문단은 빈 줄로 구분합니다.

이 문장은 줄 끝에 공백 두 개를 넣었습니다.${"  "}
이 문장은 같은 문단의 다음 줄입니다.

## 목록

- 순서 없는 목록
- 두 번째 항목
  - 하위 항목
  - 다른 하위 항목

1. 요구사항을 정리합니다.
2. 구현 내용을 작성합니다.
   1. 정상 흐름을 확인합니다.
   2. 오류 흐름을 확인합니다.
3. 변경 내용을 검토합니다.

- [x] 제목과 본문 작성
- [x] 목록과 표 작성
- [ ] 코드와 링크 검토

## 인용문

> 사용자가 이해할 수 있는 표현으로 작성합니다.
>
> 여러 문단의 인용문도 작성할 수 있습니다.

## 구분선

아래 선은 서로 다른 내용을 나눕니다.

---

## 링크와 이미지

[외부 문서 링크](https://example.com/api)

[저장소의 다른 문서](../features/map-search.md)

[목록으로 이동](#목록)

![장소 검색 흐름](./assets/map-search.svg "검색 요청부터 결과 표시까지")

## 표

| 필드 | 타입 | 필수 | 설명 |
| :--- | :---: | ---: | --- |
| query | string | 예 | 검색어 |
| latitude | number | 아니요 | 중심 위도 |
| longitude | number | 아니요 | 중심 경도 |

## 코드 블록

~~~typescript
type SearchRequest = {
  query: string;
  latitude?: number;
  longitude?: number;
};

const request: SearchRequest = { query: "서울숲" };
~~~

~~~json
{
  "places": [{ "id": "place-001", "name": "서울숲" }],
  "nextCursor": null
}
~~~

~~~text
언어를 지정하지 않는 일반 텍스트도 작성할 수 있습니다.
~~~
`.replaceAll("~~~", "```");

export const allEditorMarkdown = `${richEditorMarkdown}
## 참조 링크와 자동 링크

[API 안내][api-reference]와 <https://example.com/docs>를 확인합니다.

[api-reference]: https://example.com/api "API 참고 문서"

## 특수문자 표시

\\*별표 그대로\\* · \\# 제목이 아닌 샵 · \\[대괄호\\]

## 안내 블록

> [!NOTE]
> 좌표의 기준은 WGS84입니다.

> [!TIP]
> 검색어를 짧고 명확하게 입력하면 결과를 찾기 쉽습니다.

> [!IMPORTANT]
> 요청마다 추적 ID를 전달합니다.

> [!WARNING]
> 공급자 응답이 늦으면 재시도 전에 잠시 기다립니다.

> [!CAUTION]
> 원본 위치 정보는 로그에 기록하지 않습니다.

## 각주

검색 결과의 거리는 현재 위치를 기준으로 계산합니다.[^distance]

[^distance]: 거리는 미터 단위의 직선거리이며 실제 이동 거리와 다를 수 있습니다.

## Mermaid 다이어그램

~~~mermaid
flowchart LR
  A[검색 요청] --> B[입력 검증]
  B --> C[장소 조회]
  C --> D[결과 표시]
~~~

## 접기 영역

<details>
<summary>오류 응답 예시 보기</summary>

~~~json
{ "code": "MAP_PROVIDER_UNAVAILABLE", "retryable": true }
~~~

</details>

## 원문 편집 안내

안내 블록, 각주, Mermaid와 접기 영역은 문서 뷰어의 표시 결과도 함께 확인합니다.
이 예시는 HTML 접기 영역을 포함하므로 원문 모드에서 편집합니다.
수식과 임의 HTML 실행처럼 지원을 보장하지 않는 확장 문법은 포함하지 않습니다.
`;
