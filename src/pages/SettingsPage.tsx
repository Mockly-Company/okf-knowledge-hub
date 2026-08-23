import { useState } from "react";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { Radio } from "@/components/ui/radio";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/features/preferences/PreferencesProvider";
import { WorkspaceSettingsPanel } from "@/features/workspace-connection/components/WorkspaceSettingsPanel";
import { GitHubAccountPanel } from "@/features/workspace-connection/components/GitHubAccountPanel";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { cn } from "@/lib/utils";
import { BuildInfoPanel } from "@/features/build-info/BuildInfoPanel";
import type { BuildInfoGateway } from "@/features/build-info/BuildInfoGateway";
import { createBuildInfoGateway } from "@/infrastructure/build-info/createBuildInfoGateway";

const settingsCategories = [
  "워크스페이스",
  "외부 연결",
  "문서",
  "작업 방식",
  "화면",
  "AI 연동",
  "앱 정보",
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

const defaultBuildInfoGateway = createBuildInfoGateway();

export function SettingsPage({
  buildInfoGateway = defaultBuildInfoGateway,
}: {
  buildInfoGateway?: BuildInfoGateway;
}) {
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();
  const [activeCategory, setActiveCategory] = useState("화면");

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="settings-title"
    >
      <PageHeader
        titleId="settings-title"
        title="Settings"
        description="워크스페이스와 앱 환경을 관리합니다."
      />
      <div className="mt-[var(--space-8)] grid max-w-[1120px] gap-[var(--space-8)] md:grid-cols-[180px_1fr]">
        <aside aria-labelledby="settings-categories-title">
          <h2 id="settings-categories-title" className="sr-only">
            설정 카테고리
          </h2>
          <ul className="m-0 grid list-none content-start gap-1 p-0">
            {settingsCategories.map((item) => (
              <li key={item}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveCategory(item)}
                  aria-current={item === activeCategory ? "page" : undefined}
                  className={cn(
                    "w-full justify-start",
                    item === activeCategory &&
                      "bg-[var(--color-primary-soft)] font-[number:var(--font-weight-control)] text-[var(--color-primary-text)]",
                  )}
                >
                  {item}
                </Button>
              </li>
            ))}
          </ul>
        </aside>
        {activeCategory === "워크스페이스" ? (
          <WorkspaceSettingsPanel />
        ) : activeCategory === "외부 연결" ? (
          <GitHubAccountPanel />
        ) : activeCategory === "화면" ? (
        <div>
          <SectionHeader
            title="화면"
            description="이 기기의 화면 표시만 변경하며 Git으로 공유하지 않습니다."
          />
          <fieldset className="mt-[var(--space-6)] border-0 p-0" disabled={isLoading}>
            <legend className="mb-[var(--space-3)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
              표시 밀도
            </legend>
            <div className="grid gap-[var(--space-3)] md:grid-cols-2">
              {options.map((option) => {
                const selected = displayDensity === option.value;
                const id = `display-density-${option.value}`;

                return (
                  <div key={option.value}>
                    <Radio
                      id={id}
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
                        "block cursor-pointer rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-[var(--space-4)] peer-disabled:cursor-not-allowed peer-disabled:opacity-60 peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-primary)] peer-focus-visible:outline-offset-2",
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                          : "border-[var(--color-border)]",
                      )}
                    >
                      <span className="flex items-center justify-between font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                        {option.label}
                        {selected && (
                          <Check aria-hidden="true" size={16} strokeWidth={1.75} />
                        )}
                      </span>
                      <span
                        className={cn(
                          "mt-[var(--space-1)] block font-[number:var(--font-weight-description)]",
                          selected
                            ? "text-[var(--color-text-default)]"
                            : "text-[var(--color-text-muted)]",
                        )}
                      >
                        {option.description}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
        ) : activeCategory === "앱 정보" ? (
          <BuildInfoPanel gateway={buildInfoGateway} />
        ) : (
          <div>
            <SectionHeader
              title={activeCategory}
              description="이 설정은 이후 작업에서 연결합니다."
            />
          </div>
        )}
      </div>
    </section>
  );
}
