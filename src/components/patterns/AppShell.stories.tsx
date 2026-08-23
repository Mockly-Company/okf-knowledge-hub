import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AppShell } from "./AppShell";
import {
  useStorybookProviderBoundary,
  withAppProviders,
} from "@/stories/decorators/AppProviders";
import { AppRoutes } from "@/app/AppRoutes";

function LongContentPage() {
  return (
    <div>
      <HomePage />
      <section
        aria-label="추가 스크롤 내용"
        className="px-[var(--page-padding-inline)] pb-[var(--space-10)]"
      >
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]">
          <p className="m-0 text-[var(--color-text-muted)]">
            메인 영역 독립 스크롤 검토를 위한 추가 길이입니다.
          </p>
          <div aria-hidden="true" className="h-[140dvh]" />
        </div>
      </section>
    </div>
  );
}

function AppShellRoutesPreview() {
  const { documents } = useStorybookProviderBoundary();

  return <AppRoutes documentsGateway={documents} />;
}

function LongContentPreview() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LongContentPage />} />
      </Route>
    </Routes>
  );
}

function ReauthenticationRoutePreview() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/project" element={<ProjectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
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

export const DocumentsRoute: Story = {
  decorators: [
    withAppProviders({
      includeDocumentsProvider: false,
      router: { initialEntries: ["/documents"] },
    }),
  ],
  render: () => <AppShellRoutesPreview />,
  play: async ({ canvas, userEvent }) => {
    const menu = canvas.getByRole("navigation", { name: "주 메뉴" });
    const documents = canvas.getByRole("link", { name: "Documents" });

    await userEvent.tab();
    await expect(menu).toContainElement(documents);
    await expect(documents).toBeVisible();
    await userEvent.tab();
    await userEvent.tab();
    await expect(documents).toHaveFocus();
    await expect(documents).toHaveAttribute("aria-current", "page");
  },
};

export const LongContentScroll: Story = {
  decorators: [withAppProviders({ router: { initialEntries: ["/"] } })],
  render: () => <LongContentPreview />,
};

export const NarrowViewport: Story = {
  decorators: [
    withAppProviders({
      includeDocumentsProvider: false,
      router: { initialEntries: ["/documents"] },
    }),
  ],
  render: () => (
    <div className="mx-auto min-h-dvh max-w-[720px] overflow-hidden border-x border-[var(--color-border)]">
      <AppShellRoutesPreview />
    </div>
  ),
};

function reauthenticationStory(path: string): Story {
  return {
    decorators: [
      withAppProviders({
        workspace: { authState: { status: "reauthentication_required" } },
        router: { initialEntries: [path] },
      }),
    ],
    render: () => <ReauthenticationRoutePreview />,
    play: async ({ canvas }) => {
      await expect(canvas.getByRole("status")).toHaveTextContent("GitHub 재로그인 필요");
      await expect(
        canvas.getByRole("link", { name: "Settings에서 다시 연결" }),
      ).toHaveAttribute("href", "/settings");
    },
  };
}

export const ReauthenticationHome = reauthenticationStory("/");

export const ReauthenticationDocuments = reauthenticationStory("/documents");

export const ReauthenticationProject = reauthenticationStory("/project");

export const ReauthenticationSettings = reauthenticationStory("/settings");

export const ReauthenticationRequired: Story = {
  decorators: [
    withAppProviders({
      workspace: { authState: { status: "reauthentication_required" } },
      router: { initialEntries: ["/"] },
    }),
  ],
  render: () => <LongContentPreview />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("GitHub 재로그인 필요");
    await expect(
      canvas.getByRole("link", { name: "Settings에서 다시 연결" }),
    ).toHaveAttribute("href", "/settings");
  },
};
