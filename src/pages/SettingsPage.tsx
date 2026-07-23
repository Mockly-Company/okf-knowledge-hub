import { Check } from "lucide-react";
import { usePreferences } from "@/features/preferences/PreferencesProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { cn } from "@/lib/utils";

const settingsCategories = [
  "워크스페이스",
  "외부 연결",
  "문서",
  "작업 방식",
  "화면",
  "AI 연동",
];

const options: Array<{
  value: DisplayDensity;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description: "문서 읽기와 작업 화면의 균형 잡힌 기본 크기",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Board와 탐색에서 더 많은 정보를 표시",
  },
];

export function SettingsPage() {
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();

  return (
    <section className="p-8" aria-labelledby="settings-title">
      <h1
        id="settings-title"
        className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
      >
        Settings
      </h1>
      <div className="mt-8 grid max-w-4xl gap-8 md:grid-cols-[180px_1fr]">
        <aside aria-labelledby="settings-categories-title">
          <h2 id="settings-categories-title" className="sr-only">
            설정 카테고리
          </h2>
          <ul className="m-0 grid list-none content-start gap-1 p-0">
            {settingsCategories.map((item) => (
              <li key={item}>
                <span
                  aria-current={item === "화면" ? "true" : undefined}
                  className={cn(
                    "block rounded-[var(--radius-md)] px-3 py-2",
                    item === "화면" &&
                      "bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-text)]",
                  )}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </aside>
        <div>
          <h2 className="m-0 text-xl font-semibold text-[var(--color-text-strong)]">
            화면
          </h2>
          <p className="mt-1 text-[var(--color-text-muted)]">
            이 기기의 화면 표시만 변경하며 Git으로 공유하지 않습니다.
          </p>
          <fieldset className="mt-6 border-0 p-0" disabled={isLoading}>
            <legend className="mb-3 font-semibold text-[var(--color-text-strong)]">
              표시 밀도
            </legend>
            <div className="grid gap-3 md:grid-cols-2">
              {options.map((option) => {
                const selected = displayDensity === option.value;
                const id = `display-density-${option.value}`;

                return (
                  <div key={option.value}>
                    <input
                      id={id}
                      type="radio"
                      name="display-density"
                      aria-label={option.label}
                      value={option.value}
                      checked={selected}
                      onChange={() => void setDisplayDensity(option.value)}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor={id}
                      className={cn(
                        "block cursor-pointer rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-primary)] peer-focus-visible:outline-offset-2",
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                          : "border-[var(--color-border)]",
                      )}
                    >
                      <span className="flex items-center justify-between font-semibold text-[var(--color-text-strong)]">
                        {option.label}
                        {selected && (
                          <Check aria-hidden="true" size={16} strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="mt-1 block text-[var(--color-text-muted)]">
                        {option.description}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
