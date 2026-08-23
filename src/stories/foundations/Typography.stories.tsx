import { useLayoutEffect, type CSSProperties, type PropsWithChildren } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Foundations/Typography",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function DensityPreview({
  density,
  children,
}: PropsWithChildren<{ density: "default" | "compact" }>) {
  useLayoutEffect(() => {
    document.documentElement.dataset.density = density;

    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);

  return <>{children}</>;
}

function Specimen({
  label,
  style,
  children,
}: PropsWithChildren<{ label: string; style: CSSProperties }>) {
  return (
    <section className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]">
      <p className="text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
        {label}
      </p>
      <div style={style}>{children}</div>
    </section>
  );
}

function TypographyReference({ density }: { density: "default" | "compact" }) {
  return (
    <DensityPreview density={density}>
      <div className="min-h-screen bg-[var(--color-canvas)] p-[var(--space-8)] text-[var(--color-text-default)]">
        <div className="mx-auto grid max-w-5xl gap-[var(--space-4)]">
          <Specimen
            label={`${density === "default" ? "Default" : "Compact"} UI body`}
            style={{
              fontSize: "var(--font-ui-size)",
              lineHeight: "var(--font-ui-line)",
              fontWeight: "var(--font-weight-body)",
            }}
          >
            사이드바, 표, 설정 항목처럼 밀도가 높은 화면에서도 오래 읽기 편한 UI 본문입니다.
          </Specimen>

          <Specimen
            label="Page title"
            style={{
              fontSize: "var(--font-h1-size)",
              lineHeight: "var(--font-h1-line)",
              fontWeight: "var(--font-weight-page-title)",
              color: "var(--color-text-strong)",
            }}
          >
            Documents
          </Specimen>

          <Specimen
            label="Document body"
            style={{
              fontSize: "var(--font-document-size)",
              lineHeight: "var(--font-document-line)",
              fontWeight: "var(--font-weight-body)",
            }}
          >
            이 문단은 문서 본문과 리뷰 설명처럼 긴 내용을 읽는 영역을 대표합니다. 넉넉한 행간과
            안정적인 대비를 유지해 스캔과 정독 모두에 적합해야 합니다.
          </Specimen>

          <Specimen
            label="Metadata"
            style={{
              fontSize: "var(--font-meta-size)",
              lineHeight: "var(--font-meta-line)",
              fontWeight: "var(--font-weight-description)",
              color: "var(--color-text-muted)",
            }}
          >
            Last updated 2026-08-22 · reviewer: design-system-rollout
          </Specimen>

          <Specimen
            label="Code sample"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "var(--font-ui-size)",
              lineHeight: "var(--font-ui-line)",
              fontWeight: "var(--font-weight-body)",
              color: "var(--color-text-strong)",
            }}
          >
            <code>pnpm test:storybook -- src/components/ui/button.stories.tsx</code>
          </Specimen>
        </div>
      </div>
    </DensityPreview>
  );
}

export const DefaultScale: Story = {
  render: () => <TypographyReference density="default" />,
};

export const CompactScale: Story = {
  render: () => <TypographyReference density="compact" />,
};
