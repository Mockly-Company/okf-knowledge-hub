import { Settings } from "lucide-react";
import { FormField } from "@/components/patterns/FormField";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { Select } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { usePreferences } from "@/features/preferences/PreferencesProvider";

const swatches = [
  ["Primary", "var(--color-primary)"],
  ["Primary soft", "var(--color-primary-soft)"],
  ["Success", "var(--color-success)"],
  ["Information", "var(--color-info)"],
  ["Warning", "var(--color-warning)"],
  ["Error", "var(--color-error)"],
] as const;

export function DesignSystemPage() {
  const { displayDensity, setDisplayDensity } = usePreferences();

  return (
    <section className="p-8" aria-labelledby="design-system-title">
      <PageHeader
        title="OkHub design system"
        titleId="design-system-title"
        description="구현 primitive와 token을 검증하는 개발 전용 화면"
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              void setDisplayDensity(
                displayDensity === "default" ? "compact" : "default",
              )
            }
          >
            {displayDensity === "default"
              ? "Compact로 보기"
              : "Default로 보기"}
          </Button>
        }
      />

      <section className="mt-8" aria-labelledby="colors-title">
        <SectionHeader title="Colors" titleId="colors-title" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {swatches.map(([name, color]) => (
            <div
              key={name}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <span
                className="mb-2 block h-12 rounded-[var(--radius-md)]"
                style={{ background: color }}
              />
              <strong>{name}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="buttons-title">
        <SectionHeader title="Buttons" titleId="buttons-title" />
        <div className="mt-3 flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Tooltip content="설정 열기">
            <Button variant="icon" aria-label="설정 열기">
              <Settings aria-hidden="true" strokeWidth={1.75} />
            </Button>
          </Tooltip>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="controls-title">
        <SectionHeader title="Controls" titleId="controls-title" />
        <div className="mt-3 grid max-w-3xl gap-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <FormField
            label="문서 제목"
            description="문서 트리와 뷰어에 표시됩니다."
          >
            <Input defaultValue="지도 검색 API 계약" />
          </FormField>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            <StatusBadge tone="neutral">준비됨</StatusBadge>
            <StatusBadge tone="success">로컬 저장됨</StatusBadge>
            <StatusBadge tone="info">검토 중</StatusBadge>
            <StatusBadge tone="warning">결정 필요</StatusBadge>
            <StatusBadge tone="error">저장 실패</StatusBadge>
          </div>
          <label className="grid gap-2 font-medium text-[var(--color-text-strong)]">
            문서 유형
            <Select aria-label="문서 유형" defaultValue="api-contract">
              <option value="api-contract">API 계약</option>
              <option value="decision">기술 결정</option>
            </Select>
          </label>
          <label className="grid gap-2 font-medium text-[var(--color-text-strong)]">
            Markdown
            <Textarea defaultValue="# 지도 검색 API 계약" rows={3} />
          </label>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox defaultChecked aria-label="별도 변경 만들기" />
              별도 변경 만들기
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Radio name="density-preview" defaultChecked aria-label="기본 밀도" />
              기본 밀도
            </label>
          </div>
          <TabsList aria-label="문서 표시 모드">
            <TabsTrigger selected>미리보기</TabsTrigger>
            <TabsTrigger selected={false}>Markdown</TabsTrigger>
            <TabsTrigger selected={false} disabled>
              비활성 탭
            </TabsTrigger>
          </TabsList>
          <div
            role="group"
            aria-label="비활성 controls"
            className="grid gap-[var(--space-3)]"
          >
            <Input aria-label="비활성 입력" defaultValue="입력할 수 없음" disabled />
            <Select aria-label="비활성 선택" defaultValue="disabled" disabled>
              <option value="disabled">선택할 수 없음</option>
            </Select>
            <Textarea
              aria-label="비활성 Markdown"
              defaultValue="수정할 수 없음"
              rows={2}
              disabled
            />
            <div className="flex flex-wrap items-center gap-[var(--space-5)]">
              <label className="flex items-center gap-[var(--space-2)]">
                <Checkbox aria-label="비활성 체크박스" disabled />
                비활성 체크박스
              </label>
              <label className="flex items-center gap-[var(--space-2)]">
                <Radio
                  name="density-preview"
                  aria-label="비활성 라디오"
                  disabled
                />
                비활성 라디오
              </label>
            </div>
          </div>
          <div>
            <Button disabled>저장할 수 없음</Button>
          </div>
        </div>
      </section>

      <section
        className="mt-8 max-w-3xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
        aria-labelledby="type-title"
      >
        <SectionHeader
          title="Typography"
          titleId="type-title"
          description="승인된 크기와 굵기 위계"
        />
        <p className="text-[length:var(--font-document-size)] leading-[var(--font-document-line)] font-[number:var(--font-weight-body)]">
          OkHub는 Git의 Markdown을 사람이 오래 읽어도 편안한 문서 화면으로
          보여줍니다.
        </p>
        <code className="font-mono font-[number:var(--font-weight-body)] text-[var(--color-primary-text)]">
          docs/features/map-search.md
        </code>
        <p className="m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] font-[number:var(--font-weight-body)] text-[var(--color-text-muted)]">
          로컬 저장됨 · 방금 전
        </p>
      </section>
    </section>
  );
}
