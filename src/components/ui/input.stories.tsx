import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "문서 제목", defaultValue: "지도 검색 API 계약" } };
export const Invalid: Story = { args: { "aria-label": "문서 제목", "aria-invalid": true, defaultValue: "이미 사용 중인 제목" } };
export const Disabled: Story = { args: { "aria-label": "문서 제목", disabled: true, defaultValue: "수정할 수 없음" } };
