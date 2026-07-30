import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceCodeCopy } from "./DeviceCodeCopy";

afterEach(cleanup);

describe("DeviceCodeCopy", () => {
  it("copies the device code and confirms success", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <DeviceCodeCopy code="ABCD-EFGH" writeClipboard={writeClipboard} />,
    );

    await user.click(screen.getByRole("button", { name: "사용자 코드 복사" }));

    expect(writeClipboard).toHaveBeenCalledWith("ABCD-EFGH");
    expect(await screen.findByText("복사됨")).toBeInTheDocument();
  });

  it("keeps the code selectable and explains a clipboard failure", async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error("denied"));
    const user = userEvent.setup();
    render(
      <DeviceCodeCopy code="ABCD-EFGH" writeClipboard={writeClipboard} />,
    );

    await user.click(screen.getByRole("button", { name: "사용자 코드 복사" }));

    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "복사하지 못했습니다. 코드를 직접 선택해 주세요.",
    );
  });
});
