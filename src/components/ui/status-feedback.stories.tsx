import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "./status-feedback";

const meta = {
  title: "UI/StatusFeedback",
  component: StatusFeedback,
  parameters: { layout: "padded" },
  args: {
    variant: "toast",
    tone: "info",
    children: null,
  },
} satisfies Meta<typeof StatusFeedback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FieldError: Story = {
  render: () => <StatusFeedback variant="field" tone="error">저장소 경로를 확인한 뒤 다시 시도해 주세요.</StatusFeedback>,
};

export const SuccessToast: Story = {
  render: () => <StatusFeedback variant="toast" tone="success"><StatusFeedbackTitle>로컬에 저장됨</StatusFeedbackTitle><StatusFeedbackDescription>지도 검색 API 계약</StatusFeedbackDescription></StatusFeedback>,
};

export const WarningToast: Story = {
  render: () => <StatusFeedback variant="toast" tone="warning"><StatusFeedbackTitle>동기화를 다시 확인해 주세요</StatusFeedbackTitle><StatusFeedbackDescription>GitHub 연결이 일시적으로 끊어졌습니다.</StatusFeedbackDescription></StatusFeedback>,
};

export const ErrorToast: Story = {
  render: () => <StatusFeedback variant="toast" tone="error"><StatusFeedbackTitle>로컬에 저장하지 못했습니다</StatusFeedbackTitle><StatusFeedbackDescription>잠시 후 다시 시도해 주세요.</StatusFeedbackDescription></StatusFeedback>,
};

export const WarningBannerAction: Story = {
  render: () => (
    <StatusFeedback variant="banner" tone="warning" actionPlacement="end" action={<Button asChild variant="secondary"><a href="/settings">Settings에서 다시 연결</a></Button>}>
      <StatusFeedbackTitle>GitHub 연결이 끊어졌습니다</StatusFeedbackTitle>
      <StatusFeedbackDescription>Issue와 저장소 동기화를 다시 시작하려면 연결을 확인하세요.</StatusFeedbackDescription>
    </StatusFeedback>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Settings에서 다시 연결" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "안내 닫기" })).toBeNull();
  },
};

export const ErrorContentAction: Story = {
  render: () => (
    <StatusFeedback variant="content" tone="error" actionPlacement="end" action={<Button asChild variant="secondary"><a href="/settings">Settings에서 확인</a></Button>}>
      <StatusFeedbackTitle>디스크의 문서가 변경되었습니다</StatusFeedbackTitle>
      <StatusFeedbackDescription>내 변경과 비교한 뒤 처리 방법을 선택하세요.</StatusFeedbackDescription>
    </StatusFeedback>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Settings에서 확인" })).toBeVisible();
  },
};
