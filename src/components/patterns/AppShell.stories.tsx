import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { withAppProviders } from "@/stories/decorators/AppProviders";

function ShellPreview() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={(
            <div className="p-[var(--page-padding-inline)]">
              <section aria-label="Shell content" className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]">
                <h2 className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] text-[var(--color-text-strong)]">Main content</h2>
                <p className="mb-0 mt-[var(--space-2)] text-[var(--color-text-muted)]">페이지 조합 없이 Shell의 main 영역만 검수합니다.</p>
              </section>
            </div>
          )}
        />
      </Route>
    </Routes>
  );
}

const meta = {
  title: "Patterns/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AppShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withAppProviders({ router: { initialEntries: ["/"] } })],
  render: () => <ShellPreview />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Main content" })).toBeVisible();
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
  },
};

export const ReauthenticationRequired: Story = {
  decorators: [
    withAppProviders({
      workspace: { authState: { status: "reauthentication_required" } },
      router: { initialEntries: ["/"] },
    }),
  ],
  render: () => <ShellPreview />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("GitHub 재로그인 필요");
    await expect(
      canvas.getByRole("link", { name: "Settings에서 다시 연결" }),
    ).toHaveAttribute("href", "/settings");
  },
};
