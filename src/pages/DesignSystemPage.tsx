import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            id="design-system-title"
            className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
          >
            OkHub design system
          </h1>
          <p className="mt-2 text-[var(--color-text-muted)]">
            구현 primitive와 token을 검증하는 개발 전용 화면
          </p>
        </div>
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
      </div>

      <section className="mt-8" aria-labelledby="colors-title">
        <h2
          id="colors-title"
          className="text-xl font-semibold text-[var(--color-text-strong)]"
        >
          Colors
        </h2>
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
        <h2
          id="buttons-title"
          className="text-xl font-semibold text-[var(--color-text-strong)]"
        >
          Buttons
        </h2>
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

      <section
        className="mt-8 max-w-3xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
        aria-labelledby="type-title"
      >
        <h2
          id="type-title"
          className="text-xl font-semibold text-[var(--color-text-strong)]"
        >
          Typography
        </h2>
        <p className="text-[length:var(--font-document-size)] leading-[var(--font-document-line)]">
          OkHub는 Git의 Markdown을 사람이 오래 읽어도 편안한 문서 화면으로
          보여줍니다.
        </p>
        <code className="font-mono text-[var(--color-primary-text)]">
          docs/features/map-search.md
        </code>
      </section>
    </section>
  );
}
