import { Plus } from "lucide-react";
import { FormField } from "@/components/patterns/FormField";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const boardStatuses = [
  { name: "Backlog", tone: "bg-[var(--color-text-muted)]" },
  { name: "Ready", tone: "bg-[var(--color-info)]" },
  { name: "In progress", tone: "bg-[var(--color-warning)]" },
  { name: "In review", tone: "bg-[var(--color-primary)]" },
  { name: "Done", tone: "bg-[var(--color-success)]" },
] as const;

function BoardColumn({
  name,
  tone,
  canAddIssue,
}: {
  name: string;
  tone: string;
  canAddIssue: boolean;
}) {
  return (
    <section
      className="min-w-[208px] flex-1"
      aria-label={name}
    >
      <header className="flex h-[var(--control-height)] items-center gap-[var(--space-2)] px-[var(--space-1)]">
        <span className={`size-2 rounded-[var(--radius-full)] ${tone}`} aria-hidden="true" />
        <h2 className="m-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
          {name}
        </h2>
        <StatusBadge tone="neutral">0</StatusBadge>
      </header>
      <div className="grid gap-[var(--space-3)] pt-[var(--space-2)]">
        <div className="grid min-h-24 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-[var(--space-3)] text-center text-[var(--color-text-muted)]">
          연결된 Issue 없음
        </div>
        {canAddIssue ? (
          <div className="grid min-h-28 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)] text-center">
            <div className="grid justify-items-center gap-[var(--space-2)]">
              <Button type="button" variant="secondary" disabled>
                <Plus aria-hidden="true" strokeWidth={1.75} />
                새 Issue
              </Button>
              <p className="m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                GitHub Project와 Iteration을 연결하면 만들 수 있습니다.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ProjectPage() {
  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="project-title"
    >
      <PageHeader
        titleId="project-title"
        title="Project"
        actions={
          <div className="w-64 max-w-full">
            <FormField label="Iteration">
              <Select disabled defaultValue="none">
                <option value="none">현재 Iteration 없음</option>
              </Select>
            </FormField>
          </div>
        }
      />

      <div className="mt-[var(--space-6)] flex justify-end">
        <TabsList aria-label="Project 보기">
          <TabsTrigger selected>Board</TabsTrigger>
          <TabsTrigger selected={false} disabled>
            List
          </TabsTrigger>
        </TabsList>
      </div>

      <section
        className="mt-[var(--space-4)] overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
        aria-label="Project Board"
        tabIndex={0}
      >
        <div className="flex min-w-[1120px] gap-[var(--space-3)]">
          {boardStatuses.map(({ name, tone }) => (
            <BoardColumn
              key={name}
              name={name}
              tone={tone}
              canAddIssue={name === "Backlog"}
            />
          ))}
        </div>
      </section>
    </section>
  );
}
