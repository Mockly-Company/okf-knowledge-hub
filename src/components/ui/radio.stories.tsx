import type { Meta, StoryObj } from "@storybook/react-vite";
import { Radio } from "./radio";

const meta = { id: "ui-radio", title: "UI 컴포넌트/Radio", component: Radio, parameters: { layout: "centered" } } satisfies Meta<typeof Radio>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "기본 공개 범위", defaultChecked: true } };
