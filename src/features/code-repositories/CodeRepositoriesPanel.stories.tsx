import type { Meta, StoryObj } from "@storybook/react-vite";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { CodeRepositoriesPanel } from "./CodeRepositoriesPanel";
import type { CodeRepositoriesGateway } from "./CodeRepositoriesGateway";

const sampleGateway: CodeRepositoriesGateway = {
  listWorkspaceCodeRepositories: async () => [
    {
      key: "web",
      label: "Acme Web",
      fullName: "Acme-Org/acme-web",
      localPath: "/Users/dev/workspace/acme-web",
      mappingSource: "auto_detected",
      exists: true,
    },
    {
      key: "api",
      label: "Acme API",
      fullName: "Acme-Org/acme-api",
      localPath: "/Users/dev/custom/acme-api",
      mappingSource: "manual",
      exists: true,
    },
    {
      key: "worker",
      label: "Acme Worker",
      fullName: "Acme-Org/acme-worker",
      localPath: null,
      mappingSource: "unmapped",
      exists: false,
    },
  ],
  setCodeRepositoryLocalPath: async (fullName, localPath) => ({
    key: "worker",
    label: "Acme Worker",
    fullName,
    localPath,
    mappingSource: "manual",
    exists: true,
  }),
  clearCodeRepositoryLocalPath: async () => {},
  readCodeRepositoryFile: async () => ({
    repositoryKey: "web",
    repositoryFullName: "Acme-Org/acme-web",
    filePath: "src/index.ts",
    startLine: 1,
    endLine: 1,
    totalLines: 1,
    content: "export {};",
  }),
};

const meta = {
  title: "Features/CodeRepositories/CodeRepositoriesPanel",
  component: CodeRepositoriesPanel,
  decorators: [
    (Story) => (
      <TestQueryProvider>
        <div className="bg-[var(--color-surface)] p-[var(--space-6)]">
          <Story />
        </div>
      </TestQueryProvider>
    ),
  ],
} satisfies Meta<typeof CodeRepositoriesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    gateway: sampleGateway,
  },
};
