import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox";

const meta = { title: "UI/Checkbox", component: Checkbox, parameters: { layout: "centered" } } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "공개", defaultChecked: true } };
export const Disabled: Story = { args: { "aria-label": "공개 불가", disabled: true } };
