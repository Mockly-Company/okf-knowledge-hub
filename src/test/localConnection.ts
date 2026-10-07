import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

export async function submitLocalConnection(user: ReturnType<typeof userEvent.setup>, method: "existing" | "download" = "existing") {
  const radio = screen.getByRole("radio", { name: method === "existing" ? /이 기기의 저장소 연결/ : /새로 다운로드해서 연결/ });
  if ((radio as HTMLInputElement).disabled) return;
  await user.click(radio);
  await user.click(screen.getByRole("button", { name: /^(폴더 선택|변경)$/ }));
  if (method === "existing") await user.click(screen.getByRole("button", { name: "연결" }));
}
