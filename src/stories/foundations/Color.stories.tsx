import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Foundations/Color",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

type ColorPair = {
  label: string;
  usage: string;
  foreground: `--${string}`;
  background: `--${string}`;
};

const primaryPairs: ColorPair[] = [
  {
    label: "Primary action",
    usage: "주요 버튼과 핵심 행동",
    foreground: "--color-on-primary",
    background: "--color-primary-action",
  },
  {
    label: "Primary soft",
    usage: "선택 배경과 보조 강조",
    foreground: "--color-primary-text",
    background: "--color-primary-soft",
  },
];

const neutralPairs: ColorPair[] = [
  {
    label: "Surface + strong text",
    usage: "카드, 패널, 주요 본문",
    foreground: "--color-text-strong",
    background: "--color-surface",
  },
  {
    label: "Canvas + muted text",
    usage: "보조 영역, 메타데이터",
    foreground: "--color-text-muted",
    background: "--color-canvas",
  },
];

const semanticPairs: ColorPair[] = [
  {
    label: "Success",
    usage: "완료, 연결 정상, 승인",
    foreground: "--color-success",
    background: "--color-success-soft",
  },
  {
    label: "Information",
    usage: "검토, 안내, 일반 정보",
    foreground: "--color-info",
    background: "--color-info-soft",
  },
  {
    label: "Warning",
    usage: "결정 필요, 지연, 주의",
    foreground: "--color-warning",
    background: "--color-warning-soft",
  },
  {
    label: "Error",
    usage: "실패, 충돌, 파괴적 행동",
    foreground: "--color-error",
    background: "--color-error-soft",
  },
];

function Swatch({
  label,
  usage,
  foreground,
  background,
}: ColorPair) {
  const swatchStyle = {
    color: `var(${foreground})`,
    backgroundColor: `var(${background})`,
    borderColor: "var(--color-border)",
  } satisfies CSSProperties;

  return (
    <article className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]">
      <div
        className="rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-3)]"
        style={swatchStyle}
      >
        <div className="text-[length:var(--font-group-size)] font-[number:var(--font-weight-control)] leading-[var(--font-group-line)]">
          {label}
        </div>
        <p className="text-[length:var(--font-ui-size)] leading-[var(--font-ui-line)]">
          {usage}
        </p>
      </div>
      <dl className="grid gap-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
        <div className="flex gap-[var(--space-2)]">
          <dt className="font-[number:var(--font-weight-description)] text-[var(--color-text-default)]">
            Foreground
          </dt>
          <dd>{foreground}</dd>
        </div>
        <div className="flex gap-[var(--space-2)]">
          <dt className="font-[number:var(--font-weight-description)] text-[var(--color-text-default)]">
            Background
          </dt>
          <dd>{background}</dd>
        </div>
      </dl>
    </article>
  );
}

function ColorSection({
  title,
  description,
  pairs,
}: {
  title: string;
  description: string;
  pairs: ColorPair[];
}) {
  return (
    <section className="grid gap-[var(--space-3)]">
      <div className="grid gap-[var(--space-1)]">
        <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
          {title}
        </h2>
        <p className="text-[length:var(--font-ui-size)] leading-[var(--font-ui-line)] text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        {pairs.map((pair) => (
          <Swatch key={pair.label} {...pair} />
        ))}
      </div>
    </section>
  );
}

export const UsagePairs: Story = {
  render: () => (
    <div className="min-h-screen bg-[var(--color-canvas)] p-[var(--space-8)] text-[var(--color-text-default)]">
      <div className="mx-auto grid max-w-6xl gap-[var(--space-6)]">
        <ColorSection
          title="Primary"
          description="브랜드 Aqua Mint와 핵심 행동을 분리해 의미를 유지합니다."
          pairs={primaryPairs}
        />
        <ColorSection
          title="Neutral"
          description="Canvas와 Surface의 구조 차이를 유지하면서 본문 대비를 확보합니다."
          pairs={neutralPairs}
        />
        <ColorSection
          title="Semantic"
          description="상태 의미는 색상과 라벨을 함께 사용합니다."
          pairs={semanticPairs}
        />
      </div>
    </div>
  ),
};
