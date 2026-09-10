import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, ExternalLink, MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import { expect, screen, waitFor } from "storybook/test";
import { IconButton } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenuContent,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof DropdownMenuContent>;

export default meta;

type Story = StoryObj<typeof meta>;

async function getReducedMotionTestTools() {
  try {
    return await import("vitest/browser");
  } catch {
    return undefined;
  }
}

function DocumentActions({ compact = false }: { compact?: boolean }) {
  const [density, setDensity] = useState("default");

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
        <IconButton label="문서 작업" tooltip={false}>
          <MoreVertical aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>보기 밀도</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
              <DropdownMenuRadioItem value="default">편안하게</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">작게</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem size={compact ? "compact" : "default"}>
          <Copy aria-hidden="true" />
          링크 복사
        </DropdownMenuItem>
        <DropdownMenuItem size={compact ? "compact" : "default"}>
          <ExternalLink aria-hidden="true" />
          GitHub에서 보기
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem size={compact ? "compact" : "default"} variant="destructive">
          <Trash2 aria-hidden="true" />
          문서 삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const Default: Story = {
  render: () => <DocumentActions />,
  play: async ({ canvas }) => {
    const browser = await getReducedMotionTestTools();
    if (!browser) return;

    const trigger = canvas.getByRole("button", { name: "문서 작업" });
    const defaultBackground = getComputedStyle(trigger).backgroundColor;
    await expect(defaultBackground).not.toBe("");
    await browser.page.elementLocator(trigger).hover();
    await new Promise((resolve) => setTimeout(resolve, 220));
    await expect(getComputedStyle(trigger).backgroundColor).not.toBe(defaultBackground);
  },
};

export const Interaction: Story = {
  render: () => <DocumentActions />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "문서 작업" });

    await userEvent.click(trigger);
    const menu = screen.getByRole("menu");
    await expect(menu).toHaveAttribute("data-state", "open");
    // The menu is portalled outside Storybook's preview iframe, so viewport
    // rectangles are not comparable here. Radix's explicit alignment contract
    // is the reliable assertion for a trailing kebab trigger.
    await expect(menu).toHaveAttribute("data-align", "end");
    await expect(getComputedStyle(menu).animationName).toBe("okhub-popover-in");
    await expect(getComputedStyle(menu).animationDuration).toBe("0.18s");
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("menuitem", { name: "보기 밀도" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(screen.getByRole("menuitemradio", { name: "편안하게" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(menu).toHaveAttribute("data-state", "closed");
    await expect(getComputedStyle(menu).animationName).toBe("okhub-popover-out");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
