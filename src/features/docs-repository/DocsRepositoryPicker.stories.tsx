import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect } from "storybook/test";
import { createQueryClient } from "@/infrastructure/query/queryClient";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { DocsRepositoryPicker } from "./DocsRepositoryPicker";

function Demo({ okf }: { okf: boolean }) {
  const [client] = useState(() => createQueryClient());
  const [docs] = useState(() => {
    const gateway = new FakeDocsRepositoryGateway();
    gateway.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: true };
    gateway.okf = okf;
    return gateway;
  });
  const [repositories] = useState(() => FakeWorkspaceConnectionGateway.connected());
  return (
    <QueryClientProvider client={client}>
      <div className="max-w-xl p-[var(--space-6)]">
        <DocsRepositoryPicker
          projectId="project-1"
          gateway={docs}
          repositoryGateway={repositories}
          onConnected={() => {}}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  id: "features-docsrepositorypicker",
  title: "기능/문서 저장소 선택",
  component: Demo,
  args: { okf: true },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    ).toBeVisible();
  },
};

export const NotOkf: Story = {
  args: { okf: false },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );
    await expect(await canvas.findByText("OKF 형식에 맞지 않는 저장소입니다.")).toBeVisible();
  },
};
