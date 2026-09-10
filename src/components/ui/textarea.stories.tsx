import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./textarea";

const meta = { title: "UI/Textarea", component: Textarea, parameters: { layout: "centered" } } satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "Markdown 본문", defaultValue: "# 지도 검색 API 계약", rows: 3 } };
export const Invalid: Story = { args: { "aria-label": "Markdown 본문", "aria-invalid": true, defaultValue: "유효하지 않은 내용", rows: 3 } };
